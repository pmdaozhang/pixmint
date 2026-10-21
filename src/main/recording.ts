import {
  BrowserWindow,
  app,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  nativeImage,
  screen,
  shell,
  webContents
} from 'electron'
import {
  copyFileSync,
  createWriteStream,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type WriteStream
} from 'node:fs'
import { basename, join } from 'node:path'
import type {
  GifDoneMeta,
  Rect,
  RecorderBeginPayload,
  RecorderBeginResult,
  RecorderCommand,
  RecorderControlCommand,
  RecorderPreviewInfo,
  RecorderMode,
  RecorderState,
  RecorderStatePatch,
  VideoDoneMeta
} from '../shared/types'
import { maxDurationFor, recordingFileName } from '../shared/recording'
import { notify } from './image-utils'
import { loadRoute } from './windows/load'
import { logDiagnostic } from './diagnostics'

export interface RecorderHost {
  setOverlayRecordingMode(webContentsId: number, active: boolean, interactive: boolean): void
  hideRecordingOverlay(webContentsId: number): void
  hideOverlay(): void
}

const CAPSULE_HEIGHT = 44
const CONTROL_GAP = 12
// 窗口必须比胶囊高，给 CSS 阴影留出透明空间；否则阴影会被窗口边缘裁成方块。
const CONTROL_HEIGHT = 72

function controlWidth(mode: RecorderMode): number {
  return mode === 'video' ? 204 : 164
}

export class RecorderManager {
  private controlWindow: BrowserWindow | null = null
  private previewWindow: BrowserWindow | null = null
  private overlayId: number | null = null
  private state: RecorderState | null = null
  private previewInfo: RecorderPreviewInfo | null = null
  private displayBounds: Rect | null = null
  private selection: Rect | null = null
  private readonly tempDir: string
  private readonly allowedFiles = new Set<string>()
  private readonly readableFiles = new Set<string>()
  private videoStream: WriteStream | null = null
  private videoPath = ''
  private videoMeta: VideoDoneMeta | null = null
  private gifFirstFrameDataUrl = ''
  private closingPreview = false
  private beginTimer: NodeJS.Timeout | null = null
  private startTimer: NodeJS.Timeout | null = null
  private escapeRegistered = false

  constructor(
    private readonly preloadPath: string,
    private readonly host: RecorderHost
  ) {
    this.tempDir = join(app.getPath('temp'), 'snapglass-recording')
    mkdirSync(this.tempDir, { recursive: true })
  }

  async begin(
    webContentsId: number,
    payload: RecorderBeginPayload,
    displayBounds: Rect
  ): Promise<RecorderBeginResult> {
    logDiagnostic(
      'recorder',
      `BEGIN mode=${payload.mode} selection=${payload.selection.x},${payload.selection.y},${payload.selection.width}x${payload.selection.height} display=${displayBounds.x},${displayBounds.y},${displayBounds.width}x${displayBounds.height}`
    )
    this.closeControlWindow()
    this.closePreviewWindow()
    this.cleanupTemp()
    this.overlayId = webContentsId
    this.displayBounds = displayBounds
    this.selection = payload.selection
    this.state = {
      mode: payload.mode,
      phase: 'preparing',
      elapsedMs: 0,
      fps: payload.options.fps,
      mic: payload.options.mic,
      systemAudio: payload.options.systemAudio,
      width: 0,
      height: 0,
      maxDurationMs: maxDurationFor(payload.mode)
    }
    /*
     * 准备阶段立即让全屏覆盖层鼠标穿透。
     * 覆盖层显示的是冻结截图，一旦 getUserMedia 卡住又保持可点击，就会锁住整个桌面。
     * 取消能力改由独立控制窗提供。
     */
    this.host.setOverlayRecordingMode(webContentsId, true, false)
    this.openControlWindow()
    this.clearBeginTimer()
    this.beginTimer = setTimeout(() => {
      this.beginTimer = null
      this.sendOverlay({ type: 'cancel' })
      this.failed('录制初始化超时，已退出')
    }, 10_000)
    this.registerEmergencyCancel()
    const sourceId = await this.getSourceId(payload.displayId)
    return { sourceId }
  }

  controlReady(): RecorderState | null {
    return this.state
  }

  isRecordingSession(): boolean {
    if (!this.state) return false
    return (
      this.state.phase === 'preparing' ||
      this.state.phase === 'countdown' ||
      this.state.phase === 'recording' ||
      this.state.phase === 'paused' ||
      this.state.phase === 'encoding'
    )
  }

  updateState(patch: RecorderStatePatch): void {
    if (!this.state) return
    this.state = { ...this.state, ...patch }
    if (this.state.phase === 'countdown') {
      this.ensureStartTimer()
    } else if (
      this.state.phase === 'recording' ||
      this.state.phase === 'paused' ||
      this.state.phase === 'encoding'
    ) {
      this.clearStartTimer()
    }
    if (this.overlayId !== null) {
      if (
        this.state.phase === 'countdown' ||
        this.state.phase === 'recording' ||
        this.state.phase === 'paused' ||
        this.state.phase === 'encoding'
      ) {
        // 录制期间覆盖层保持可见但鼠标穿透：红框画在选区外侧，裁切区域只取选区内部。
        this.host.setOverlayRecordingMode(this.overlayId, true, false)
      }
    }
    if (this.controlWindow) {
      if (
        this.state.phase === 'preparing' ||
        this.state.phase === 'countdown' ||
        this.state.phase === 'recording' ||
        this.state.phase === 'paused' ||
        this.state.phase === 'encoding'
      ) {
        if (!this.controlWindow.isVisible()) this.controlWindow.showInactive()
        this.controlWindow.moveTop()
      } else {
        this.controlWindow.hide()
      }
    }
    if (
      this.state.phase === 'countdown' ||
      this.state.phase === 'recording' ||
      this.state.phase === 'paused' ||
      this.state.phase === 'encoding'
    ) {
      this.clearBeginTimer()
    }
    this.controlWindow?.webContents.send('recorder:control-state', this.state)
  }

  controlCommand(command: RecorderControlCommand): void {
    this.sendOverlay(command)
  }

  gifDone(bytes: Uint8Array, meta: GifDoneMeta): void {
    this.clearBeginTimer()
    this.clearStartTimer()
    this.clearEmergencyCancel()
    if (!this.overlayId) return
    const fileName = recordingFileName('gif', 'gif')
    const filePath = join(this.tempDir, fileName)
    this.gifFirstFrameDataUrl = meta.firstFrameDataUrl ?? ''
    writeFileSync(filePath, Buffer.from(bytes))
    this.allowedFiles.add(filePath)
    this.readableFiles.add(filePath)
    const size = statSync(filePath).size
    const originalLongSide = this.selection
      ? Math.max(this.selection.width, this.selection.height)
      : 0
    const outputLongSide = Math.max(meta.width, meta.height)
    const scaled = originalLongSide > 0 && outputLongSide < originalLongSide - 1
    this.showPreview({
      mode: 'gif',
      fileName,
      filePath,
      mediaUrl: this.mediaUrl(filePath),
      mimeType: 'image/gif',
      extension: 'gif',
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      frameCount: meta.frameCount,
      durationMs: meta.durationMs,
      sizeBytes: size,
      mic: false,
      systemAudio: false,
      hasAudio: false,
      thumbnailUrl: meta.firstFrameDataUrl,
      note:
        meta.frameCount > 0
          ? `共 ${meta.frameCount} 帧 · 调色板两遍量化${
              scaled ? ' · 已缩放至 720 长边以保证流畅' : ''
            }`
          : undefined
    })
  }

  async videoBegin(meta: VideoDoneMeta): Promise<void> {
    this.videoMeta = meta
    const fileName = recordingFileName('video', meta.extension)
    this.videoPath = join(this.tempDir, fileName)
    logDiagnostic(
      'recorder',
      `VIDEO_BEGIN ${fileName} ${meta.width}x${meta.height} ${meta.mimeType}`
    )
    this.allowedFiles.add(this.videoPath)
    this.readableFiles.add(this.videoPath)
    const stream = createWriteStream(this.videoPath)
    this.videoStream = stream
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      stream.once('error', onError)
      stream.once('open', () => {
        stream.off('error', onError)
        resolve()
      })
    })
    stream.on('error', (error) => {
      if (this.videoStream !== stream) return
      console.error('VIDEO_STREAM_ERROR', error)
      this.sendOverlay({ type: 'cancel' })
      this.failed('视频写入失败，请检查磁盘空间')
    })
  }

  videoChunk(chunk: ArrayBuffer): void {
    if (!this.videoStream || this.videoStream.destroyed) return
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(new Uint8Array(chunk))
    this.videoStream.write(buffer)
  }

  async videoDone(meta: VideoDoneMeta): Promise<void> {
    this.clearBeginTimer()
    this.clearStartTimer()
    this.clearEmergencyCancel()
    this.videoMeta = { ...this.videoMeta, ...meta } as VideoDoneMeta
    await this.finishVideoStream()
    if (!this.videoMeta || !this.videoPath) return
    const fileName = this.videoPath.split(/[\\/]/).pop() ?? recordingFileName('video', meta.extension)
    const size = statSync(this.videoPath).size
    this.closeControlWindow()
    this.showPreview({
      mode: 'video',
      fileName,
      filePath: this.videoPath,
      mediaUrl: this.mediaUrl(this.videoPath),
      mimeType: this.videoMeta.mimeType,
      extension: this.videoMeta.extension,
      width: this.videoMeta.width,
      height: this.videoMeta.height,
      fps: this.videoMeta.fps,
      durationMs: this.videoMeta.durationMs,
      sizeBytes: size,
      mic: this.videoMeta.mic,
      systemAudio: this.videoMeta.systemAudio,
      hasAudio: this.videoMeta.hasAudio,
      note: this.videoMeta.note
    })
  }

  failed(message: string): void {
    logDiagnostic('recorder', `FAILED ${message}`)
    this.clearBeginTimer()
    this.clearStartTimer()
    this.clearEmergencyCancel()
    this.closeControlWindow()
    this.cleanupTemp()
    this.restoreOverlay()
    this.state = null
    if (message) notify(message)
  }

  dismiss(): void {
    this.clearBeginTimer()
    this.clearStartTimer()
    this.clearEmergencyCancel()
    this.closeControlWindow()
    this.cleanupTemp()
    this.restoreOverlay()
    this.state = null
  }

  /**
   * 背景：覆盖层看门狗或全局 Esc 触发时，渲染层可能已经卡死。
   * 设计意图：只清理录制资源和临时文件，不再调用 restoreOverlay，
   * 避免把已经被主进程隐藏的覆盖层重新显示出来。
   * 关键约束：调用后本次录制会话结束，结果文件按取消处理。
   */
  abortSession(): void {
    this.clearBeginTimer()
    this.clearStartTimer()
    this.clearEmergencyCancel()
    this.closeControlWindow()
    this.cleanupTemp()
    this.overlayId = null
    this.state = null
  }

  previewReady(): RecorderPreviewInfo | null {
    return this.previewInfo
  }

  previewRead(): Uint8Array {
    const info = this.previewInfo
    if (!info) throw new Error('没有可读取的录制结果')
    return new Uint8Array(readFileSync(info.filePath))
  }

  async previewSave(): Promise<string | null> {
    const info = this.previewInfo
    if (!info) return null
    const defaultDir = info.mode === 'gif' ? app.getPath('pictures') : app.getPath('videos')
    const filters =
      info.extension === 'gif'
        ? [{ name: 'GIF 图片', extensions: ['gif'] }]
        : info.extension === 'mp4'
          ? [{ name: 'MP4 视频', extensions: ['mp4'] }]
          : [{ name: 'WebM 视频', extensions: ['webm'] }]
    const options: Electron.SaveDialogOptions = {
      title: info.mode === 'gif' ? '保存 GIF' : '保存视频',
      defaultPath: join(defaultDir, info.fileName),
      filters
    }
    const result = this.previewWindow
      ? await dialog.showSaveDialog(this.previewWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    const sourcePath = info.filePath
    if (sourcePath !== result.filePath) {
      try {
        renameSync(sourcePath, result.filePath)
      } catch {
        // 跨磁盘时 rename 会失败，退化为复制后删除源文件，保证默认位置不保留副本。
        copyFileSync(sourcePath, result.filePath)
        try {
          unlinkSync(sourcePath)
        } catch (error) {
          console.warn('PREVIEW_SOURCE_DELETE_FAILED', error)
        }
      }
    }
    // 用户可能把目标选成同一个临时路径；无论是否移动，都不能再让 cleanupTemp 删除它。
    this.allowedFiles.delete(sourcePath)
    this.readableFiles.delete(sourcePath)
    this.readableFiles.add(result.filePath)
    info.filePath = result.filePath
    info.fileName = basename(result.filePath)
    info.mediaUrl = this.mediaUrl(result.filePath)
    info.sizeBytes = statSync(result.filePath).size
    notify(`已保存：${result.filePath}`)
    return result.filePath
  }

  previewCopy(): string {
    const info = this.previewInfo
    if (!info) throw new Error('没有可复制的录制结果')
    if (info.mode !== 'gif') {
      throw new Error('视频不支持复制到剪贴板，请使用保存')
    }
    const image = this.gifFirstFrameDataUrl
      ? nativeImage.createFromDataURL(this.gifFirstFrameDataUrl)
      : nativeImage.createFromPath(info.filePath)
    if (image.isEmpty()) throw new Error('无法读取 GIF 首帧')
    clipboard.writeImage(image)
    return '已复制 GIF 首帧到剪贴板'
  }

  previewRetry(): void {
    const overlayId = this.overlayId
    this.closePreviewWindow()
    this.cleanupTemp()
    if (!overlayId) {
      this.host.hideOverlay()
      return
    }
    this.host.setOverlayRecordingMode(overlayId, false, true)
    this.sendOverlay({ type: 'retry' })
  }

  previewClose(): void {
    this.closePreviewWindow()
    this.cleanupTemp()
    this.host.hideOverlay()
    this.overlayId = null
  }

  previewOpenFolder(): void {
    if (this.previewInfo) void shell.openPath(this.previewInfo.filePath)
  }

  isAllowedFile(path: string): boolean {
    return this.readableFiles.has(path)
  }

  destroyAll(): void {
    this.clearBeginTimer()
    this.clearStartTimer()
    this.clearEmergencyCancel()
    this.closeControlWindow()
    this.closePreviewWindow()
    this.cleanupTemp()
  }

  private sendOverlay(command: RecorderCommand): void {
    if (this.overlayId === null) return
    webContents.fromId(this.overlayId)?.send('overlay:recorder-command', command)
  }

  private restoreOverlay(): void {
    if (this.overlayId === null) return
    this.host.setOverlayRecordingMode(this.overlayId, false, true)
    this.overlayId = null
  }

  private async getSourceId(displayId: number): Promise<string> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false
    })
    const source = sources.find((item) => item.display_id === String(displayId)) ?? sources[0]
    if (!source) throw new Error('没有可用的屏幕录制源，请检查屏幕录制权限')
    return source.id
  }

  private openControlWindow(): void {
    const state = this.state
    const bounds = this.displayBounds
    const selection = this.selection
    if (!state || !bounds || !selection) return
    const display = screen.getDisplayMatching({
      x: bounds.x + selection.x,
      y: bounds.y + selection.y,
      width: selection.width,
      height: selection.height
    })
    const work = display.workArea
    const width = controlWidth(state.mode)
    const verticalPadding = (CONTROL_HEIGHT - CAPSULE_HEIGHT) / 2
    let x = Math.round(display.bounds.x + selection.x + selection.width / 2 - width / 2)
    let y = Math.round(
      display.bounds.y + selection.y + selection.height + CONTROL_GAP - verticalPadding
    )
    if (y + CONTROL_HEIGHT > work.y + work.height - 8) {
      y = Math.round(
        display.bounds.y +
          selection.y -
          CONTROL_GAP -
          CAPSULE_HEIGHT -
          verticalPadding
      )
    }
    x = Math.max(work.x + 8, Math.min(x, work.x + work.width - width - 8))
    y = Math.max(work.y + 8, Math.min(y, work.y + work.height - CONTROL_HEIGHT - 8))

    const window = new BrowserWindow({
      x,
      y,
      width,
      height: CONTROL_HEIGHT,
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
      show: false,
      focusable: true,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    })
    this.controlWindow = window
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setContentProtection(true)
    window.setMenuBarVisibility(false)
    if (process.platform === 'darwin') {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }
    window.on('closed', () => {
      if (this.controlWindow === window) this.controlWindow = null
    })
    loadRoute(window, 'recorder-control')
    window.webContents.once('did-finish-load', () => {
      if (
        !window.isDestroyed() &&
        this.state &&
        (this.state.phase === 'preparing' ||
          this.state.phase === 'countdown' ||
          this.state.phase === 'recording' ||
          this.state.phase === 'paused' ||
          this.state.phase === 'encoding') &&
        !window.isVisible()
      ) {
        window.showInactive()
        window.moveTop()
      }
    })
  }

  private showPreview(info: RecorderPreviewInfo): void {
    this.closeControlWindow()
    // 结果卡出现后录制会话结束，F1 应立即开始新的截图，而不是关闭旧覆盖层。
    this.state = null
    this.previewInfo = info
    if (this.overlayId !== null) {
      // 预览期间隐藏覆盖层；重录时再显示并复用原选区。
      this.host.hideRecordingOverlay(this.overlayId)
    }
    const targetDisplay =
      this.displayBounds && this.selection
        ? screen.getDisplayMatching({
            x: this.displayBounds.x + this.selection.x,
            y: this.displayBounds.y + this.selection.y,
            width: this.selection.width,
            height: this.selection.height
          })
        : screen.getPrimaryDisplay()
    const work = targetDisplay.workArea
    const width = 300
    const height = 156
    const x = work.x + work.width - width - 16
    const y = work.y + work.height - height - 16
    const window = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      title: '录制完成',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // 结果卡失焦后仍要继续播放 GIF 动图，不能被 Chromium 后台节流暂停。
        backgroundThrottling: false
      }
    })
    this.previewWindow = window
    this.closingPreview = false
    window.setAlwaysOnTop(true, 'floating')
    window.setMenuBarVisibility(false)
    window.on('closed', () => {
      if (this.previewWindow === window) this.previewWindow = null
      if (this.closingPreview) {
        this.closingPreview = false
        return
      }
      this.cleanupTemp()
      this.host.hideOverlay()
      this.overlayId = null
    })
    loadRoute(window, 'record-preview')
    window.once('ready-to-show', () => {
      window.show()
      window.focus()
    })
    window.webContents.once('did-finish-load', () => {
      if (!window.isDestroyed() && !window.isVisible()) {
        window.show()
        window.focus()
      }
    })
  }

  private mediaUrl(filePath: string): string {
    return `snapglass-media://local?path=${encodeURIComponent(filePath)}`
  }

  private async finishVideoStream(): Promise<void> {
    const stream = this.videoStream
    this.videoStream = null
    if (!stream) return
    if (stream.closed) return
    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject)
      stream.end(() => resolve())
    })
  }

  private closeControlWindow(): void {
    if (this.controlWindow && !this.controlWindow.isDestroyed()) {
      this.controlWindow.destroy()
    }
    this.controlWindow = null
  }

  private clearBeginTimer(): void {
    if (this.beginTimer) {
      clearTimeout(this.beginTimer)
      this.beginTimer = null
    }
  }

  /**
   * 背景：倒计时结束后如果视频写入或编码初始化卡住，界面会停在“0”且控制条不可用。
   * 设计意图：从进入倒计时开始计时，12 秒内没有进入 recording 就主动中止。
   * 关键约束：只负责兜底；正常进入 recording 后立即清除，不能影响长录制。
   */
  private ensureStartTimer(): void {
    if (this.startTimer) return
    this.startTimer = setTimeout(() => {
      this.startTimer = null
      console.error('RECORDER_START_TIMEOUT')
      logDiagnostic('recorder', 'START_TIMEOUT 12s')
      this.abortWithMessage('录制启动超时，已退出')
    }, 12_000)
  }

  private clearStartTimer(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer)
      this.startTimer = null
    }
  }

  /**
   * 背景：启动超时或全局 Esc 时，渲染层可能已失去响应。
   * 设计意图：不回到编辑态，直接取消会话并隐藏覆盖层，优先把桌面还给用户。
   * 关键约束：清理临时文件、控制窗、录制锁和 Esc，避免留下半截会话。
   */
  private abortWithMessage(message: string): void {
    logDiagnostic('recorder', `ABORT ${message}`)
    this.sendOverlay({ type: 'cancel' })
    this.abortSession()
    this.host.hideOverlay()
    notify(message)
  }

  /**
   * 背景：全屏录制时覆盖层会降为 floating，控制条在最上层；如果焦点跑到桌面，
   * 渲染层收不到 Esc，用户会以为应用没反应。
   * 设计意图：录制会话期间占用系统级 Esc，直接取消会话并隐藏覆盖层，
   * 不依赖渲染线程是否还能处理键盘事件。
   * 关键约束：只在录制会话期间注册，结束/失败/取消/销毁时必须释放。
   */
  private registerEmergencyCancel(): void {
    this.clearEmergencyCancel()
    try {
      const ok = globalShortcut.register('Escape', () => {
        console.log('RECORDER_ESCAPE_CANCEL')
        logDiagnostic('recorder', 'ESCAPE_CANCEL')
        this.abortWithMessage('录制已取消')
      })
      if (ok) this.escapeRegistered = true
      else console.warn('RECORDER_ESCAPE_SHORTCUT_FAILED')
    } catch (error) {
      console.warn('RECORDER_ESCAPE_SHORTCUT_ERROR', error)
    }
  }

  private clearEmergencyCancel(): void {
    if (!this.escapeRegistered) return
    this.escapeRegistered = false
    if (globalShortcut.isRegistered('Escape')) {
      globalShortcut.unregister('Escape')
    }
  }

  private closePreviewWindow(): void {
    const window = this.previewWindow
    if (!window) return
    this.closingPreview = true
    this.previewWindow = null
    if (!window.isDestroyed()) window.destroy()
  }

  private cleanupTemp(): void {
    if (this.videoStream) {
      this.videoStream.destroy()
      this.videoStream = null
    }
    for (const path of this.allowedFiles) {
      try {
        unlinkSync(path)
      } catch {
        // ignore
      }
    }
    this.allowedFiles.clear()
    this.readableFiles.clear()
    this.videoPath = ''
    this.videoMeta = null
    this.gifFirstFrameDataUrl = ''
    this.previewInfo = null
  }
}
