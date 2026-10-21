import type {
  GifDoneMeta,
  OverlayCompletePayload,
  OverlayInit,
  OcrInit,
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
  VideoDoneMeta
} from './types'

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
    autoCopy(pngDataUrl: string): void
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
}
