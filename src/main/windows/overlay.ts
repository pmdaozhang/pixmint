import { BrowserWindow, globalShortcut } from 'electron'
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
  endOverlaySession
} from '../safe-mode'
import { logDiagnostic } from '../diagnostics'
import { disableWindowTransitions } from '../native-window'

interface OverlayEntry {
  window: BrowserWindow
  displayId: number
}

const WARMUP_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

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
  private warmupToken = 0
  private active = false
  private watchdogTimer: NodeJS.Timeout | null = null
  private lastHeartbeatAt = 0
  private escapeRegistered = false
  private sessionLocked = false

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

  private endSession(): void {
    this.stopWatchdog()
    this.unregisterEmergencyShortcut()
    if (this.sessionLocked) {
      endOverlaySession()
      this.sessionLocked = false
    }
  }

  /**
   * 背景：覆盖层是整屏置顶窗口，一旦渲染线程卡死会继续吃掉桌面鼠标事件。
   * 设计意图：不等待渲染层恢复，主进程立即鼠标穿透、透明化、隐藏并清理会话。
   * 关键约束：必须可重入；失败兜底本身不能再触发一轮 UI 操作。
   */
  private failSafe(message: string): void {
    if (!this.active) return
    console.error('OVERLAY_FAILSAFE', message)
    logDiagnostic('overlay', `FAILSAFE ${message}`)
    this.active = false
    this.endSession()
    for (const entry of this.entries.values()) {
      if (entry.window.isDestroyed()) continue
      entry.window.setIgnoreMouseEvents(true)
      entry.window.setOpacity(0)
      entry.window.webContents.send('overlay:reset')
    }
    this.captures.clear()
    this.onAbort(message)
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
    for (const other of this.entries.values()) {
      if (other.window !== entry.window) {
        other.window.setOpacity(0)
        other.window.setIgnoreMouseEvents(true)
      }
    }
    entry.window.setBounds(display.bounds)
    this.captures.delete(id)
    entry.window.setContentProtection(false)
    // 覆盖层常驻可见但完全透明，截屏期间只清空内容，不 hide，
    // 避免下一次 show() 触发 Windows 的全屏放大过场。
    if (entry.window.isVisible()) {
      entry.window.setOpacity(0)
      entry.window.setIgnoreMouseEvents(true)
    }
    entry.window.webContents.send('overlay:prepare', this.getSettings())
  }

  markPrepared(webContentsId: number): void {
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
    const window = entry.window
    if (interactive) this.activateSession(webContentsId)
    if (active) {
      window.setContentProtection(false)
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
    window.setContentProtection(false)
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
    entry.window.setIgnoreMouseEvents(true)
    entry.window.setContentProtection(false)
    entry.window.setOpacity(0)
    // 录制完成进入结果卡后，本次截图会话已经结束；必须复位 active，
    // 否则下一次 F1 会被 startCapture 当成“关闭旧覆盖层”而吞掉。
    this.active = false
    this.endSession()
  }

  async start(capture: DisplayCapture, pendingRecorderMode?: RecorderMode): Promise<void> {
    const started = Date.now()
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
      if (other.window !== entry.window) {
        other.window.setOpacity(0)
        other.window.setIgnoreMouseEvents(true)
      }
    }
    entry.window.setBounds(capture.bounds)
    this.captures.set(id, capture)
    console.log('OVERLAY_START', id, this.rendererReady.has(id))
    await this.waitForRenderer(id)
    if (!this.active || entry.window.isDestroyed()) {
      this.endSession()
      return
    }
    entry.window.setContentProtection(false)
    entry.window.setAlwaysOnTop(true, 'screen-saver')
    entry.window.setIgnoreMouseEvents(false)
    // 先以完全透明状态显示窗口，让渲染进程完成图片解码和首次绘制；
    // 收到 prepared ack 后再把 opacity 设为 1，避免旧 surface 或透明桌面被看到。
    entry.window.setOpacity(0)
    // 使用 showInactive 避免 Windows 对全屏窗口执行“从小到大”的显示动画；
    // 覆盖层内容已经提前解码，直接出现即可，后续再主动 focus 接收键盘。
    if (!entry.window.isVisible()) entry.window.showInactive()
    entry.window.moveTop()
    entry.window.focus()
    const prepared = this.waitForPrepared(id, 700)
    entry.window.webContents.send('overlay:init', {
      ...capture,
      settings: this.getSettings(),
      pendingRecorderMode
    })
    console.log('OVERLAY_INIT_SENT', Date.now() - started)
    await prepared
    if (!this.active || entry.window.isDestroyed()) {
      this.endSession()
      return
    }
    console.log('OVERLAY_PREPARED', Date.now() - started)
    entry.window.setOpacity(1)
    entry.window.moveTop()
    entry.window.focus()
    console.log('OVERLAY_SHOW_MS', Date.now() - started)
  }

  /** 隐藏式预热：不显示给用户，只把渲染层、图片解码和合成器走一遍。 */
  async warmup(display: DisplayInfo): Promise<void> {
    if (this.active) return
    const token = ++this.warmupToken
    let id = this.byDisplay.get(display.id)
    if (id === undefined) id = this.createWindow(display)
    const entry = this.entries.get(id)
    if (!entry) return
    await this.waitForRenderer(id)
    if (token !== this.warmupToken || entry.window.isDestroyed()) return

    const fake: DisplayCapture = {
      displayId: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      imageDataUrl: WARMUP_PNG,
      imageWidth: 1,
      imageHeight: 1
    }
    this.captures.set(id, fake)
    entry.window.setBounds(display.bounds)
    entry.window.setContentProtection(false)
    entry.window.setOpacity(0)
    entry.window.showInactive()
    const prepared = this.waitForPrepared(id, 700)
    entry.window.webContents.send('overlay:init', {
      ...fake,
      settings: this.getSettings()
    })
    await prepared
    if (token !== this.warmupToken || entry.window.isDestroyed()) return
    entry.window.webContents.send('overlay:reset')
    entry.window.setOpacity(0)
    entry.window.setIgnoreMouseEvents(true)
    this.captures.delete(id)
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
    for (const entry of this.entries.values()) {
      if (!entry.window.isDestroyed()) {
        entry.window.webContents.send('overlay:reset')
        entry.window.setContentProtection(false)
        entry.window.setIgnoreMouseEvents(true)
        entry.window.setOpacity(0)
      }
    }
    this.captures.clear()
    this.active = false
  }

  destroyAll(): void {
    this.warmupToken += 1
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
      opacity: 0,
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
    if (process.platform === 'darwin') {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }
    const id = window.webContents.id
    disableWindowTransitions(window.getNativeWindowHandle())
    this.entries.set(id, { window, displayId: display.id })
    this.byDisplay.set(display.id, id)
    window.webContents.on('unresponsive', () => {
      this.failSafe('截图界面无响应，已自动退出')
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('OVERLAY_RENDER_PROCESS_GONE', details.reason, details.exitCode)
      this.failSafe('截图渲染进程异常退出，已自动清理')
    })
    window.on('closed', () => {
      this.entries.delete(id)
      this.byDisplay.delete(display.id)
      this.captures.delete(id)
      this.rendererReady.delete(id)
      this.prepareWaiters.delete(id)
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
