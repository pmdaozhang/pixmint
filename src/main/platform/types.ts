import type { DisplayCapture, OcrResult, Rect } from '../../shared/types'

export interface ScreenCaptureProvider {
  captureDisplay(display: Electron.Display): Promise<DisplayCapture>
  captureAll(): Promise<DisplayCapture[]>
  captureFast(display: Electron.Display): Promise<DisplayCapture | null>
  prewarm(): void
  dispose(): void
}

export interface WindowQueryProvider {
  prewarm(): void
  query(x: number, y: number): Promise<Rect | null>
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
