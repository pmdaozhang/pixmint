import { BrowserWindow, nativeTheme } from 'electron'
import { appIcon } from '../app-icon'
import { loadRoute } from './load'

let previewWindow: BrowserWindow | null = null
const silentlyClosed = new WeakSet<BrowserWindow>()

export function createLongCapturePreview(
  preloadPath: string,
  onClosed: () => void
): BrowserWindow {
  if (previewWindow && !previewWindow.isDestroyed()) {
    silentlyClosed.add(previewWindow)
    previewWindow.destroy()
  }

  const window = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 720,
    minHeight: 520,
    frame: false,
    thickFrame: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0d' : '#f9f9f9',
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: false,
    show: false,
    title: '长截图预览',
    icon: appIcon(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  previewWindow = window
  window.setMenuBarVisibility(false)
  window.on('closed', () => {
    if (previewWindow === window) previewWindow = null
    if (silentlyClosed.has(window)) return
    onClosed()
  })
  loadRoute(window, 'long-capture-preview')
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show()
      window.focus()
    }
  })
  window.webContents.once('did-finish-load', () => {
    if (!window.isDestroyed() && !window.isVisible()) {
      window.show()
      window.focus()
    }
  })
  return window
}

export function closeLongCapturePreview(): void {
  const window = previewWindow
  previewWindow = null
  if (window && !window.isDestroyed()) {
    silentlyClosed.add(window)
    window.destroy()
  }
}
