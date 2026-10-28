import { BrowserWindow, screen } from 'electron'
import { appIcon } from '../app-icon'
import { loadRoute } from './load'

let previewWindow: BrowserWindow | null = null
const silentlyClosed = new WeakSet<BrowserWindow>()

export function createLongCapturePreview(
  preloadPath: string,
  onClosed: () => void,
  imageWidth = 900
): BrowserWindow {
  if (previewWindow && !previewWindow.isDestroyed()) {
    silentlyClosed.add(previewWindow)
    previewWindow.destroy()
  }

  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const maxWidth = Math.max(720, workArea.width - 80)
  const width = Math.min(maxWidth, Math.max(760, Math.round(imageWidth) + 96))
  const height = Math.min(Math.max(560, workArea.height - 160), 700)
  const window = new BrowserWindow({
    width,
    height,
    minWidth: 640,
    minHeight: 480,
    maxWidth,
    frame: false,
    thickFrame: true,
    transparent: true,
    backgroundColor: '#00000000',
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
