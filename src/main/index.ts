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
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { copyImage, imageFromDataUrl, notify, saveImage } from './image-utils'
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
import { startMetricsSampling, stopMetricsSampling } from './metrics'

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
const ocrFileArgIndex = process.argv.indexOf('--smoke-ocr-file')
const ocrFileSmokePath = ocrFileArgIndex >= 0 ? process.argv[ocrFileArgIndex + 1] ?? '' : ''
const isOcrFileSmoke = Boolean(ocrFileSmokePath)
const isDebugTrayMenu = process.argv.includes('--debug-tray-menu')

let settingsStore: SettingsStore
let secretStore: SecretStore
let overlayManager: OverlayManager
let pinManager: PinManager
let ocrManager: OcrManager
let recorderManager: RecorderManager
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
    const capture = fast ?? (await platformServices.capture.captureDisplay(display))
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
    dialog.showErrorBox('截图失败', message)
  }
}

async function handleOverlayComplete(
  payload: OverlayCompletePayload,
  capture: DisplayCapture
): Promise<void> {
  const image = imageFromDataUrl(payload.pngDataUrl)
  if (image.isEmpty()) return
  addBreadcrumb('action', payload.action, {
    width: payload.selection.width,
    height: payload.selection.height
  })
  if (payload.action === 'copy') {
    copyImage(payload.pngDataUrl)
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
      saveImage(payload.pngDataUrl, result.filePath)
      notify(`已保存：${result.filePath}`)
    }
    return
  }
  if (payload.action === 'ocr') {
    try {
      notify('正在识别文字…')
      const result = await platformServices.ocr.recognizeDataUrl(payload.pngDataUrl)
      const settings = settingsStore.get()
      ocrManager.open({
        imageDataUrl: payload.pngDataUrl,
        text: result.text,
        lines: result.lines,
        mode: payload.autoTranslate ? 'translate' : 'ocr',
        autoTranslate: payload.autoTranslate === true,
        settings: { ...settings, hasTranslationKey: secretStore.hasTranslationKey() },
        hasTranslationKey: secretStore.hasTranslationKey()
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      dialog.showErrorBox('OCR 失败', message)
    }
    return
  }
  if (payload.action === 'pin') {
    pinManager.create(payload.pngDataUrl, payload.selection.width, payload.selection.height, {
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
  ipcMain.on('overlay:auto-copy', (event, pngDataUrl: string) => {
    if (!overlayManager.captureFor(event.sender.id)) return
    const image = imageFromDataUrl(pngDataUrl)
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

  ipcMain.handle('pin:ready', (event) => pinManager.initFor(event.sender.id))
  ipcMain.on('pin:close', (event) => pinManager.close(event.sender.id))
  ipcMain.handle('pin:copy', (event) => {
    pinManager.copy(event.sender.id)
  })
  ipcMain.handle('pin:save', (event) => pinManager.save(event.sender.id))
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
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture')
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media'
  })
  protocol.handle('snapglass-media', (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.searchParams.get('path') ?? '')
    if (!filePath || !recorderManager.isAllowedFile(filePath)) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
  platformServices.capture.prewarm()
  platformServices.windowQuery.prewarm()
  registerIpc()
  applySystemSettings()
  app.on('web-contents-created', (_event, contents) => {
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
      sandbox: false
    }
  })
  let failed = false
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') {
      failed = true
      console.error('SMOKE_CONSOLE', event.message)
    }
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
    const captures = await platformServices.capture.captureAll()
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
    const imagePath = join(app.getAppPath(), 'tests', 'fixtures', 'ocr-word.png')
    const dataUrl = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`
    const result = await recognizeImageDataUrl(dataUrl)
    console.log('OCR_SMOKE_TEXT', result.text)
    const settings = settingsStore.get()
    ocrManager.open({
      imageDataUrl: dataUrl,
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
      !isOcrFileSmoke &&
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
      !isSettingsE2e &&
      !isOnboardingE2e &&
      preloadPath
    ) {
      openStartupWindow()
    }
  })

  app.on('before-quit', () => {
    addBreadcrumb('app', 'before-quit')
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
