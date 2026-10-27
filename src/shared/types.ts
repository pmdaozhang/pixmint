export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type ThemeSetting = 'system' | 'dark' | 'light'
export type Language = 'zh-CN' | 'en-US'
export type OverlayAction = 'copy' | 'save' | 'pin' | 'ocr'
export type Tool = 'move' | 'shape' | 'arrow' | 'mosaic' | 'text' | 'seq'
export type ShapeKind = 'rect' | 'ellipse'
export type LineStyle = 'solid' | 'thin' | 'sketch' | 'dotted'
export type ArrowMode = 'single' | 'none' | 'double'
export type AnnoType = 'rect' | 'ellipse' | 'arrow' | 'pen' | 'mosaic' | 'text' | 'seq'
export type RecorderMode = 'gif' | 'video'
export type RecorderFps = 10 | 15 | 30
export type RecorderSize = 'original' | '720' | '480'
export type RecorderCountdown = 3 | 1 | 0
export type RecorderPhase =
  | 'preparing'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'encoding'
  | 'result'

export interface Settings {
  schemaVersion?: number
  shortcut: string
  theme: ThemeSetting
  language: Language
  launchAtLogin: boolean
  onboardingCompleted: boolean
  translationProvider: 'none' | 'free' | 'openai' | 'deepl'
  translationEndpoint: string
  translationModel: string
  translationTarget: 'zh-CN' | 'en-US'
  hasTranslationKey?: boolean
}

export interface DiagnosticsInfo {
  version: string
  platform: string
  logPath: string
  crashReportsDir: string
  crashReportCount: number
  latestCrashFile: string | null
  latestCrashAt: string | null
  safeMode: boolean
}

export interface DisplayCapture {
  displayId: number
  bounds: Rect
  scaleFactor: number
  imageDataUrl: string
  imageWidth: number
  imageHeight: number
}

export interface OverlayInit extends DisplayCapture {
  settings: Settings
  pendingRecorderMode?: RecorderMode
}

export interface OverlayCompletePayload {
  action: OverlayAction
  displayId: number
  selection: Rect
  pngBytes: Uint8Array
  autoTranslate?: boolean
}

export interface OcrResult {
  text: string
  lines: string[]
}

export interface OcrInit extends OcrResult {
  mode: 'ocr' | 'translate'
  autoTranslate: boolean
  settings: Settings
  hasTranslationKey: boolean
}

export interface DictionaryEntry {
  word: string
  phonetic: string
  definitions: string[]
}

export interface PinInit {
  id: string
  imageBytes: Uint8Array
  width: number
  height: number
  opacity: number
}

export interface PinEditLayout {
  width: number
  height: number
  imageWidth: number
  imageHeight: number
  toolbarWidth: number
}

export interface AnnoStyle {
  color: string
  lineW: number
  lineStyle: LineStyle
  arrowMode: ArrowMode
}

interface BaseAnno {
  id: string
  style: AnnoStyle
}

export interface RectAnno extends BaseAnno {
  type: 'rect' | 'ellipse'
  x1: number
  y1: number
  x2: number
  y2: number
  fill: boolean
}

export interface LineAnno extends BaseAnno {
  type: 'arrow' | 'pen'
  x1: number
  y1: number
  x2: number
  y2: number
  points?: Point[]
}

export interface MosaicCell {
  x: number
  y: number
  g?: number
}

export interface MosaicAnno extends BaseAnno {
  type: 'mosaic'
  x1: number
  y1: number
  x2: number
  y2: number
  mode: 'brush' | 'rect'
  size: number
  brushSize?: number
  cells: MosaicCell[]
}

export interface TextAnno extends BaseAnno {
  type: 'text'
  x: number
  y: number
  text: string
  width?: number
  fontSize: number
  fontFamily: string
  bold: boolean
  italic: boolean
  underline: boolean
}

export interface SeqAnno extends BaseAnno {
  type: 'seq'
  x: number
  y: number
  n: number
}

export type Annotation = RectAnno | LineAnno | MosaicAnno | TextAnno | SeqAnno

export interface DisplayInfo {
  id: number
  bounds: Rect
  scaleFactor: number
}

export interface RecorderOptions {
  mode: RecorderMode
  fps: RecorderFps
  size: RecorderSize
  countdown: RecorderCountdown
  mic: boolean
  systemAudio: boolean
}

export interface RecorderBeginPayload {
  mode: RecorderMode
  displayId: number
  selection: Rect
  options: RecorderOptions
}

export interface RecorderBeginResult {
  sourceId: string
}

export interface RecorderState {
  mode: RecorderMode
  phase: RecorderPhase
  elapsedMs: number
  fps: number
  mic: boolean
  systemAudio: boolean
  width: number
  height: number
  maxDurationMs: number
  message?: string
}

export interface RecorderStatePatch {
  phase?: RecorderPhase
  elapsedMs?: number
  message?: string
  mic?: boolean
  systemAudio?: boolean
  width?: number
  height?: number
}

export interface GifDoneMeta {
  width: number
  height: number
  fps: number
  durationMs: number
  frameCount: number
  firstFrameDataUrl?: string
}

export interface VideoDoneMeta {
  mimeType: string
  extension: string
  width: number
  height: number
  fps: number
  durationMs: number
  mic: boolean
  systemAudio: boolean
  hasAudio: boolean
  note?: string
}

export interface RecorderPreviewInfo {
  mode: RecorderMode
  fileName: string
  filePath: string
  mediaUrl: string
  mimeType: string
  extension: string
  width: number
  height: number
  fps: number
  frameCount?: number
  durationMs: number
  sizeBytes: number
  mic: boolean
  systemAudio: boolean
  hasAudio: boolean
  thumbnailUrl?: string
  note?: string
}

export type RecorderCommand =
  | { type: 'stop' }
  | { type: 'cancel' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'retry' }
  | { type: 'open-mode'; mode: RecorderMode }

export type RecorderControlCommand =
  | { type: 'stop' }
  | { type: 'cancel' }
  | { type: 'pause' }
  | { type: 'resume' }

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'downloaded'
  | 'installing'
  | 'error'
  | 'disabled'

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
}

export interface UpdateState {
  status: UpdatePhase
  version?: string
  releaseNotes?: string
  progress?: UpdateProgress
  error?: string
  checkedAt?: string
  sizeBytes?: number
  reason?: 'no-release'
}

export type LongCapturePhase =
  | 'idle'
  | 'preparing'
  | 'scrolling'
  | 'capturing'
  | 'matching'
  | 'paused'
  | 'finished'
  | 'error'
  | 'cancelled'

export interface LongCaptureProgress {
  phase: LongCapturePhase
  screens: number
  height: number
  message?: string
  error?: string
}

export interface LongCaptureResult {
  width: number
  height: number
  bytes: number
  filePath: string
}
