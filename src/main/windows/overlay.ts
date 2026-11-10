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
}

const WARMUP_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function toMb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024)
}

/**
 * 背景：让全屏透明窗口常驻可见、靠定时器“保活”，在 Windows 上并不可靠——
 * 页面长时间没有真实变化时，DWM 会放冷甚至回收窗口的合成表面，表现为
 * 应用内部 90ms 就绪、屏幕上却要等几秒才看到遮罩。0.8.1–0.8.5 反复修的都是这个。
 * 设计意图：覆盖层空闲时直接隐藏，不再依赖透明窗口的表面保持热态；
 * F1 时先完成截图，再以 opacity 0 显示窗口、等渲染层画好冻结画面和遮罩，
 * 最后切到 opacity 1。用户看到的第一帧就是完整画面，不经过任何冷表面。
 * 关键约束：截图发生在窗口隐藏期间，覆盖层天然不会进入截图，也不再需要
 * WDA_EXCLUDEFROMCAPTURE；录制阶段仍复用同一个透明窗口显示红框和徽章。
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
   * 设计意图：不等待渲染层恢复，主进程立即鼠标穿透、透明化、隐藏并清理会话。
   * 关键约束：必须可重入；失败兜底本身不能再触发一轮 UI 操作。
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
      entry.window.setIgnoreMouseEvents(true)
      entry.window.setOpacity(1)
      this.send(entry, 'overlay:reset')
      // 看门狗触发时渲染层可能已经卡死，收不到 reset；必须从主进程
      // 直接把窗口隐藏，否则全屏遮罩会一直留在屏幕上。
      entry.window.hide()
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
        other.window.setIgnoreMouseEvents(true)
        if (other.window.isVisible()) other.window.hide()
      }
    }
    this.captures.delete(id)
    entry.window.setBounds(entry.bounds)
    entry.window.setIgnoreMouseEvents(true)
    if (entry.window.isVisible()) entry.window.hide()
    // 以 0 透明度提前显示，把窗口显示/合成的耗时和截图重叠。
    // 全透明窗口对 GDI/WGC 截屏没有任何像素贡献，冻结画面保持干净。
    entry.window.setOpacity(0)
    entry.window.showInactive()
    entry.window.moveTop()
    // 隐藏状态下先把上一次会话的 UI 重置掉，等截图完成后直接显示新画面。
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
      if (!window.isVisible()) window.showInactive()
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
    if (!window.isVisible()) window.showInactive()
  }

  hideRecordingOverlay(webContentsId: number): void {
    const entry = this.entries.get(webContentsId)
    if (!entry || entry.window.isDestroyed()) return
    this.send(entry, 'overlay:reset')
    entry.window.setIgnoreMouseEvents(true)
    entry.window.setOpacity(1)
    entry.window.hide()
    // 录制完成进入结果卡后，本次截图会话已经结束；必须复位 active，
    // 否则下一次 F1 会被 startCapture 当成“关闭旧覆盖层”而吞掉。
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
        other.window.setIgnoreMouseEvents(true)
        if (other.window.isVisible()) other.window.hide()
      }
    }
    entry.window.setBounds(capture.bounds)
    entry.bounds = capture.bounds
    const boundsAt = Date.now()
    this.captures.set(id, capture)
    console.log('OVERLAY_START', id, this.rendererReady.has(id))
    await this.waitForRenderer(id)
    const readyAt = Date.now()
    if (!this.active || entry.window.isDestroyed()) {
      this.endSession()
      return
    }
    entry.window.setAlwaysOnTop(true, 'screen-saver')
    // 先保持鼠标穿透，等冻结画面真正绘制到画布后再允许框选。
    entry.window.setIgnoreMouseEvents(true)
    // 以 1% 透明度显示窗口：DWM 会真的合成这一帧，渲染层也能收到合成帧并完成
    // 解码/绘制，用户肉眼看不到内容；等两帧确认后再切到 1，首帧就是完整画面。
    entry.window.setOpacity(0.01)
    if (!entry.window.isVisible()) entry.window.showInactive()
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
    entry.window.setIgnoreMouseEvents(true)
    entry.window.setOpacity(0.01)
    entry.window.showInactive()
    entry.window.moveTop()
    const prepared = this.waitForPrepared(id, 700)
    this.send(entry, 'overlay:init', { ...fake, settings: this.getSettings() })
    await prepared
    if (token !== this.warmupToken || this.active || entry.window.isDestroyed()) return
    this.send(entry, 'overlay:reset')
    this.captures.delete(id)
    entry.window.setOpacity(1)
    entry.window.hide()
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
      entry.window.setIgnoreMouseEvents(true)
      entry.window.setOpacity(1)
      this.send(entry, 'overlay:reset')
      entry.window.hide()
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
    const window = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
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
        // 隐藏等待下一次 F1 时不能被 Chromium 节流，否则 rAF 会延迟到 1 秒以上。
        backgroundThrottling: false
      }
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setMenuBarVisibility(false)
    // Windows 会把“初始创建”的全屏窗口高度压到工作区（1080 -> 1032）。
    // 创建后必须显式 setBounds，才能覆盖任务栏区域，保证截图坐标不偏移。
    window.setBounds(display.bounds)
    // 窗口从未显示起就保持鼠标穿透；空闲时虽然留在屏幕内，也不能挡住点击。
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
      rendererGone: false
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
