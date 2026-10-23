import { BrowserWindow, nativeTheme } from 'electron'
import type { OcrInit } from '../../shared/types'
import { appIcon } from '../app-icon'
import { loadRoute } from './load'

function estimateOcrHeight(text: string): number {
  const lines = text.split('\n').reduce((total, line) => {
    return total + Math.max(1, Math.ceil(line.length / 42))
  }, 0)
  const content = Math.min(320, Math.max(64, lines * 24 + 24))
  const emptyHint = text.trim() ? 0 : 54
  return Math.max(160, Math.min(560, content + 86 + emptyHint))
}

export class OcrManager {
  private readonly windows = new Map<number, { window: BrowserWindow; init: OcrInit }>()

  constructor(
    private readonly preloadPath: string,
    private readonly onOpenSettings: () => void
  ) {}

  open(init: OcrInit): BrowserWindow {
    this.closeAll()
    const isTranslate = init.mode === 'translate'
    const window = new BrowserWindow({
      width: 620,
      height: isTranslate ? 320 : estimateOcrHeight(init.text),
      frame: false,
      thickFrame: false,
      transparent: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e28' : '#fafafc',
      roundedCorners: false,
      hasShadow: false,
      resizable: false,
      show: false,
      title: init.mode === 'translate' ? 'Pixmint 翻译' : 'Pixmint OCR',
      icon: appIcon(),
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    window.setMenuBarVisibility(false)
    const id = window.webContents.id
    this.windows.set(id, { window, init })
    window.on('closed', () => this.windows.delete(id))
    loadRoute(window, 'ocr')
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show()
    })
    return window
  }

  initFor(webContentsId: number): OcrInit | null {
    return this.windows.get(webContentsId)?.init ?? null
  }

  close(webContentsId: number): void {
    this.windows.get(webContentsId)?.window.close()
  }

  resize(webContentsId: number, height: number): void {
    const entry = this.windows.get(webContentsId)
    if (!entry) return
    const window = entry.window
    if (window.isDestroyed()) return
    const [width, currentHeight] = window.getSize()
    const nextHeight = Math.max(160, Math.min(600, Math.round(height)))
    if (Math.abs(currentHeight - nextHeight) < 2) return
    window.setSize(width, nextHeight)
  }

  closeAll(): void {
    for (const entry of this.windows.values()) {
      if (!entry.window.isDestroyed()) entry.window.close()
    }
    this.windows.clear()
  }

  openSettings(): void {
    this.onOpenSettings()
  }

  destroyAll(): void {
    for (const entry of this.windows.values()) {
      if (!entry.window.isDestroyed()) entry.window.destroy()
    }
    this.windows.clear()
  }
}
