import type { UsageFeature } from '../../shared/usage'
import type { FeedbackService } from '../feedback'
import type { LicenseService } from '../license/service'
import type { PlatformServices } from '../platform'
import type { RecorderManager } from '../recording'
import type { SecretStore } from '../secret-store'
import type { SettingsStore } from '../settings-store'
import type { UsageService } from '../services/usage-service'
import type { OcrManager } from '../windows/ocr'
import type { OverlayManager } from '../windows/overlay'
import type { PinManager } from '../windows/pin'

/**
 * 背景：IPC 注册从 index.ts 拆出后，各域模块需要同一批服务实例。
 * 设计意图：用显式依赖对象代替模块级全局变量，方便以后替换成插件宿主。
 * 关键约束：这里只声明依赖，不创建实例；生命周期仍由 index.ts 的 initServices 负责。
 */
export interface IpcContext {
  preloadPath: string
  settingsStore: SettingsStore
  secretStore: SecretStore
  overlayManager: OverlayManager
  pinManager: PinManager
  ocrManager: OcrManager
  recorderManager: RecorderManager
  feedbackService: FeedbackService
  platformServices: PlatformServices
  usageService: UsageService
  licenseService: LicenseService
  applySystemSettings: () => void
  openSettingsWindow: () => void
  openPurchaseWindow: (feature?: UsageFeature) => void
}
