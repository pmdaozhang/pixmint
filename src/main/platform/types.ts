import type { DisplayCapture, OcrResult, Rect } from '../../shared/types'

export interface ScreenCaptureProvider {
  captureDisplay(display: Electron.Display): Promise<DisplayCapture>
  captureAll(): Promise<DisplayCapture[]>
  captureFast(display: Electron.Display): Promise<DisplayCapture | null>
  prewarm(): void
  dispose(): void
}

export interface ForegroundWindow {
  rect: Rect
  className: string
  pid: number
}

export interface WindowQueryProvider {
  prewarm(): void
  query(x: number, y: number): Promise<Rect | null>
  /** 前台窗口（矩形 + 类名 + 进程 ID，物理像素）；拿不到返回 null。 */
  foreground(): Promise<ForegroundWindow | null>
  dispose(): void
}

export interface OcrProvider {
  recognizeDataUrl(dataUrl: string): Promise<OcrResult>
}

export interface PlatformServices {
  name: 'win32' | 'darwin' | 'linux'
  capture: ScreenCaptureProvider
  windowQuery: WindowQueryProvider
  ocr: OcrProvider
  dispose(): void
}
