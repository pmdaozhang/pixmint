import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  net,
  nativeTheme,
  protocol,
  screen,
  session,
  shell,
  Tray
} from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  DisplayCapture,
  GifDoneMeta,
  OverlayCompletePayload,
  RecorderBeginPayload,
  RecorderControlCommand,
  RecorderMode,
  RecorderStatePatch,
  Settings,
  VideoDoneMeta
} from '../shared/types'
import { copyImageBytes, imageFromBytes, notify, saveImageBytes } from './image-utils'
import { SettingsStore } from './settings-store'
import { SecretStore } from './secret-store'
import { createTray } from './tray'
import { OverlayManager } from './windows/overlay'
import { PinManager } from './windows/pin'
import { OcrManager } from './windows/ocr'
import { WindowSnapHelper } from './window-snap'
import { createPlatformServices, type PlatformServices } from './platform'
import { createSettingsWindow } from './windows/settings-window'
import { createOnboardingWindow } from './windows/onboarding-window'
import { loadRoute } from './windows/load'
import { StatusToast } from './windows/status-toast'
import { FAKE_SCREEN_PNG } from './test-fixture'
import { recognizeImageDataUrl } from './ocr'
import { translateText } from '../shared/translation'
import { RecorderManager } from './recording'
import { enableSafeMode, hasUncleanSession, safeModeRequested } from './safe-mode'
import { addBreadcrumb } from './breadcrumbs'
import {
  crashReportsDirectory,
  getCrashReportSummary,
  installCrashHandlers
} from './crash-report'
import {
  ensureDiagnosticsDirectory,
  diagnosticsPath,
  flushDiagnosticsSync,
  logDiagnostic
} from './diagnostics'
import { writeDiagnosticsExport } from './diagnostics-export'
import { installWebContentsSecurity, isTrustedAppUrl } from './security'
import { withTimeout } from '../shared/async'
import { startMetricsSampling, stopMetricsSampling } from './metrics'
import { disposeUpdater, initUpdater } from './updater'
import { longCaptureManager } from './long-capture'
import { LongCaptureController } from './long-capture-controller'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'snapglass-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
])

/**
 * 背景：沙箱/便携环境可能禁止写 AppData，但测试和现场诊断仍需要 userData。
 * 设计意图：允许通过环境变量显式指定数据目录，不改变默认安装行为。
 * 关键约束：必须在读取 safe-mode、settings、diagnostics 之前设置；目录不可写时仍交给上层报错。
 */
const userDataOverride = process.env.PIXMINT_USER_DATA_DIR?.trim()
if (userDataOverride) {
  mkdirSync(userDataOverride, { recursive: true })
  app.setPath('userData', userDataOverride)
  app.setPath('sessionData', userDataOverride)
}

const hadUncleanSession = hasUncleanSession()
if (hadUncleanSession) {
  enableSafeMode('上次截图/录制会话未正常结束')
}
const safeModeThisRun = safeModeRequested() || hadUncleanSession
installCrashHandlers()
addBreadcrumb('app', 'boot', {
  safeMode: safeModeThisRun,
  platform: process.platform,
  arch: process.arch
})
if (process.platform === 'win32') {
  // MediaRecorder 的硬件 H.264 编码在部分 NVIDIA 驱动上会卡死整个桌面；
  // 软件编码牺牲一点 CPU，换取录制不再把系统拖入无响应。
  app.commandLine.appendSwitch('disable-accelerated-video-encode')
}
if (safeModeThisRun) {
  // 兼容模式彻底关闭 GPU 合成，透明全屏覆盖层和录制编码都走软件路径。
  app.disableHardwareAcceleration()
}
const isSmokeTest = process.argv.includes('--smoke-test')
const isCaptureSmoke = process.argv.includes('--smoke-capture')
const isOverlaySmoke = process.argv.includes('--smoke-overlay')
const isShowSettings = process.argv.includes('--show-settings')
const isOcrSmoke = process.argv.includes('--smoke-ocr')
const isOverlayOcrSmoke = process.argv.includes('--smoke-overlay-ocr')
const isSettingsE2e = process.argv.includes('--e2e-settings')
const isOnboardingE2e = process.argv.includes('--e2e-onboarding')
const isOcrTranslateSmoke = process.argv.includes('--smoke-ocr-translate')
const isPrepareSmoke = process.argv.includes('--smoke-prepare')
const isFastCaptureSmoke = process.argv.includes('--smoke-fast-capture')
const isLongCaptureSmoke = process.argv.includes('--smoke-long-capture')
const isLongCaptureUiSmoke = process.argv.includes('--smoke-long-capture-ui')
const isLongCaptureManualSmoke = process.argv.includes('--smoke-long-capture-manual')
const ocrFileArgIndex = process.argv.indexOf('--smoke-ocr-file')
const statusToast = new StatusToast()
const ocrFileSmokePath = ocrFileArgIndex >= 0 ? process.argv[ocrFileArgIndex + 1] ?? '' : ''
const isOcrFileSmoke = Boolean(ocrFileSmokePath)
const isSoakOcr = process.argv.includes('--soak-ocr')
const isCaptureOnce = process.argv.includes('--capture-once')
const isDebugTrayMenu = process.argv.includes('--debug-tray-menu')

let settingsStore: SettingsStore
let secretStore: SecretStore
let overlayManager: OverlayManager
let pinManager: PinManager
let ocrManager: OcrManager
let recorderManager: RecorderManager
let longCaptureController: LongCaptureController
let windowSnap: WindowSnapHelper
let platformServices: PlatformServices
let tray: Tray | null = null
let preloadPath = ''
let overlayReadyCount = 0

function formatStamp(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')
}

function applySystemSettings(): void {
  const settings = settingsStore.get()
  nativeTheme.themeSource = settings.theme
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
  registerShortcut(settings)
}

function registerShortcut(settings: Settings): void {
  globalShortcut.unregisterAll()
  try {
    const ok = globalShortcut.register(settings.shortcut, () => {
      void startCapture()
    })
    if (!ok) notify(`快捷键 ${settings.shortcut} 注册失败，可能已被占用`)
  } catch {
    notify(`快捷键 ${settings.shortcut} 无效`)
  }
  try {
    globalShortcut.register('F2', () => {
      void startCapture('gif')
    })
  } catch {
    // F2 被占用时不影响主截图快捷键
  }
  try {
    globalShortcut.register('F4', () => {
      void startCapture('video')
    })
  } catch {
    // F4 被占用时不影响主截图快捷键
  }
}

async function startCapture(mode?: RecorderMode): Promise<void> {
  const triggered = Date.now()
  addBreadcrumb('capture', 'start', { mode: mode ?? 'screenshot' })
  if (!overlayManager) return
  ocrManager?.closeAll()
  if (recorderManager?.isRecordingSession()) return
  if (overlayManager.isActive()) {
    overlayManager.hideAll()
    return
  }
  // 结果卡还开着时按 F1，先结束上一次录制结果，再立刻开始新的截图。
  recorderManager?.previewClose()
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    await overlayManager.prepare({
      id: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor
    })
    const started = Date.now()
    const fast = await platformServices.capture.captureFast(display)
    console.log('CAPTURE_KIND', fast ? 'fast' : 'fallback')
    const capture =
      fast ??
      (await withTimeout(
        platformServices.capture.captureDisplay(display),
        5000,
        '截图超时，请检查屏幕录制权限'
      ))
    console.log('CAPTURE_MS', Date.now() - started)
    addBreadcrumb('capture', 'captured', {
      fast: Boolean(fast),
      durationMs: Date.now() - started
    })
    // 截完图后再关闭托盘菜单：冻结画面里保留菜单内容，同时把焦点让给覆盖层。
    tray?.closeContextMenu()
    await overlayManager.start(capture, mode)
    console.log('START_CAPTURE_TOTAL_MS', Date.now() - triggered)
  } catch (error) {
    overlayManager?.hideAll()
    const message = error instanceof Error ? error.message : String(error)
    addBreadcrumb('capture', 'failed', { message })
    if (isFastCaptureSmoke) {
      console.error('CAPTURE_FAILED', message)
    } else {
      dialog.showErrorBox('截图失败', message)
    }
  }
}

async function handleOverlayComplete(
  payload: OverlayCompletePayload,
  capture: DisplayCapture
): Promise<void> {
  if (payload.action === 'long') {
    void longCaptureController.start(payload)
    return
  }
  const image = imageFromBytes(payload.pngBytes)
  if (image.isEmpty()) return
  addBreadcrumb('action', payload.action, {
    width: payload.selection.width,
    height: payload.selection.height
  })
  if (payload.action === 'copy') {
    copyImageBytes(payload.pngBytes)
    notify('已复制到剪贴板')
    return
  }
  if (payload.action === 'save') {
    const result = await dialog.showSaveDialog({
      title: '保存截图',
      defaultPath: join(app.getPath('pictures'), `Pixmint-${formatStamp()}.png`),
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    })
    if (!result.canceled && result.filePath) {
      saveImageBytes(payload.pngBytes, result.filePath)
      notify(`已保存：${result.filePath}`)
    }
    return
  }
  if (payload.action === 'ocr') {
    let toastTimer: ReturnType<typeof setTimeout> | null = null
    try {
      // 快速识别不闪 toast；超过 150ms 才提示，避免短任务频繁闪窗。
      toastTimer = setTimeout(() => statusToast.show('识别中...'), 150)
      const result = await platformServices.ocr.recognizeDataUrl(
        imageFromBytes(payload.pngBytes).toDataURL()
      )
      if (toastTimer) clearTimeout(toastTimer)
      statusToast.hide()
      const settings = settingsStore.get()
      ocrManager.open({
        text: result.text,
        lines: result.lines,
        mode: payload.autoTranslate ? 'translate' : 'ocr',
        autoTranslate: payload.autoTranslate === true,
        settings: { ...settings, hasTranslationKey: secretStore.hasTranslationKey() },
        hasTranslationKey: secretStore.hasTranslationKey()
      })
    } catch (error) {
      if (toastTimer) clearTimeout(toastTimer)
      statusToast.hide()
      const message = error instanceof Error ? error.message : String(error)
      dialog.showErrorBox('OCR 失败', message)
    }
    return
  }
  if (payload.action === 'pin') {
    pinManager.create(payload.pngBytes, payload.selection.width, payload.selection.height, {
      x: capture.bounds.x + payload.selection.x,
      y: capture.bounds.y + payload.selection.y
    })
  }
}

function registerIpc(): void {
  ipcMain.handle('overlay:ready', (event) => {
    overlayReadyCount += 1
    const capture = overlayManager.captureFor(event.sender.id)
    return capture ? { ...capture, settings: settingsStore.get() } : null
  })
  ipcMain.on('overlay:renderer-ready', (event) => {
    overlayManager.markRendererReady(event.sender.id)
  })
  ipcMain.on('overlay:prepared', (event) => {
    overlayManager.markPrepared(event.sender.id)
  })
  ipcMain.on('overlay:heartbeat', (event) => {
    overlayManager.noteHeartbeat(event.sender.id)
  })
  ipcMain.handle('overlay:window-at', async (_event, x: number, y: number) => {
    const pointX = Number(x)
    const pointY = Number(y)
    if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) return null
    const physical = screen.dipToScreenPoint({ x: pointX, y: pointY })
    const rect = await platformServices.windowQuery.query(physical.x, physical.y)
    if (!rect) return null
    return screen.screenToDipRect(null, rect)
  })
  ipcMain.on('overlay:auto-copy', (event, pngBytes: Uint8Array) => {
    if (!overlayManager.captureFor(event.sender.id)) return
    const image = imageFromBytes(pngBytes)
    if (!image.isEmpty()) clipboard.writeImage(image)
  })
  ipcMain.on('overlay:complete', (event, payload: OverlayCompletePayload) => {
    overlayManager.complete(payload, event.sender.id)
  })
  ipcMain.on('overlay:cancel', () => overlayManager.cancel())

  ipcMain.handle('recorder:begin', (event, payload: RecorderBeginPayload) => {
    const capture = overlayManager.captureFor(event.sender.id)
    if (!capture) throw new Error('截图会话已结束，请重新截图')
    return recorderManager.begin(event.sender.id, payload, capture.bounds)
  })
  ipcMain.on('recorder:state', (_event, patch: RecorderStatePatch) => {
    recorderManager.updateState(patch)
  })
  ipcMain.on('recorder:gif-done', (_event, bytes: Uint8Array, meta: GifDoneMeta) => {
    recorderManager.gifDone(bytes, meta)
  })
  ipcMain.handle('recorder:video-begin', (_event, meta: VideoDoneMeta) => {
    return recorderManager.videoBegin(meta)
  })
  ipcMain.on('recorder:video-chunk', (_event, chunk: ArrayBuffer) => {
    recorderManager.videoChunk(chunk)
  })
  ipcMain.on('recorder:video-done', (_event, meta: VideoDoneMeta) => {
    void recorderManager.videoDone(meta)
  })
  ipcMain.on('recorder:video-failed', (_event, message: string) => {
    recorderManager.failed(message)
  })
  ipcMain.on('recorder:dismiss', () => recorderManager.dismiss())
  ipcMain.handle('recorder:control-ready', () => recorderManager.controlReady())
  ipcMain.on('recorder:control-command', (_event, command: RecorderControlCommand) => {
    recorderManager.controlCommand(command)
  })
  ipcMain.handle('recorder:preview-ready', () => recorderManager.previewReady())
  ipcMain.handle('recorder:preview-read', () => recorderManager.previewRead())
  ipcMain.handle('recorder:preview-save', () => recorderManager.previewSave())
  ipcMain.handle('recorder:preview-copy', () => recorderManager.previewCopy())
  ipcMain.on('recorder:preview-retry', () => recorderManager.previewRetry())
  ipcMain.on('recorder:preview-close', () => recorderManager.previewClose())
  ipcMain.on('recorder:preview-open-folder', () => recorderManager.previewOpenFolder())

  ipcMain.handle('long-capture:state', () => longCaptureManager.getProgress())
  ipcMain.on('long-capture:pause', () => longCaptureController.pause())
  ipcMain.on('long-capture:resume', () => longCaptureController.resume())
  ipcMain.on('long-capture:finish', () => longCaptureController.finish())
  ipcMain.on('long-capture:cancel', () => longCaptureController.cancel())
  ipcMain.on('long-capture:manual', () => longCaptureController.manual())
  ipcMain.handle('long-capture:preview-info', () => longCaptureController.previewInfo())
  ipcMain.handle('long-capture:save-preview', () => longCaptureController.savePreview())
  ipcMain.handle('long-capture:copy-preview', () => longCaptureController.copyPreview())
  ipcMain.on('long-capture:close-preview', () => longCaptureController.closePreview())

  ipcMain.handle('pin:ready', (event) => pinManager.initFor(event.sender.id))
  ipcMain.on('pin:close', (event) => pinManager.close(event.sender.id))
  ipcMain.handle('pin:copy', (event) => {
    pinManager.copy(event.sender.id)
  })
  ipcMain.handle('pin:save', (event) => pinManager.save(event.sender.id))
  ipcMain.handle('pin:set-edit-mode', (event, active: boolean) =>
    pinManager.setEditMode(event.sender.id, active)
  )
  ipcMain.handle('pin:commit-edit', (event, imageBytes: Uint8Array) =>
    pinManager.commitEdit(event.sender.id, imageBytes)
  )
  ipcMain.handle('pin:set-opacity', (event, value: number) =>
    pinManager.setOpacity(event.sender.id, value)
  )
  ipcMain.handle('pin:toggle-ignore', (event) => pinManager.toggleIgnoreMouse(event.sender.id))
  ipcMain.handle('pin:zoom', (event, direction: 1 | -1) =>
    pinManager.zoom(event.sender.id, direction)
  )
  ipcMain.on('pin:drag-start', (event) => {
    pinManager.dragStart(event.sender.id)
  })
  ipcMain.on('pin:drag-move', (event, dx: number, dy: number) => {
    pinManager.dragMove(event.sender.id, dx, dy)
  })
  ipcMain.on('pin:drag-end', (event) => pinManager.dragEnd(event.sender.id))
  ipcMain.on('pin:context-menu', (event) => pinManager.contextMenu(event.sender.id))

  ipcMain.handle('settings:get', () => ({
    ...settingsStore.get(),
    hasTranslationKey: secretStore.hasTranslationKey()
  }))
  ipcMain.handle('settings:update', (_event, patch: Partial<Settings>) => {
    const { hasTranslationKey: _ignored, ...rest } = patch
    const next = settingsStore.update(rest)
    applySystemSettings()
    return { ...next, hasTranslationKey: secretStore.hasTranslationKey() }
  })
  ipcMain.handle('settings:set-translation-key', (_event, key: string) =>
    secretStore.setTranslationKey(key)
  )
  ipcMain.on('settings:open-window', () => createSettingsWindow(preloadPath))

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('diagnostics:info', () => {
    const summary = getCrashReportSummary()
    return {
      version: app.getVersion(),
      platform: process.platform,
      logPath: diagnosticsPath(),
      crashReportsDir: crashReportsDirectory(),
      crashReportCount: summary.count,
      latestCrashFile: summary.latestFile,
      latestCrashAt: summary.latestAt,
      safeMode: safeModeRequested()
    }
  })
  ipcMain.handle('diagnostics:open-log-folder', () =>
    shell.openPath(ensureDiagnosticsDirectory())
  )
  ipcMain.handle('diagnostics:open-crash-folder', () => {
    const dir = crashReportsDirectory()
    mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })
  ipcMain.handle('diagnostics:flush', () => {
    flushDiagnosticsSync()
  })
  ipcMain.handle('diagnostics:export-report', async () => {
    const result = await dialog.showSaveDialog({
      title: '导出诊断报告',
      defaultPath: join(
        app.getPath('documents'),
        `Pixmint-diagnostics-${formatStamp()}.json`
      ),
      filters: [{ name: 'JSON 诊断报告', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    writeDiagnosticsExport(result.filePath, settingsStore.get())
    return result.filePath
  })

  ipcMain.handle('ocr:ready', (event) => ocrManager.initFor(event.sender.id))
  ipcMain.on('ocr:close', (event) => ocrManager.close(event.sender.id))
  ipcMain.on('ocr:open-settings', () => ocrManager.openSettings())
  ipcMain.on('ocr:resize', (event, height: number) => ocrManager.resize(event.sender.id, height))

  ipcMain.handle(
    'translation:translate',
    async (_event, text: string, target?: 'zh-CN' | 'en-US') => {
    const settings = settingsStore.get()
    const effective = target ? { ...settings, translationTarget: target } : settings
    const key = secretStore.getTranslationKey()
    if (settings.translationProvider !== 'free' && !key) {
      throw new Error('未配置翻译 API Key，请先在设置页配置')
    }
    return translateText(
      String(text).slice(0, 5000),
      effective,
      key ?? '',
      net.fetch.bind(net) as typeof fetch
    )
    }
  )
  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    clipboard.writeText(String(text))
  })
}

function initServices(): void {
  settingsStore = new SettingsStore()
  secretStore = new SecretStore()
  preloadPath = join(__dirname, '../preload/index.js')
  pinManager = new PinManager(preloadPath)
  ocrManager = new OcrManager(preloadPath, () => createSettingsWindow(preloadPath))
  windowSnap = new WindowSnapHelper()
  platformServices = createPlatformServices(windowSnap)
  overlayManager = new OverlayManager(
    preloadPath,
    () => settingsStore.get(),
    (payload, capture) => {
      void handleOverlayComplete(payload, capture)
    },
    () => {},
    (message) => {
      recorderManager?.abortSession()
      if (message) notify(message)
    }
  )
  recorderManager = new RecorderManager(preloadPath, {
    setOverlayRecordingMode: (id, active, interactive) =>
      overlayManager.setRecordingMode(id, active, interactive),
    hideRecordingOverlay: (id) => overlayManager.hideRecordingOverlay(id),
    hideOverlay: () => overlayManager.hideAll()
  })
  longCaptureController = new LongCaptureController(preloadPath, longCaptureManager)
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    if (!isTrustedAppUrl(contents.getURL())) {
      callback(false)
      return
    }
    callback(permission === 'media' || permission === 'display-capture')
  })
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
    if (!contents || !isTrustedAppUrl(requestingOrigin || contents.getURL())) return false
    const name = String(permission)
    return name === 'media' || name === 'display-capture'
  })
  protocol.handle('snapglass-media', (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.searchParams.get('path') ?? '')
    if (
      !filePath ||
      (!recorderManager.isAllowedFile(filePath) &&
        !longCaptureManager.isAllowedFile(filePath))
    ) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
  platformServices.capture.prewarm()
  platformServices.windowQuery.prewarm()
  registerIpc()
  applySystemSettings()
  initUpdater()
  app.on('web-contents-created', (_event, contents) => {
    installWebContentsSecurity(contents)
    contents.on('console-message', (event) => {
      // 高频 info 日志会放大磁盘和主进程开销，只保留 warning/error 作为诊断信号。
      if (event.level === 'error') {
        logDiagnostic('renderer', `${event.level}: ${event.message}`, 'error')
      } else if (event.level === 'warning') {
        logDiagnostic('renderer', `${event.level}: ${event.message}`, 'warn')
      }
    })
  })
  logDiagnostic('main', `Pixmint ${app.getVersion()} started`)
  console.log('DIAGNOSTICS_LOG', diagnosticsPath())
  if (safeModeThisRun) {
    notify('上次截图/录制异常退出，已启用兼容模式')
  }
}

function openStartupWindow(): void {
  if (!preloadPath) return
  if (!settingsStore.get().onboardingCompleted) {
    createOnboardingWindow(preloadPath)
    settingsStore.update({ onboardingCompleted: true })
    return
  }
  createSettingsWindow(preloadPath)
}

function runSmokeTest(): void {
  const window = new BrowserWindow({
    width: 860,
    height: 660,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  let failed = false
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') {
      failed = true
      console.error('SMOKE_CONSOLE', event.message)
    }
  })
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    failed = true
    console.error('SMOKE_LOAD_FAIL', code, description, url)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    failed = true
    console.error('SMOKE_RENDER_GONE', details.reason, details.exitCode)
  })
  window.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      console.log(failed ? 'SMOKE_FAIL' : 'SMOKE_OK')
      app.exit(failed ? 1 : 0)
    }, 700)
  })
  loadRoute(window, 'settings')
  setTimeout(() => {
    console.error('SMOKE_TIMEOUT')
    app.exit(1)
  }, 12000)
}

async function runCaptureSmoke(): Promise<void> {
  try {
    const captures = await withTimeout(
      platformServices.capture.captureAll(),
      8000,
      '屏幕捕获超时，请检查屏幕录制权限'
    )
    console.log('SMOKE_CAPTURES', captures.length)
    overlayReadyCount = 0
    overlayManager.prewarm(
      captures.map((capture) => ({
        id: capture.displayId,
        bounds: capture.bounds,
        scaleFactor: capture.scaleFactor
      }))
    )
    await overlayManager.start(captures[0])
    await new Promise((resolve) => setTimeout(resolve, 1800))
    console.log('SMOKE_OVERLAY_READY', overlayReadyCount)
    if (overlayReadyCount > 0) {
      console.log('SMOKE_CAPTURE_OK')
      app.exit(0)
    } else {
      console.error('SMOKE_CAPTURE_FAIL')
      app.exit(1)
    }
  } catch (error) {
    console.error('SMOKE_CAPTURE_ERROR', error)
    app.exit(1)
  }
}

function runOverlaySmoke(ocrImage = false): void {
  const display = screen.getPrimaryDisplay()
  const bounds = display.bounds
  let imageDataUrl = FAKE_SCREEN_PNG
  if (ocrImage) {
    const imagePath = join(app.getAppPath(), 'tests', 'fixtures', 'ocr-overlay.png')
    imageDataUrl = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`
  }
  const fake = {
    displayId: display.id,
    bounds,
    scaleFactor: 1,
    imageDataUrl,
    imageWidth: Math.round(bounds.width),
    imageHeight: Math.round(bounds.height)
  }
  console.log('OVERLAY_SMOKE_START', bounds.width, bounds.height)
  overlayManager.prewarm([
    { id: display.id, bounds: display.bounds, scaleFactor: 1 }
  ])
  const show = (): void => {
    ocrManager.closeAll()
    void overlayManager.start(fake)
  }
  ;(globalThis as { __snapglassShowOverlay?: () => void }).__snapglassShowOverlay = show
  ;(
    globalThis as {
      __snapglassOverlayActive?: () => boolean
    }
  ).__snapglassOverlayActive = () => overlayManager.isActive()
  ;(
    globalThis as {
      __snapglassStartCapture?: () => Promise<void>
    }
  ).__snapglassStartCapture = () => startCapture()
  setTimeout(() => {
    show()
  }, 1200)
}

async function runFastCaptureSmoke(): Promise<void> {
  const display = screen.getPrimaryDisplay()
  overlayManager.prewarm([
    { id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor }
  ])
  // 等常驻 PowerShell 助手完成预热，模拟用户启动后按 F1 的状态。
  await new Promise((resolve) => setTimeout(resolve, 1200))
  for (let index = 0; index < 3; index += 1) {
    const started = Date.now()
    await startCapture()
    console.log('SMOKE_START_CAPTURE_MS', index, Date.now() - started)
    await new Promise((resolve) => setTimeout(resolve, 800))
    overlayManager.hideAll()
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  app.exit(0)
}

async function runOcrFileSmoke(filePath: string): Promise<void> {
  try {
    const dataUrl = `data:image/png;base64,${readFileSync(filePath).toString('base64')}`
    const result = await recognizeImageDataUrl(dataUrl)
    console.log('OCR_FILE_TEXT', result.text)
    console.log('OCR_FILE_LINES', JSON.stringify(result.lines))
    app.exit(0)
  } catch (error) {
    console.error('OCR_FILE_ERROR', error)
    app.exit(1)
  }
}

async function runOcrSmoke(mode: 'ocr' | 'translate' = 'ocr'): Promise<void> {
  try {
    const fixture =
      process.env.OCR_SMOKE_FIXTURE ?? join('tests', 'fixtures', 'ocr-word.png')
    const imagePath = join(app.getAppPath(), fixture)
    const dataUrl = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`
    const result = await recognizeImageDataUrl(dataUrl)
    console.log('OCR_SMOKE_TEXT', result.text)
    const settings = settingsStore.get()
    ocrManager.open({
      text: result.text,
      lines: result.lines,
      mode,
      autoTranslate: false,
      settings: { ...settings, hasTranslationKey: secretStore.hasTranslationKey() },
      hasTranslationKey: secretStore.hasTranslationKey()
    })
  } catch (error) {
    console.error('OCR_SMOKE_ERROR', error)
    app.exit(1)
  }
}

async function runOcrSoak(): Promise<void> {
  const rawCount = Number(process.env.PIXMINT_SOAK_OCR_ITERATIONS ?? 100)
  const count = Number.isFinite(rawCount) ? Math.min(1000, Math.max(1, Math.round(rawCount))) : 100
  const imagePath = join(app.getAppPath(), 'tests', 'fixtures', 'ocr-word.png')
  const dataUrl = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`
  const durations: number[] = []
  // PaddleOCR 首次加载模型是固定成本，不计入后续循环的泄漏预算。
  const warmupStarted = Date.now()
  try {
    await recognizeImageDataUrl(dataUrl)
  } catch (error) {
    console.error('SOAK_OCR_WARMUP_ERROR', error)
  }
  const warmupMs = Date.now() - warmupStarted
  console.log('SOAK_OCR_WARMUP_MS', warmupMs)
  const memoryBefore = process.memoryUsage()
  let failures = 0
  for (let index = 0; index < count; index += 1) {
    const started = Date.now()
    try {
      const result = await recognizeImageDataUrl(dataUrl)
      if (!result.text.trim()) failures += 1
    } catch (error) {
      failures += 1
      console.error('SOAK_OCR_ITERATION_ERROR', index, error)
    }
    durations.push(Date.now() - started)
    if ((index + 1) % 10 === 0) {
      console.log('SOAK_OCR_PROGRESS', index + 1, count)
    }
  }
  const memoryAfter = process.memoryUsage()
  const processes = app.getAppMetrics().map((metric) => ({
    type: metric.type,
    pid: metric.pid,
    cpuPercent: metric.cpu.percentCPUUsage,
    workingSetKb: metric.memory.workingSetSize
  }))
  console.log(
    'SOAK_OCR_RESULT',
    JSON.stringify({
      iterations: count,
      warmupMs,
      failures,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      maxMs: durations.length ? Math.max(...durations) : 0,
      memoryBefore,
      memoryAfter,
      processes
    })
  )
  app.exit(failures === 0 ? 0 : 1)
}

function percentile(values: number[], target: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((target / 100) * sorted.length) - 1)
  )
  return sorted[index]
}

function runPrepareSmoke(): void {
  const display = screen.getPrimaryDisplay()
  const info = {
    id: display.id,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor
  }
  const fake = {
    displayId: display.id,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor,
    imageDataUrl: FAKE_SCREEN_PNG,
    imageWidth: Math.round(display.bounds.width),
    imageHeight: Math.round(display.bounds.height)
  }
  overlayManager.prewarm([info])
  setTimeout(() => overlayManager.prepare(info), 900)
  setTimeout(() => {
    void overlayManager.start(fake)
  }, 2600)
}

async function runLongCaptureSmoke(): Promise<void> {
  if (app.isPackaged) {
    console.error('LONG_CAPTURE_SMOKE_PACKAGED_UNSUPPORTED')
    app.exit(1)
    return
  }
  const fixturePath = join(app.getAppPath(), 'scripts', 'long-capture-fixture.cjs')
  const electronPath = join(
    app.getAppPath(),
    'node_modules',
    'electron',
    'dist',
    'electron.exe'
  )
  const fixture = spawn(electronPath, [fixturePath], { stdio: 'ignore' })
  const smokePath = join(app.getAppPath(), 'test-results', 'long-capture-smoke.json')
  const progressLog: unknown[] = []
  const targetLog: string[] = []
  const startedAt = Date.now()
  const memoryBefore = process.memoryUsage()
  const maxHeight = Number(process.env.PIXMINT_LONG_MAX_HEIGHT || 0) || undefined
  const writeSmoke = (value: unknown): void => {
    try {
      mkdirSync(dirname(smokePath), { recursive: true })
      writeFileSync(smokePath, JSON.stringify(value, null, 2), 'utf8')
    } catch {
      // smoke 报告写入失败不应改变测试结果
    }
  }
  writeSmoke({ ok: false, stage: 'started', at: new Date().toISOString() })
  try {
    // 等独立 fixture 窗口完成创建、定位和首帧绘制。
    await new Promise((resolve) => setTimeout(resolve, 2200))
    const display = screen.getPrimaryDisplay()
    // fixture 外框 y=80，标题栏/菜单约 58px，页面视口从 y=138 开始，高 535。
    const selection = { x: 100, y: 138, width: 700, height: 535 }
    const result = await longCaptureManager.start({
      display,
      selection,
      maxHeight,
      onProgress: (progress) => {
        progressLog.push(progress)
        console.log('LONG_CAPTURE_PROGRESS', JSON.stringify(progress))
      },
      onComplete: (value) => {
        writeSmoke({
          ok: true,
          result: value,
          progress: progressLog,
          targets: targetLog,
          durationMs: Date.now() - startedAt,
          encodeMs: longCaptureManager.getLastEncodeMs(),
          memoryBefore,
          memoryAfter: process.memoryUsage()
        })
        console.log(
          'LONG_CAPTURE_RESULT',
          JSON.stringify({
            ...value,
            durationMs: Date.now() - startedAt,
            encodeMs: longCaptureManager.getLastEncodeMs()
          })
        )
      },
      onError: (message) => {
        writeSmoke({ ok: false, error: message, progress: progressLog, targets: targetLog })
        console.error('LONG_CAPTURE_ERROR', message)
      },
      onTarget: (target) => targetLog.push(target.title)
    })
    if (!result || result.height <= selection.height) {
      writeSmoke({
        ok: false,
        stage: 'result',
        result,
        progress: progressLog,
        targets: targetLog
      })
      console.error('LONG_CAPTURE_SMOKE_FAIL', JSON.stringify(result))
      app.exit(1)
      return
    }
    console.log(
      'LONG_CAPTURE_SMOKE_OK',
      result.width,
      result.height,
      result.bytes,
      result.filePath
    )
    app.exit(0)
  } catch (error) {
    writeSmoke({
      ok: false,
      stage: 'exception',
      error: error instanceof Error ? error.message : String(error),
      progress: progressLog,
      targets: targetLog
    })
    console.error('LONG_CAPTURE_SMOKE_ERROR', error)
    app.exit(1)
  } finally {
    fixture.kill()
  }
}

async function runLongCaptureSmokeUi(): Promise<void> {
  if (app.isPackaged) {
    console.error('LONG_CAPTURE_UI_SMOKE_PACKAGED_UNSUPPORTED')
    app.exit(1)
    return
  }
  const fixturePath = join(app.getAppPath(), 'scripts', 'long-capture-fixture.cjs')
  const electronPath = join(
    app.getAppPath(),
    'node_modules',
    'electron',
    'dist',
    'electron.exe'
  )
  const fixture = spawn(electronPath, [fixturePath], { stdio: 'ignore' })
  const reportPath = join(
    app.getAppPath(),
    'test-results',
    'long-capture-ui-smoke.json'
  )
  const writeReport = (value: unknown): void => {
    try {
      mkdirSync(dirname(reportPath), { recursive: true })
      writeFileSync(reportPath, JSON.stringify(value, null, 2), 'utf8')
    } catch {
      // smoke 报告失败不应改变测试结果
    }
  }
  writeReport({ ok: false, stage: 'started' })
  try {
    await new Promise((resolve) => setTimeout(resolve, 2200))
    const display = screen.getPrimaryDisplay()
    const selection = { x: 100, y: 138, width: 700, height: 535 }
    await longCaptureController.start({
      action: 'long',
      displayId: display.id,
      selection,
      pngBytes: new Uint8Array(0)
    })
    const result = longCaptureManager.getResult()
    writeReport({ ok: Boolean(result), result })
    // 给 Playwright 留出截取 HUD/预览的时间。
    await new Promise((resolve) => setTimeout(resolve, 8000))
    app.exit(result ? 0 : 1)
  } catch (error) {
    writeReport({
      ok: false,
      stage: 'exception',
      error: error instanceof Error ? error.message : String(error)
    })
    console.error('LONG_CAPTURE_UI_SMOKE_ERROR', error)
    app.exit(1)
  } finally {
    fixture.kill()
  }
}

async function runLongCaptureManualSmoke(): Promise<void> {
  if (app.isPackaged) {
    console.error('LONG_CAPTURE_MANUAL_SMOKE_PACKAGED_UNSUPPORTED')
    app.exit(1)
    return
  }
  const fixturePath = join(app.getAppPath(), 'scripts', 'long-capture-fixture.cjs')
  const electronPath = join(
    app.getAppPath(),
    'node_modules',
    'electron',
    'dist',
    'electron.exe'
  )
  const fixture = spawn(electronPath, [fixturePath], {
    stdio: 'ignore',
    env: { ...process.env, PIXMINT_LONG_FIXTURE_AUTO_SCROLL: '1' }
  })
  const reportPath = join(
    app.getAppPath(),
    'test-results',
    'long-capture-manual-smoke.json'
  )
  const writeReport = (value: unknown): void => {
    try {
      mkdirSync(dirname(reportPath), { recursive: true })
      writeFileSync(reportPath, JSON.stringify(value, null, 2), 'utf8')
    } catch {
      // smoke 报告失败不应改变测试结果
    }
  }
  writeReport({ ok: false, stage: 'started' })
  let finishTimer: ReturnType<typeof setTimeout> | null = null
  try {
    await new Promise((resolve) => setTimeout(resolve, 2200))
    const display = screen.getPrimaryDisplay()
    const selection = { x: 100, y: 138, width: 700, height: 535 }
    const progress: unknown[] = []
    finishTimer = setTimeout(() => longCaptureManager.finish(), 11000)
    const result = await longCaptureManager.startManual({
      display,
      selection,
      onProgress: (value) => {
        progress.push(value)
        console.log('LONG_CAPTURE_MANUAL_PROGRESS', JSON.stringify(value))
      }
    })
    if (finishTimer) clearTimeout(finishTimer)
    writeReport({ ok: Boolean(result), result, progress })
    if (!result || result.height <= selection.height) {
      console.error('LONG_CAPTURE_MANUAL_SMOKE_FAIL', JSON.stringify(result))
      app.exit(1)
      return
    }
    console.log(
      'LONG_CAPTURE_MANUAL_SMOKE_OK',
      result.width,
      result.height,
      result.bytes
    )
    app.exit(0)
  } catch (error) {
    writeReport({
      ok: false,
      stage: 'exception',
      error: error instanceof Error ? error.message : String(error)
    })
    console.error('LONG_CAPTURE_MANUAL_SMOKE_ERROR', error)
    app.exit(1)
  } finally {
    if (finishTimer) clearTimeout(finishTimer)
    fixture.kill()
  }
}

if (
  !isSmokeTest &&
  !isCaptureSmoke &&
  !isOverlaySmoke &&
  !isOcrSmoke &&
  !isOverlayOcrSmoke &&
  !isOcrTranslateSmoke &&
  !isPrepareSmoke &&
  !isFastCaptureSmoke &&
  !isLongCaptureSmoke &&
  !isLongCaptureUiSmoke &&
  !isLongCaptureManualSmoke &&
  !isOcrFileSmoke &&
  !isSoakOcr &&
  !isCaptureOnce &&
  !isSettingsE2e &&
  !isOnboardingE2e &&
  !app.requestSingleInstanceLock()
) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (
      !isSmokeTest &&
      !isCaptureSmoke &&
      !isOverlaySmoke &&
      !isOcrSmoke &&
      !isOverlayOcrSmoke &&
      !isOcrTranslateSmoke &&
      !isPrepareSmoke &&
      !isFastCaptureSmoke &&
      !isLongCaptureSmoke &&
      !isLongCaptureUiSmoke &&
      !isLongCaptureManualSmoke &&
      !isOcrFileSmoke &&
      !isSoakOcr &&
      !isCaptureOnce &&
      !isSettingsE2e &&
      !isOnboardingE2e &&
      preloadPath
    ) {
      openStartupWindow()
    }
  })

  app.whenReady().then(() => {
    if (isOcrFileSmoke) {
      void runOcrFileSmoke(ocrFileSmokePath)
      return
    }
    if (isSoakOcr) {
      void runOcrSoak()
      return
    }
    if (isLongCaptureSmoke) {
      void runLongCaptureSmoke()
      return
    }
    if (isLongCaptureUiSmoke) {
      initServices()
      void runLongCaptureSmokeUi()
      return
    }
    if (isLongCaptureManualSmoke) {
      initServices()
      void runLongCaptureManualSmoke()
      return
    }
    initServices()
    if (isSettingsE2e) {
      createSettingsWindow(preloadPath)
      return
    }
    if (isOnboardingE2e) {
      createOnboardingWindow(preloadPath)
      return
    }
    if (isOverlaySmoke) {
      runOverlaySmoke(false)
      return
    }
    if (isOverlayOcrSmoke) {
      runOverlaySmoke(true)
      return
    }
    if (isOcrSmoke) {
      void runOcrSmoke('ocr')
      return
    }
    if (isOcrTranslateSmoke) {
      void runOcrSmoke('translate')
      return
    }
    if (isPrepareSmoke) {
      runPrepareSmoke()
      return
    }
    if (isFastCaptureSmoke) {
      void runFastCaptureSmoke()
      return
    }
    if (isCaptureSmoke) {
      void runCaptureSmoke()
      return
    }
    if (isSmokeTest) {
      runSmokeTest()
      return
    }
    startMetricsSampling()
    tray = createTray({
      onCapture: () => {
        void startCapture()
      },
      onRecordGif: () => {
        void startCapture('gif')
      },
      onRecordVideo: () => {
        void startCapture('video')
      },
      onSettings: () => createSettingsWindow(preloadPath),
      onQuit: () => app.quit()
    })
    if (isDebugTrayMenu) {
      setTimeout(() => tray?.popUpContextMenu(), 500)
    }
    notify('Pixmint 已启动，右键托盘图标打开设置')
    if (isShowSettings || !settingsStore.get().onboardingCompleted) openStartupWindow()
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const displayInfo = {
      id: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor
    }
    overlayManager.prewarm([displayInfo])
    void overlayManager.warmup(displayInfo)
    if (isCaptureOnce) {
      setTimeout(() => {
        void startCapture()
      }, 1200)
    }
    console.log(
      'STARTUP_VISIBLE_WINDOWS',
      BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length
    )
  })

  app.on('activate', () => {
    if (
      !isSmokeTest &&
      !isCaptureSmoke &&
      !isOverlaySmoke &&
      !isOcrSmoke &&
      !isOverlayOcrSmoke &&
      !isOcrTranslateSmoke &&
      !isPrepareSmoke &&
      !isFastCaptureSmoke &&
      !isOcrFileSmoke &&
      !isSoakOcr &&
      !isCaptureOnce &&
      !isSettingsE2e &&
      !isOnboardingE2e &&
      preloadPath
    ) {
      openStartupWindow()
    }
  })

  app.on('before-quit', () => {
    addBreadcrumb('app', 'before-quit')
    statusToast.hide()
    disposeUpdater()
    longCaptureController?.dispose()
    globalShortcut.unregisterAll()
    pinManager?.destroyAll()
    ocrManager?.destroyAll()
    recorderManager?.destroyAll()
    overlayManager?.destroyAll()
    platformServices.dispose()
    tray?.destroy()
    tray = null
    stopMetricsSampling()
    flushDiagnosticsSync()
  })

  app.on('window-all-closed', () => {
    // 托盘常驻应用不因窗口关闭而退出
  })
}
