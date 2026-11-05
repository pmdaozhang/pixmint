import {
  app,
  BrowserWindow,
  globalShortcut,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  screen,
  session,
  Tray
} from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { RecorderMode, Settings } from '../shared/types'
import { FeedbackService } from './feedback'
import { SettingsStore } from './settings-store'
import { SecretStore } from './secret-store'
import { buildTrayMenu, createTray, type TrayActions } from './tray'
import { OverlayManager } from './windows/overlay'
import { PinManager } from './windows/pin'
import { OcrManager } from './windows/ocr'
import { WindowSnapHelper } from './window-snap'
import { createPlatformServices, type PlatformServices } from './platform'
import { createSettingsWindow } from './windows/settings-window'
import { createOnboardingWindow } from './windows/onboarding-window'
import { createFeedbackWindow, sendFeedbackStatus } from './windows/feedback-window'
import { createWhatsNewWindow } from './windows/whats-new-window'
import { createPurchaseWindow } from './windows/purchase-window'
import { DeviceIdStore } from './license/device-id'
import { LicenseStore, safeStorageCipher } from './license/store'
import { LicenseService } from './license/service'
import { UsageStore } from './usage-store'
import { UsageService } from './services/usage-service'
import type { UsageFeature } from '../shared/usage'
import { StatusToast } from './windows/status-toast'
import { RecorderManager } from './recording'
import { enableSafeMode, hasUncleanSession, safeModeRequested } from './safe-mode'
import { addBreadcrumb } from './breadcrumbs'
import { installCrashHandlers } from './crash-report'
import { diagnosticsPath, flushDiagnosticsSync, logDiagnostic } from './diagnostics'
import { installWebContentsSecurity, isTrustedAppUrl } from './security'
import { startMetricsSampling, stopMetricsSampling } from './metrics'
import { disposeUpdater, initUpdater } from './updater'
import { notify } from './image-utils'
import { t } from '../shared/i18n'
import { ocrWorker } from './ocr/remote'
import { registerIpc } from './ipc'
import { flags, isAutomationRun, isOcrFileSmoke } from './runtime/flags'
import {
  handleOverlayComplete,
  startCapture as startCaptureFlow,
  type CaptureDeps
} from './services/capture-service'
import type { SmokeContext } from './runtime/smoke'
import {
  runCaptureSmoke,
  runFastCaptureSmoke,
  runOcrFileSmoke,
  runOcrSmoke,
  runOcrSoak,
  runOverlaySmoke,
  runPrepareSmoke,
  runSmokeTest
} from './runtime/smoke'

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

/** 当前引导版本；升级后低于该值时展示一次新版引导。 */
const ONBOARDING_VERSION = 2
const statusToast = new StatusToast()

let settingsStore: SettingsStore
let secretStore: SecretStore
let overlayManager: OverlayManager
let pinManager: PinManager
let ocrManager: OcrManager
let recorderManager: RecorderManager
let windowSnap: WindowSnapHelper
let platformServices: PlatformServices
let feedbackService: FeedbackService
let deviceIdStore: DeviceIdStore
let licenseStore: LicenseStore
let licenseService: LicenseService
let usageStore: UsageStore
let usageService: UsageService
let tray: Tray | null = null
let trayActions: TrayActions | null = null
let preloadPath = ''

function applySystemSettings(): void {
  const settings = settingsStore.get()
  nativeTheme.themeSource = settings.theme
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
  // 语言切换后立即重建托盘菜单，不必重启应用
  if (tray && trayActions) {
    tray.setContextMenu(buildTrayMenu(trayActions, settings.language))
  }
  registerShortcut(settings)
}

function registerShortcut(settings: Settings): void {
  globalShortcut.unregisterAll()
  try {
    const ok = globalShortcut.register(settings.shortcut, () => {
      void startCapture()
    })
    if (!ok) {
      notify(
        t(settings.language, '快捷键 {key} 注册失败，可能已被占用', {
          key: settings.shortcut
        })
      )
    }
  } catch {
    notify(t(settings.language, '快捷键 {key} 无效', { key: settings.shortcut }))
  }
}

function captureDeps(): CaptureDeps {
  return {
    overlayManager,
    ocrManager,
    pinManager,
    recorderManager,
    platformServices,
    settingsStore,
    secretStore,
    statusToast,
    usageService,
    getTray: () => tray,
    isFastCaptureSmoke: flags.fastCaptureSmoke
  }
}

function smokeContext(): SmokeContext {
  return {
    preloadPath,
    settingsStore,
    secretStore,
    overlayManager,
    ocrManager,
    platformServices,
    startCapture
  }
}

async function startCapture(mode?: RecorderMode): Promise<void> {
  return startCaptureFlow(captureDeps(), mode)
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
      void handleOverlayComplete(captureDeps(), payload, capture)
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
    hideOverlay: () => overlayManager.hideAll(),
    getLanguage: () => settingsStore.get().language
  })
  deviceIdStore = new DeviceIdStore(join(app.getPath('userData'), 'device.json'))
  licenseStore = new LicenseStore(
    join(app.getPath('userData'), 'license.json'),
    safeStorageCipher(safeStorage)
  )
  licenseService = new LicenseService({
    store: licenseStore,
    deviceId: () => deviceIdStore.get(),
    fetchImpl: (url, init) =>
      net.fetch(url, init as RequestInit) as unknown as Promise<{
        ok: boolean
        status: number
        json(): Promise<unknown>
      }>
  })
  usageStore = new UsageStore(join(app.getPath('userData'), 'usage.json'))
  usageService = new UsageService({
    store: usageStore,
    license: licenseService,
    onExceeded: (feature: UsageFeature) => {
      overlayManager.hideAll()
      createPurchaseWindow(preloadPath, feature)
    }
  })
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
    if (!filePath || !recorderManager.isAllowedFile(filePath)) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
  platformServices.capture.prewarm()
  platformServices.windowQuery.prewarm()
  feedbackService = new FeedbackService({ onStatus: sendFeedbackStatus })
  feedbackService.start()
  registerIpc({
    preloadPath,
    settingsStore,
    secretStore,
    overlayManager,
    pinManager,
    ocrManager,
    recorderManager,
    feedbackService,
    platformServices,
    usageService,
    licenseService,
    applySystemSettings,
    openSettingsWindow: () => createSettingsWindow(preloadPath),
    openPurchaseWindow: (feature) => {
      overlayManager.hideAll()
      createPurchaseWindow(preloadPath, feature)
    }
  })
  applySystemSettings()
  if (licenseStore.get().token) {
    void licenseService.refresh().catch((error: unknown) => {
      logDiagnostic('license', `refresh failed: ${String(error)}`, 'warn')
    })
  }
  initUpdater({
    onAvailable: (version) => {
      if (settingsStore.get().skippedUpdateVersion === version) return
      createWhatsNewWindow(preloadPath)
    }
  })
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
    notify(
      t(
        settingsStore.get().language,
        '上次截图/录制异常退出，已启用兼容模式'
      )
    )
  }
}

function openStartupWindow(): void {
  if (!preloadPath) return
  if (settingsStore.get().onboardingVersion < ONBOARDING_VERSION) {
    createOnboardingWindow(preloadPath)
    settingsStore.update({
      onboardingCompleted: true,
      onboardingVersion: ONBOARDING_VERSION
    })
    return
  }
  createSettingsWindow(preloadPath)
}

function registerLifecycle(): void {
  app.on('activate', () => {
    if (!isAutomationRun() && preloadPath) openStartupWindow()
  })

  app.on('before-quit', () => {
    addBreadcrumb('app', 'before-quit')
    statusToast.hide()
    disposeUpdater()
    ocrWorker.dispose()
    globalShortcut.unregisterAll()
    pinManager?.destroyAll()
    ocrManager?.destroyAll()
    recorderManager?.destroyAll()
    overlayManager?.destroyAll()
    feedbackService?.dispose()
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

if (!isAutomationRun() && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!isAutomationRun() && preloadPath) openStartupWindow()
  })

  app.whenReady().then(() => {
    if (isOcrFileSmoke) {
      void runOcrFileSmoke(flags.ocrFileSmokePath)
      return
    }
    if (flags.soakOcr) {
      void runOcrSoak()
      return
    }
    initServices()
    if (flags.settingsE2e) {
      createSettingsWindow(preloadPath)
      return
    }
    if (flags.onboardingE2e) {
      createOnboardingWindow(preloadPath)
      return
    }
    if (flags.feedbackE2e) {
      createFeedbackWindow(preloadPath)
      return
    }
    if (flags.whatsNewE2e) {
      createWhatsNewWindow(preloadPath, 'whats-new?version=0.8.0')
      return
    }
    if (flags.purchaseE2e) {
      createPurchaseWindow(preloadPath, 'ocr')
      return
    }
    if (flags.overlaySmoke) {
      runOverlaySmoke(smokeContext(), false)
      return
    }
    if (flags.overlayOcrSmoke) {
      runOverlaySmoke(smokeContext(), true)
      return
    }
    if (flags.ocrSmoke) {
      void runOcrSmoke(smokeContext(), 'ocr')
      return
    }
    if (flags.ocrTranslateSmoke) {
      void runOcrSmoke(smokeContext(), 'translate')
      return
    }
    if (flags.prepareSmoke) {
      runPrepareSmoke(smokeContext())
      return
    }
    if (flags.fastCaptureSmoke) {
      void runFastCaptureSmoke(smokeContext())
      return
    }
    if (flags.captureSmoke) {
      void runCaptureSmoke(smokeContext())
      return
    }
    if (flags.smokeTest) {
      runSmokeTest(smokeContext())
      return
    }
    startMetricsSampling()
    trayActions = {
      onCapture: () => {
        void startCapture()
      },
      onSettings: () => createSettingsWindow(preloadPath),
      onFeedback: () => createFeedbackWindow(preloadPath),
      onQuit: () => app.quit()
    }
    tray = createTray(trayActions, settingsStore.get().language)
    if (flags.debugTrayMenu) {
      setTimeout(() => tray?.popUpContextMenu(), 500)
    }
    notify(
      t(
        settingsStore.get().language,
        'Pixmint 已启动，右键托盘图标打开设置'
      )
    )
    if (flags.showSettings || settingsStore.get().onboardingVersion < ONBOARDING_VERSION) {
      openStartupWindow()
    }
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const displayInfo = {
      id: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor
    }
    overlayManager.prewarm([displayInfo])
    void overlayManager.warmup(displayInfo)
    if (flags.captureOnce) {
      setTimeout(() => {
        void startCapture()
      }, 1200)
    }
    console.log(
      'STARTUP_VISIBLE_WINDOWS',
      BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length
    )
  })

  registerLifecycle()
}
