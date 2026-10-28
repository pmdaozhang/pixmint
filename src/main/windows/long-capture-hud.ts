import { BrowserWindow } from 'electron'
import type { LongCaptureProgress, Rect } from '../../shared/types'
import { loadRoute } from './load'

const WIDTH = 280
const HEIGHT = 160
const MARGIN = 16

function intersects(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width <= b.x ||
    a.x >= b.x + b.width ||
    a.y + a.height <= b.y ||
    a.y >= b.y + b.height
  )
}

/**
 * 选择一个不覆盖选区的 HUD 角落。
 * 长截图会把选区内的所有像素截进去，HUD 必须放在选区外。
 */
function choosePosition(display: Electron.Display, selection: Rect): { x: number; y: number } {
  const work = display.workArea
  const absolute = {
    x: display.bounds.x + selection.x,
    y: display.bounds.y + selection.y,
    width: selection.width,
    height: selection.height
  }
  const candidates = [
    { x: work.x + work.width - WIDTH - MARGIN, y: work.y + MARGIN },
    { x: work.x + work.width - WIDTH - MARGIN, y: work.y + work.height - HEIGHT - MARGIN },
    { x: work.x + MARGIN, y: work.y + work.height - HEIGHT - MARGIN },
    { x: work.x + MARGIN, y: work.y + MARGIN }
  ]
  return (
    candidates.find(
      (candidate) =>
        !intersects(
          { ...candidate, width: WIDTH, height: HEIGHT },
          absolute
        )
    ) ?? candidates[0]
  )
}

export class LongCaptureHud {
  private window: BrowserWindow | null = null
  private lastProgress: LongCaptureProgress | null = null
  private suppressClosed = false

  constructor(
    private readonly preloadPath: string,
    private readonly onUserClosed?: () => void
  ) {}

  show(display: Electron.Display, selection: Rect): void {
    const position = choosePosition(display, selection)
    if (this.window && !this.window.isDestroyed()) {
      this.window.setBounds({ ...position, width: WIDTH, height: HEIGHT })
      this.window.showInactive()
      if (this.lastProgress) this.send(this.lastProgress)
      return
    }

    const window = new BrowserWindow({
      x: position.x,
      y: position.y,
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      title: '长截图',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.window = window
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setContentProtection(true)
    window.setMenuBarVisibility(false)
    window.on('closed', () => {
      if (this.window === window) this.window = null
      if (!this.suppressClosed) this.onUserClosed?.()
    })
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.showInactive()
    })
    window.webContents.once('did-finish-load', () => {
      if (this.lastProgress && !window.isDestroyed()) {
        window.webContents.send('long-capture:progress', this.lastProgress)
      }
    })
    loadRoute(window, 'long-capture-hud')
  }

  send(progress: LongCaptureProgress): void {
    this.lastProgress = progress
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('long-capture:progress', progress)
    }
  }

  hide(): void {
    const window = this.window
    this.window = null
    this.lastProgress = null
    if (!window || window.isDestroyed()) return
    this.suppressClosed = true
    window.destroy()
    this.suppressClosed = false
  }

  dispose(): void {
    this.hide()
  }
}
