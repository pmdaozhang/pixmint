import type {
  GifDoneMeta,
  OverlayCompletePayload,
  OverlayInit,
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

export interface SnapglassApi {
  overlay: {
    ready(): Promise<OverlayInit | null>
    onInit(callback: (init: OverlayInit) => void): () => void
    onPrepare(callback: (settings: Settings) => void): () => void
    onReset(callback: () => void): () => void
    prepared(): void
    rendererReady(): void
    heartbeat(): void
    windowAt(x: number, y: number): Promise<Rect | null>
                autoCopy(pngBytes: Uint8Array): void
    complete(payload: OverlayCompletePayload): void
    cancel(): void
  }
  pin: {
    ready(): Promise<PinInit | null>
    close(): void
    copy(): Promise<void>
    save(): Promise<string | null>
    setOpacity(opacity: number): Promise<number>
    toggleIgnore(): Promise<boolean>
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
  }
  diagnostics: {
    info(): Promise<DiagnosticsInfo>
    openLogFolder(): Promise<string>
    openCrashFolder(): Promise<string>
    flush(): Promise<void>
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
}
