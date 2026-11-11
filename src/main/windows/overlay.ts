import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import type {
  DisplayCapture,
  DisplayInfo,
  OverlayCompletePayload,
  RecorderMode,
  Settings
} from '../../shared/types'
import { loadRoute } from './load'
import {
  beginOverlaySession,
  endOverlaySession,
  noteCleanOverlaySession
} from '../safe-mode'
import { logDiagnostic } from '../diagnostics'
import { disableWindowTransitions } from '../native-window'
import {
  MEMORY_RECYCLE_THRESHOLD_BYTES,
  MEMORY_SAMPLE_EVERY_SESSIONS,
  evaluateMemoryGrowth
} from '../runtime/memory-governor'

interface OverlayEntry {
  window: BrowserWindow
  displayId: number
  bounds: Electron.Rectangle
  recordingMode: { active: boolean; interactive: boolean } | null
  rendererGone: boolean
  /** 编辑态预热是否已经完成；每个窗口只需要一次。 */
  warmed: boolean
}

const WARMUP_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function toMb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024)
}

/**
 * 覆盖层窗口生命周期（2026-11，0.8.7）：
 *
 * 背景：0.8.6 采用“空闲 hide、F1 时以 1% 透明度 show、再切 100%”。实测发现
 * Windows 的打开缩放动画绑定在 ShowWindow 上，并且会忽略窗口的 layered alpha：
 * 动画期间把 alpha 切到 1，会看到冻结画面从约 0.99 倍弹到 1.0 倍（“从小变大闪一下”）。
 * DwmSetWindowAttribute(DWMWA_TRANSITIONS_FORCEDISABLED) 在 Win11 上对该动画无效
 * （实测返回 HRESULT=0，动画照常）。
 *
 * 设计意图：窗口从创建起就一直保持“已显示”，空闲时保持全屏尺寸、alpha 0、鼠标穿透。
 * F1 时只改 alpha，不做 show、也不做 resize —— 实验证明对已显示窗口调整尺寸不会触发
 * 任何过渡动画。整个进程生命周期内不再调用 hide()/showInactive() 来切换会话。
 *
 * 关键约束：
 * - 任何地方都不要对覆盖层窗口调用 hide()；停靠统一走 park()，激活统一走 activate()。
 * - 截图发生时窗口是全屏 + alpha 0，而不是隐藏；alpha 0 的窗口不贡献像素。
 * - 会话内容（冻结画面、遮罩）在 alpha 0 期间绘制，画好后再切到 alpha 1。
 * - 启动和内存回收后的预热会用 1×1 假图跑一遍完整编辑态，避免首次框选的冷启动卡顿。
 */

/** 回收延迟；压测可用环境变量缩短，生产默认 1.5 秒。 */
function recycleDelayMs(): number {
  const raw = Number(process.env.PIXMINT_MEMORY_RECYCLE_DELAY_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : 1500
}

/**
 * 覆盖层在应用启动时预热，F1 只做一次当前屏幕捕获并把已加载好的窗口显示出来，
 * 避免每次现场加载 React bundle 造成 1 秒以上延迟。
 *
 * 截屏期间只显示一个内容保护的小提示窗，覆盖层保持隐藏；
 * 截屏完成后先在 opacity 0 状态下注入新画面，等渲染层确认图片已解码再显示，
 * 避免预热窗口残留的旧截图或实时桌面闪一下。
 */
export class OverlayManager {
  private readonly entries = new Map<number, OverlayEntry>()
  private readonly byDisplay = new Map<number, number>()
  private readonly captures = new Map<number, DisplayCapture>()
  private readonly rendererReady = new Set<number>()
  private readonly readyWaiters = new Map<number, Array<() => void>>()
  private readonly prepareWaiters = new Map<number, () => void>()
  /** 编辑态预热：让工具栏和标注画布在截屏期间先完成一次创建/合成。 */
  private readonly warmEditWaiters = new Map<number, () => void>()
  private readonly warmEditPromises = new Map<number, Promise<void>>()
  /** 覆盖层确认“已绘制两帧”的时间，用于区分真正 ack 和 700ms 超时。 */
  private readonly preparedAckAt = new Map<number, number>()
  /** 递增后让进行中的启动预热失效，避免和真正的截图会话互相清状态。 */
  private warmupToken = 0
  private active = false
  private watchdogTimer: NodeJS.Timeout | null = null
  private lastHeartbeatAt = 0
  private escapeRegistered = false
  private sessionLocked = false
  /** 本次会话的渲染层是否真的完成过绘制确认；只有这种会话才算“干净会话”。 */
  private sessionPrepared = false
  /** 自上次重建以来的截图会话数，用于按节奏采样渲染进程内存。 */
  private sessionCount = 0
  /** 建立基线之后又完成了多少次会话。 */
  private sessionsSinceBaseline = 0
  private memoryBaselineBytes: number | null = null
  private recycleTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly preloadPath: string,
    private readonly getSettings: () => Settings,
    private readonly onComplete: (payload: OverlayCompletePayload, capture: DisplayCapture) => void,
    private readonly onCancel: () => void,
    private readonly onAbort: (message: string) => void
  ) {}

  isActive(): boolean {
    return this.active
  }

  captureFor(webContentsId: number): DisplayCapture | undefined {
    return this.captures.get(webContentsId)
  }

  /**
   * 背景：渲染层可能因为大图编码、GPU 合成或驱动问题停止响应。
   * 设计意图：用心跳确认覆盖层仍在正常跑事件循环，超时后由主进程强制收尾。
   * 关键约束：只接受当前活动覆盖层的心跳，隐藏的预热窗口不能延长会话。
   */
  noteHeartbeat(webContentsId: number): void {
    if (!this.active) return
    if (!this.entries.has(webContentsId)) return
    this.lastHeartbeatAt = Date.now()
  }

  /**
   * 背景：进入框选、待机或重录时，覆盖层重新变成可交互的全屏窗口。
   * 设计意图：统一在这里启动看门狗、注册 Esc、写异常锁，避免某个入口漏掉兜底。
   * 关键约束：重复调用必须幂等；正常结束一定要走 endSession。
   */
  private activateSession(webContentsId: number): void {
    this.active = true
    this.sessionPrepared = false
    this.lastHeartbeatAt = Date.now()
    if (!this.sessionLocked) {
      beginOverlaySession()
      this.sessionLocked = true
    }
    this.startWatchdog()
    console.log('OVERLAY_SESSION_ACTIVE', webContentsId)
  }

  private startWatchdog(): void {
    this.stopWatchdog()
    this.watchdogTimer = setInterval(() => {
      if (!this.active) return
      const silentFor = Date.now() - this.lastHeartbeatAt
      if (silentFor > 2000) {
        // 正常使用时 Esc 留给标注输入框；只有心跳中断后才升级为系统级逃生键。
        this.registerEmergencyShortcut()
      }
      if (silentFor > 5000) {
        this.failSafe(`截图界面无响应（${silentFor}ms），已自动退出`)
      }
    }, 1000)
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  private registerEmergencyShortcut(): void {
    if (this.escapeRegistered && globalShortcut.isRegistered('Escape')) return
    // globalShortcut.unregisterAll() 可能被设置页调用；这里允许重新注册。
    this.escapeRegistered = false
    if (globalShortcut.isRegistered('Escape')) return
    try {
      const ok = globalShortcut.register('Escape', () => {
        this.failSafe('已通过 Esc 退出截图')
      })
      if (ok) this.escapeRegistered = true
      else console.warn('OVERLAY_ESCAPE_SHORTCUT_FAILED')
    } catch (error) {
      console.warn('OVERLAY_ESCAPE_SHORTCUT_ERROR', error)
    }
  }

  private unregisterEmergencyShortcut(): void {
    if (!this.escapeRegistered) return
    this.escapeRegistered = false
    if (globalShortcut.isRegistered('Escape')) {
      globalShortcut.unregister('Escape')
    }
  }

  private endSession(clean = true): void {
    this.stopWatchdog()
    this.unregisterEmergencyShortcut()
    if (this.sessionLocked) {
      endOverlaySession()
      this.sessionLocked = false
      // 只有真正绘制过两帧、且正常收尾的会话，才是“覆盖层可用”的证据；
      // 连续几次后自动退出兼容模式，避免一次误触发永久关闭硬件加速。
      if (clean && this.sessionPrepared) noteCleanOverlaySession()
    }
    this.sessionPrepared = false
  }

  /**
   * 背景：覆盖层是整屏置顶窗口，一旦渲染线程卡死会继续吃掉桌面鼠标事件。
   * 设计意图：不等待渲染层恢复，主进程立即鼠标穿透、透明化、停靠并清理会话。
   * 关键约束：必须可重入；失败兜底本身不能再触发一轮 UI 操作。渲染层已经
   * 不可信时不能依赖它回 ack，park 只发出 reset，不等待。
   */
  private failSafe(message: string): void {
    const hadActive = this.active
    console.error('OVERLAY_FAILSAFE', message)
    logDiagnostic('overlay', `FAILSAFE ${message}`)
    this.active = false
    // 看门狗兜底说明覆盖层没有正常收尾，不能计入“干净会话”。
    this.endSession(false)
    for (const [id, entry] of [...this.entries.entries()]) {
      if (entry.window.isDestroyed()) {
        this.removeEntry(id)
        continue
      }
      this.park(entry)
      // 渲染进程已经挂掉时，下一次显示会带着残留表面；直接销毁，下次按需重建。
      if (entry.rendererGone || entry.window.webContents.isDestroyed()) {
        entry.window.destroy()
        this.removeEntry(id)
      }
    }
    this.captures.clear()
    if (hadActive) this.onAbort(message)
  }

  markRendererReady(webContentsId: number): void {
    console.log('OVERLAY_RENDERER_READY', webContentsId)
    this.rendererReady.add(webContentsId)
    const waiters = this.readyWaiters.get(webContentsId)
    if (waiters) {
      for (const resolve of waiters) resolve()
      this.readyWaiters.delete(webContentsId)
    }
  }

  prewarm(displays: DisplayInfo[]): void {
    for (const display of displays) {
      if (this.byDisplay.has(display.id)) continue
      this.createWindow(display)
    }
  }

  /** 创建窗口时的初始尺寸：先用 1×1 完成首次 show，避免全屏尺寸下触发打开动画。 */
  private initialBounds(bounds: Electron.Rectangle): Electron.Rectangle {
    return { x: bounds.x, y: bounds.y, width: 1, height: 1 }
  }

  /**
   * 空闲停靠位置：保持全屏尺寸，只是 alpha 0、鼠标穿透、不置顶。
   * 尺寸不变意味着下一次会话不需要 resize，全屏合成表面一直是热的。
   */
  private parkedBounds(bounds: Electron.Rectangle): Electron.Rectangle {
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  }

  /**
   * 激活会话窗口：把已显示的窗口调整到目标显示器全屏。
   * 只做 setBounds，不做 show/hide；对已显示窗口调整尺寸不会播放过渡动画。
   */
  private activate(entry: OverlayEntry, bounds: Electron.Rectangle): void {
    const window = entry.window
    if (window.isDestroyed()) return
    // Win+D / 显示桌面会把窗口最小化；恢复要在 alpha 0 状态下做，避免恢复动画露出内容。
    if (window.isMinimized()) window.restore()
    window.setOpacity(0)
    window.setBounds(bounds)
    entry.bounds = { ...bounds }
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setIgnoreMouseEvents(true)
    if (!window.isVisible()) window.showInactive()
    window.moveTop()
  }

  /**
   * 空闲停靠：alpha 0 → 保持全屏尺寸 → 取消置顶。
   * 顺序很重要：先透明再处理尺寸，用户看不到变化；窗口不 hide，下次激活就不会有打开动画。
   */
  private park(entry: OverlayEntry): void {
    const window = entry.window
    if (window.isDestroyed()) return
    window.setIgnoreMouseEvents(true)
    window.setOpacity(0)
    window.setAlwaysOnTop(false)
    window.setBounds(this.parkedBounds(entry.bounds))
    this.send(entry, 'overlay:reset')
    this.assertParked(entry)
  }

  /**
   * 不变量：覆盖层空闲时必须“显示中、全屏尺寸、鼠标穿透”。
   * 任何人把 hide() 或缩小尺寸加回来，下一次 park 会在诊断日志里暴露出来。
   */
  private assertParked(entry: OverlayEntry): void {
    const window = entry.window
    if (window.isDestroyed()) return
    const bounds = window.getBounds()
    const wrongSize =
      bounds.width < entry.bounds.width - 1 || bounds.height < entry.bounds.height - 1
    if (!window.isVisible() || window.isMinimized() || wrongSize) {
      logDiagnostic(
        'overlay',
        `lifecycle violation: visible=${window.isVisible()} minimized=${window.isMinimized()} bounds=${bounds.width}x${bounds.height}`,
        'warn'
      )
    }
  }

  /**
   * 请求一次编辑态预热：渲染层用假选区把工具栏、缩放柄和标注画布完整挂载一次。
   * 调用方会把窗口临时调到 alpha 0.01（让 rAF 真正运行），用户不可见；
   * 预热与截图串行执行，结束后窗口恢复 alpha 0 再截图。
   */
  private requestWarmEdit(entry: OverlayEntry): void {
    if (entry.window.isDestroyed() || entry.window.webContents.isDestroyed()) return
    const id = entry.window.webContents.id
    if (this.warmEditPromises.has(id)) return
    const startedAt = Date.now()
    let finish: () => void = () => undefined
    const promise = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.warmEditWaiters.get(id) === finish) this.warmEditWaiters.delete(id)
        this.warmEditPromises.delete(id)
        logDiagnostic('overlay', 'warm-edit timeout (160ms)', 'warn')
        resolve()
      }, 160)
      finish = (): void => {
        clearTimeout(timer)
        this.warmEditWaiters.delete(id)
        this.warmEditPromises.delete(id)
        const elapsed = Date.now() - startedAt
        if (elapsed > 100) logDiagnostic('overlay', `warm-edit slow ${elapsed}ms`, 'warn')
        resolve()
      }
      this.warmEditWaiters.set(id, finish)
    })
    this.warmEditPromises.set(id, promise)
    // 带上目标尺寸：窗口刚从 1×1 调整到全屏，渲染层的 innerWidth 可能还没更新。
    this.send(entry, 'overlay:warm-edit', {
      x: 0,
      y: 0,
      width: Math.max(1, Math.round(entry.bounds.width)),
      height: Math.max(1, Math.round(entry.bounds.height))
    })
  }

  markWarmEditDone(webContentsId: number): void {
    const entry = this.entries.get(webContentsId)
    if (entry) entry.warmed = true
    this.warmEditWaiters.get(webContentsId)?.()
  }

  /**
   * 每个窗口只预热一次。窗口必须处于可见状态（alpha 0.01）渲染层的 rAF 才会
   * 真正跑起来，所以预热期间临时把窗口调到 0.01，结束后再恢复到目标透明度。
   */
  private async warmEditOnce(entry: OverlayEntry, targetOpacity: number): Promise<void> {
    if (entry.warmed) return
    const id = entry.window.webContents.id
    entry.window.setOpacity(0.01)
    this.requestWarmEdit(entry)
    await (this.warmEditPromises.get(id) ?? Promise.resolve())
    if (entry.window.isDestroyed()) return
    entry.window.setOpacity(targetOpacity)
  }

  async prepare(display: DisplayInfo): Promise<void> {
    this.warmupToken += 1
    this.active = true
    let id = this.byDisplay.get(display.id)
    if (id === undefined) id = this.createWindow(display)
    const entry = this.entries.get(id)
    if (!entry) {
      this.active = false
      return
    }
    // 显示器排列变化后，下次显示的位置也要跟着更新。
    entry.bounds = {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    }
    for (const other of this.entries.values()) {
      if (other.window !== entry.window && !other.window.isDestroyed()) {
        this.park(other)
      }
    }
    this.captures.delete(id)
    // 从停靠态恢复全屏；窗口一直处于显示状态，不使用 show/hide。
    this.activate(entry, entry.bounds)
    // 首次会话先预热编辑态（窗口临时 alpha 0.01 让 rAF 真正运行），
    // 预热结束后恢复 alpha 0，保证随后的截图不被任何像素污染。
    if (this.rendererReady.has(id)) await this.warmEditOnce(entry, 0)
    // 全透明窗口对 GDI/WGC 截屏没有任何像素贡献，冻结画面保持干净。
    this.send(entry, 'overlay:prepare', this.getSettings())
  }

  markPrepared(webContentsId: number): void {
    this.preparedAckAt.set(webContentsId, Date.now())
    if (this.active) this.sessionPrepared = true
    const resolve = this.prepareWaiters.get(webContentsId)
    if (resolve) {
      resolve()
      this.prepareWaiters.delete(webContentsId)
    }
  }

  /**
   * 录制期间覆盖层保持可见，红框和徽章留在屏幕上；窗口整体鼠标穿透，
   * 控制条由独立小窗承载。红框画在选区外沿，录制裁剪只取选区内部，
   * 因此不需要对全屏覆盖层启用内容保护，避免 Windows 捕获整块变黑。
   * interactive=true 用于待机/预览阶段，保留按钮点击；录制阶段传 false 让桌面可操作。
   */
  setRecordingMode(webContentsId: number, active: boolean, interactive = true): void {
    const entry = this.entries.get(webContentsId)
    if (!entry || entry.window.isDestroyed()) return
    // 录制状态每 100ms 更新一次；重复 moveTop/setAlwaysOnTop 会让全屏透明层反复重绘，
    // 录进画面就是持续闪烁。只在 active/interactive 真正变化时执行。
    const current = entry.recordingMode
    if (current && current.active === active && current.interactive === interactive) return
    entry.recordingMode = { active, interactive }
    const window = entry.window
    // 重录/预览结束后窗口是 alpha 0 但仍是全屏尺寸；被最小化时先恢复。
    if (interactive && window.isMinimized()) window.restore()
    if (interactive) this.activateSession(webContentsId)
    if (active) {
      if (interactive) {
        window.setAlwaysOnTop(true, 'screen-saver')
        window.setIgnoreMouseEvents(false)
      } else {
        // 录制/倒计时阶段控制条是 screen-saver 级；覆盖层降一级，
        // 否则全屏选区时控制条会被透明覆盖层压在下面，看起来像消失了。
        window.setAlwaysOnTop(true, 'floating')
        window.setIgnoreMouseEvents(true)
      }
      window.setOpacity(1)
      window.moveTop()
      return
    }
    if (interactive) {
      window.setAlwaysOnTop(true, 'screen-saver')
      window.setIgnoreMouseEvents(false)
    } else {
      window.setAlwaysOnTop(true, 'floating')
      window.setIgnoreMouseEvents(true)
    }
    window.setOpacity(1)
  }

  hideRecordingOverlay(webContentsId: number): void {
    const entry = this.entries.get(webContentsId)
    if (!entry || entry.window.isDestroyed()) return
    // 录制完成进入结果卡后，本次截图会话已经结束；停靠而不是 hide，
    // 否则下一次 F1 会重新触发 Windows 的打开缩放动画。
    this.park(entry)
    this.active = false
    this.endSession()
  }

  async start(capture: DisplayCapture, pendingRecorderMode?: RecorderMode): Promise<void> {
    const started = Date.now()
    this.warmupToken += 1
    this.active = true
    let id = this.byDisplay.get(capture.displayId)
    if (id === undefined) {
      id = this.createWindow({
        id: capture.displayId,
        bounds: capture.bounds,
        scaleFactor: capture.scaleFactor
      })
    }
    const entry = this.entries.get(id)
    if (!entry) {
      this.active = false
      return
    }
    this.activateSession(id)
    for (const other of this.entries.values()) {
      if (other.window !== entry.window && !other.window.isDestroyed()) {
        this.park(other)
      }
    }
    this.activate(entry, capture.bounds)
    const boundsAt = Date.now()
    this.captures.set(id, capture)
    console.log('OVERLAY_START', id, this.rendererReady.has(id))
    await this.waitForRenderer(id)
    const readyAt = Date.now()
    if (!this.active || entry.window.isDestroyed()) {
      this.endSession()
      return
    }
    // 按需创建的窗口（副屏/回收后重建）：在绘制冻结画面之前补一次编辑态预热。
    // 正常 F1 流程里 prepare 已经完成预热，这里是空操作。
    await this.warmEditOnce(entry, 0.01)
    if (!this.active || entry.window.isDestroyed()) {
      this.endSession()
      return
    }
    entry.window.setAlwaysOnTop(true, 'screen-saver')
    // 先保持鼠标穿透，等冻结画面真正绘制到画布后再允许框选。
    entry.window.setIgnoreMouseEvents(true)
    // 窗口一直是显示状态，0.01 只是为了让 DWM 持续合成这一帧；
    // 真正呈现给用户发生在 prepared 之后的 setOpacity(1)。
    entry.window.setOpacity(0.01)
    entry.window.moveTop()
    const nativesAt = Date.now()
    this.preparedAckAt.delete(id)
    const preparedStarted = Date.now()
    const prepared = this.waitForPrepared(id, 700)
    this.send(entry, 'overlay:init', {
      ...capture,
      settings: this.getSettings(),
      pendingRecorderMode
    })
    const initAt = Date.now()
    console.log('OVERLAY_INIT_SENT', Date.now() - started)
    await prepared
    const preparedAt = Date.now()
    if (!this.active || entry.window.isDestroyed()) {
      this.endSession()
      return
    }
    console.log('OVERLAY_PREPARED', Date.now() - started)
    // 先抢焦点再变可见：首帧以“前台窗口”身份交给 DWM 合成，
    // 避免可见后才切前台导致的额外呈现延迟。
    entry.window.setIgnoreMouseEvents(false)
    entry.window.moveTop()
    entry.window.focus()
    entry.window.setOpacity(1)
    const shownAt = Date.now()
    console.log('OVERLAY_SHOW_MS', Date.now() - started)
    // 一次 F1 的完整分段耗时；超过 800ms 记 warn，方便线上直接看出卡在哪一段。
    const acked = (this.preparedAckAt.get(id) ?? 0) >= preparedStarted
    const total = shownAt - started
    logDiagnostic(
      'overlay',
      `show timing total=${total} bounds=${boundsAt - started} ready=${readyAt - boundsAt} natives=${
        nativesAt - readyAt
      } init=${initAt - nativesAt} prepared=${preparedAt - initAt}${
        acked ? '' : '(timeout)'
      } opacity=${shownAt - preparedAt}`,
      total > 800 ? 'warn' : 'info'
    )
  }

  /**
   * 启动预热：让 React、工具条、图片解码和首帧合成先跑一遍，
   * 避免应用启动后的第一次 F1 比后续慢一倍。全程 1% 透明度，用户看不到。
   * 关键约束：真正的截图会话开始后立即作废，不能清掉正在使用的图片和窗口状态。
   */
  async warmup(display: DisplayInfo): Promise<void> {
    const token = ++this.warmupToken
    let id = this.byDisplay.get(display.id)
    if (id === undefined) id = this.createWindow(display)
    const entry = this.entries.get(id)
    if (!entry) return
    await this.waitForRenderer(id)
    if (token !== this.warmupToken || this.active || entry.window.isDestroyed()) return
    const fake: DisplayCapture = {
      displayId: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      imageDataUrl: WARMUP_PNG,
      imageWidth: 1,
      imageHeight: 1
    }
    this.captures.set(id, fake)
    this.activate(entry, display.bounds)
    entry.window.setOpacity(0.01)
    const prepared = this.waitForPrepared(id, 700)
    this.send(entry, 'overlay:init', { ...fake, settings: this.getSettings() })
    await prepared
    if (token !== this.warmupToken || this.active || entry.window.isDestroyed()) return
    // 假图已经加载，再跑一次编辑态预热：工具栏、缩放柄、标注画布和离屏背景画布
    // 都会在这里完成第一次创建与合成，避免用户第一次框选时整帧被卡住。
    await this.warmEditOnce(entry, 0)
    this.captures.delete(id)
    this.park(entry)
  }

  complete(payload: OverlayCompletePayload, webContentsId: number): void {
    const capture = this.captures.get(webContentsId)
    if (!capture) return
    this.hideAll()
    this.onComplete(payload, capture)
  }

  cancel(): void {
    const hadActive = this.active
    this.hideAll()
    if (hadActive) this.onCancel()
  }

  hideAll(): void {
    this.warmupToken += 1
    this.endSession()
    for (const [id, entry] of [...this.entries.entries()]) {
      if (entry.window.isDestroyed()) {
        this.removeEntry(id)
        continue
      }
      // 停靠到 1×1 而不是 hide：覆盖层窗口全程保持显示，避免下一次 F1 触发打开动画。
      this.park(entry)
      if (entry.rendererGone || entry.window.webContents.isDestroyed()) {
        entry.window.destroy()
        this.removeEntry(id)
      }
    }
    this.captures.clear()
    this.active = false
    this.noteSessionEnded()
  }

  /**
   * 背景：Chromium 的原生内存不会随截图会话自动回落，长时间驻留会持续爬升。
   * 设计意图：每完成若干次会话采样一次渲染进程私有内存，超阈值就重建覆盖层窗口。
   * 关键约束：只在会话结束、窗口已隐藏时执行；重建失败不影响当前使用（下次预热门槛会兜底）。
   */
  private noteSessionEnded(): void {
    this.sessionCount += 1
    if (this.memoryBaselineBytes !== null) this.sessionsSinceBaseline += 1
    if (this.sessionCount % MEMORY_SAMPLE_EVERY_SESSIONS !== 0) return

    const currentBytes = this.currentRendererPrivateBytes()
    if (currentBytes <= 0) return
    if (this.memoryBaselineBytes === null) {
      this.memoryBaselineBytes = currentBytes
      this.sessionsSinceBaseline = 0
      logDiagnostic('overlay', `memory baseline ${toMb(currentBytes)}MB`)
      return
    }

    const decision = evaluateMemoryGrowth({
      baselineBytes: this.memoryBaselineBytes,
      currentBytes,
      sessionsSinceBaseline: this.sessionsSinceBaseline,
      thresholdBytes: MEMORY_RECYCLE_THRESHOLD_BYTES
    })
    if (decision === 'recycle') {
      logDiagnostic(
        'overlay',
        `recycling overlays: baseline ${toMb(this.memoryBaselineBytes)}MB -> ${toMb(currentBytes)}MB after ${this.sessionsSinceBaseline} sessions`,
        'warn'
      )
      console.log(
        'OVERLAY_MEMORY_RECYCLE',
        toMb(this.memoryBaselineBytes),
        '->',
        toMb(currentBytes),
        'sessions=' + this.sessionsSinceBaseline
      )
      this.scheduleRecycle()
    }
  }

  /**
   * 背景：回收需要销毁并重建全屏窗口，同步执行会和"复制/保存/OCR"的完成动作抢 CPU。
   * 设计意图：延迟到会话结束后 1.5 秒，此时用户已经拿到结果；若又按下 F1 则放弃本次回收。
   * 关键约束：定时器只允许存在一个；销毁窗口前必须确认没有活动会话。
   */
  private scheduleRecycle(delayMs = recycleDelayMs()): void {
    if (this.recycleTimer) return
    this.recycleTimer = setTimeout(() => {
      this.recycleTimer = null
      // 用户又开始截图了：推迟到下一次空闲，不能打断正在进行或即将开始的会话。
      if (this.active) {
        this.scheduleRecycle(5000)
        return
      }
      this.recycleOverlays()
    }, delayMs)
  }

  private currentRendererPrivateBytes(): number {
    let max = 0
    const metrics = app.getAppMetrics()
    for (const entry of this.entries.values()) {
      if (entry.window.isDestroyed() || entry.window.webContents.isDestroyed()) continue
      const pid = entry.window.webContents.getOSProcessId()
      const metric = metrics.find((item) => item.pid === pid)
      const privateKb = metric?.memory?.privateBytes ?? 0
      if (privateKb > max) max = privateKb
    }
    return max * 1024
  }

  private recycleOverlays(): void {
    const displays = screen.getAllDisplays().map((display) => ({
      id: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor
    }))
    for (const entry of this.entries.values()) {
      if (!entry.window.isDestroyed()) entry.window.destroy()
    }
    this.entries.clear()
    this.byDisplay.clear()
    this.captures.clear()
    this.rendererReady.clear()
    for (const resolve of this.prepareWaiters.values()) resolve()
    this.prepareWaiters.clear()
    for (const resolve of this.warmEditWaiters.values()) resolve()
    this.warmEditWaiters.clear()
    this.warmEditPromises.clear()
    this.active = false
    this.sessionCount = 0
    this.sessionsSinceBaseline = 0
    this.memoryBaselineBytes = null
    this.prewarm(displays)
    // 回收后立刻预热一次，下一次 F1 仍然走热路径。
    if (displays[0]) void this.warmup(displays[0])
  }

  private send(entry: OverlayEntry, channel: string, payload?: unknown): void {
    if (
      entry.rendererGone ||
      entry.window.isDestroyed() ||
      entry.window.webContents.isDestroyed()
    ) {
      return
    }
    try {
      entry.window.webContents.send(channel, payload)
    } catch (error) {
      console.error('OVERLAY_SEND_FAILED', channel, error)
    }
  }

  private removeEntry(webContentsId: number): void {
    const entry = this.entries.get(webContentsId)
    if (!entry) return
    this.entries.delete(webContentsId)
    this.byDisplay.delete(entry.displayId)
    this.captures.delete(webContentsId)
    this.rendererReady.delete(webContentsId)
    this.prepareWaiters.delete(webContentsId)
    this.preparedAckAt.delete(webContentsId)
    this.warmEditWaiters.get(webContentsId)?.()
    this.warmEditWaiters.delete(webContentsId)
    this.warmEditPromises.delete(webContentsId)
  }

  destroyAll(): void {
    this.warmupToken += 1
    if (this.recycleTimer) {
      clearTimeout(this.recycleTimer)
      this.recycleTimer = null
    }
    this.endSession()
    for (const entry of this.entries.values()) {
      if (!entry.window.isDestroyed()) entry.window.destroy()
    }
    this.entries.clear()
    this.byDisplay.clear()
    this.captures.clear()
    this.rendererReady.clear()
    for (const resolve of this.prepareWaiters.values()) resolve()
    this.prepareWaiters.clear()
    for (const resolve of this.warmEditWaiters.values()) resolve()
    this.warmEditWaiters.clear()
    this.warmEditPromises.clear()
    this.active = false
  }

  private waitForPrepared(webContentsId: number, timeout: number): Promise<void> {
    const previous = this.prepareWaiters.get(webContentsId)
    if (previous) previous()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.prepareWaiters.get(webContentsId) === finish) {
          this.prepareWaiters.delete(webContentsId)
        }
        resolve()
      }, timeout)
      const finish = (): void => {
        clearTimeout(timer)
        resolve()
      }
      this.prepareWaiters.set(webContentsId, finish)
    })
  }

  private createWindow(display: DisplayInfo): number {
    // 先用 1×1 完成首次 show（放大的打开动画只作用在 1×1 上，用户看不到），
    // 再调整到全屏；之后整个生命周期不再 show、不再 resize。
    const initial = this.initialBounds(display.bounds)
    const window = new BrowserWindow({
      x: initial.x,
      y: initial.y,
      width: initial.width,
      height: initial.height,
      // Windows 工具窗口不会进入 Alt-Tab。覆盖层现在常驻显示（alpha 0），
      // 不加这个标志会在 Alt-Tab 里留下一个空白的 Pixmint 项。
      ...(process.platform === 'win32' ? { type: 'toolbar' as const } : {}),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      opacity: 1,
      show: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 窗口长期保持显示，不能让 Chromium 在空闲时节流计时器。
        backgroundThrottling: false
      }
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setMenuBarVisibility(false)
    window.setBounds(initial)
    window.setOpacity(0)
    window.showInactive()
    // 先把窗口铺满目标显示器（仍在 alpha 0），把全屏合成表面创建出来；
    // 之后会话开始/结束都只改 alpha，不再触碰窗口尺寸。
    window.setBounds(this.parkedBounds(display.bounds))
    // 空闲时取消置顶，避免透明全屏窗口干扰全屏游戏/投屏；activate 时会重新置顶。
    window.setAlwaysOnTop(false)
    // 窗口从显示起就保持鼠标穿透；停靠时也不能挡住点击。
    window.setIgnoreMouseEvents(true)
    if (process.platform === 'darwin') {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }
    const id = window.webContents.id
    disableWindowTransitions(window.getNativeWindowHandle())
    this.entries.set(id, {
      window,
      displayId: display.id,
      bounds: display.bounds,
      recordingMode: null,
      rendererGone: false,
      warmed: false
    })
    this.byDisplay.set(display.id, id)
    window.webContents.on('unresponsive', () => {
      this.failSafe('截图界面无响应，已自动退出')
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('OVERLAY_RENDER_PROCESS_GONE', details.reason, details.exitCode)
      const entry = this.entries.get(id)
      if (entry) entry.rendererGone = true
      this.failSafe('截图渲染进程异常退出，已自动清理')
    })
    window.on('closed', () => {
      this.entries.delete(id)
      this.byDisplay.delete(display.id)
      this.captures.delete(id)
      this.rendererReady.delete(id)
      this.prepareWaiters.delete(id)
      this.preparedAckAt.delete(id)
      this.warmEditWaiters.delete(id)
      this.warmEditPromises.delete(id)
      if (this.active) this.endSession()
    })
    loadRoute(window, 'overlay')
    return id
  }

  private waitForRenderer(webContentsId: number, timeout = 600): Promise<void> {
    if (this.rendererReady.has(webContentsId)) return Promise.resolve()
    return new Promise((resolve) => {
      const waiters = this.readyWaiters.get(webContentsId) ?? []
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        resolve()
      }
      waiters.push(finish)
      this.readyWaiters.set(webContentsId, waiters)
      setTimeout(finish, timeout)
    })
  }
}
