import type {
  GifDoneMeta,
  OverlayCompletePayload,
  OverlayInit,
  OcrResult,
  OcrInit,
  PinEditLayout,
  PinInit,
  Rect,
  RecorderBeginPayload,
  RecorderBeginResult,
  RecorderCommand,
  RecorderControlCommand,
  RecorderPreviewInfo,
  RecorderState,
  RecorderStatePatch,
  Settings,
  DiagnosticsInfo,
  UpdateState,
  VideoDoneMeta,
  WordCardEntry
} from './types'
import type {
  FeedbackStatusEvent,
  FeedbackSubmitInput,
  FeedbackSubmitResult
} from './feedback'
import type {
  LicenseActivation,
  LicenseDevice,
  LicenseStatus,
  ManualOrder,
  ManualOrderResult,
  PaymentProvider,
  PurchaseOrder,
  PurchaseOrderResult,
  ReferralQuote
} from './license'
import type { UsageFeature, UsageView } from './usage'
import type { ReferralProgress } from './referral'

export interface SnapglassApi {
  overlay: {
    ready(): Promise<OverlayInit | null>
    onInit(callback: (init: OverlayInit) => void): () => void
    onPrepare(callback: (settings: Settings) => void): () => void
    onReset(callback: () => void): () => void
    onWarmEdit(callback: (bounds: Rect) => void): () => void
    prepared(): void
    warmEditDone(): void
    rendererReady(): void
    heartbeat(): void
    /** 记住用户手动切换的聚光灯开关，下次 F1 沿用 */
    setSpotlightPref(value: boolean): void
    windowAt(x: number, y: number): Promise<Rect | null>
    complete(payload: OverlayCompletePayload): void
    cancel(): void
  }
  pin: {
    ready(): Promise<PinInit | null>
    close(): void
    copy(): Promise<void>
    save(): Promise<string | null>
    recognizeText(): Promise<OcrResult | null>
    setOpacity(opacity: number): Promise<number>
    zoom(direction: 1 | -1): Promise<{ width: number; height: number }>
    dragStart(): void
    dragMove(dx: number, dy: number): void
    dragEnd(): void
    contextMenu(): void
                setEditMode(active: boolean): Promise<PinEditLayout | null>
                commitEdit(imageBytes: Uint8Array): Promise<boolean>
  }
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
    setTranslationKey(key: string): Promise<boolean>
    openWindow(): void
  }
  ocr: {
    ready(): Promise<OcrInit | null>
    close(): void
    openSettings(): void
    resize(height: number): void
  }
  translation: {
    translate(text: string, target?: 'zh-CN' | 'en-US'): Promise<string>
  }
  dictionary: {
    lookup(word: string): Promise<WordCardEntry | null>
  }
  clipboard: {
    writeText(text: string): Promise<void>
  }
  recorder: {
    begin(payload: RecorderBeginPayload): Promise<RecorderBeginResult>
    state(patch: RecorderStatePatch): void
    gifDone(bytes: Uint8Array, meta: GifDoneMeta): void
    videoBegin(meta: VideoDoneMeta): Promise<void>
    videoChunk(chunk: ArrayBuffer): void
    videoDone(meta: VideoDoneMeta): void
    videoFailed(message: string): void
    dismiss(): void
    onCommand(callback: (command: RecorderCommand) => void): () => void
  }
  recorderControl: {
    ready(): Promise<RecorderState | null>
    onState(callback: (state: RecorderState) => void): () => void
    command(command: RecorderControlCommand): void
  }
  recorderPreview: {
    ready(): Promise<RecorderPreviewInfo | null>
    readFile(): Promise<Uint8Array>
    save(): Promise<string | null>
    copy(): Promise<string>
    retry(): void
    close(): void
    openFolder(): void
  }
  app: {
    platform: string
    version(): Promise<string>
    /** 设置窗/购买窗首帧渲染完成后通知主进程显示窗口。 */
    contentReady(): void
  }
  diagnostics: {
    info(): Promise<DiagnosticsInfo>
    openLogFolder(): Promise<string>
    openCrashFolder(): Promise<string>
    flush(): Promise<void>
    disableSafeMode(): Promise<boolean>
    exportReport(): Promise<string | null>
  }
  feedback: {
    submit(input: FeedbackSubmitInput): Promise<FeedbackSubmitResult>
    onStatus(callback: (event: FeedbackStatusEvent) => void): () => void
  }
  updater: {
    getState(): Promise<UpdateState>
    check(): Promise<UpdateState>
    download(): Promise<UpdateState>
    install(): Promise<void>
    onState(callback: (state: UpdateState) => void): () => void
  }
  whatsNew: {
    resize(height: number): void
    minimize(): void
  }
  usage: {
    get(): Promise<UsageView>
  }
  license: {
    status(): Promise<LicenseStatus>
    activate(code: string): Promise<LicenseActivation>
    restore(): Promise<LicenseStatus | null>
    refresh(): Promise<LicenseStatus>
    devices(): Promise<LicenseDevice[]>
    unbind(deviceHash: string): Promise<void>
    trial(inviteCode: string): Promise<LicenseActivation>
  }
  referral: {
    /** 分享进度（已计有效次数 + 活动是否进行中），分享弹框与购买页共用 */
    progress(): Promise<ReferralProgress>
    /** 本次是否由好友分享链接安装启动；分享弹框据此决定文案 */
    context(): Promise<{ shareUrl: string; friendLaunch: boolean; count: number }>
    /** 购买页「分享得会员」：打开与托盘同一个分享弹框，以购买窗为父窗口 */
    openShare(): Promise<void>
  }
  purchase: {
    open(feature?: UsageFeature): void
    createOrder(
      plan: 'monthly' | 'yearly' | 'lifetime',
      provider: PaymentProvider
    ): Promise<PurchaseOrder>
    orderStatus(orderId: string, orderToken: string): Promise<PurchaseOrderResult>
    createManualOrder(
      plan: 'monthly' | 'yearly' | 'lifetime',
      provider: PaymentProvider
    ): Promise<ManualOrder>
    /** 分享抵扣报价（服务端按分享次数算好折后价）；失败返回 null 时按原价展示 */
    referralQuote(): Promise<ReferralQuote | null>
    /** 分享满 12 次：跳过付款直接领取终身版 */
    claimShareReward(): Promise<LicenseActivation>
    submitManualOrder(orderId: string, orderToken: string): Promise<ManualOrder>
    manualOrderStatus(orderId: string, orderToken: string): Promise<ManualOrderResult>
    resize(height: number, width?: number): void
  }
}
