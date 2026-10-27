import { BrowserWindow } from 'electron'
import type { Rect } from '../../shared/types'
import { loadRoute } from './load'

const BORDER = 2
const LABEL_WIDTH = 180
const LABEL_HEIGHT = 22
const LABEL_GAP = 6

interface BorderPart {
  part: 'top' | 'bottom' | 'left' | 'right' | 'label'
  x: number
  y: number
  width: number
  height: number
}

/**
 * 背景：长截图开始后覆盖层会隐藏，用户需要持续看到采集边界。
 * 设计意图：用四条选区外侧的细边线窗口 + 一个标签窗口，避免任何窗口盖住选区中心。
 * 关键约束：全部点击穿透、不抢焦点、置顶；边线必须在截图区域外侧。
 */
export class LongCaptureBorder {
  private windows: BrowserWindow[] = []

  constructor(private readonly preloadPath: string) {}

  show(
    display: Electron.Display,
    selection: Rect,
    mode: 'auto' | 'manual'
  ): void {
    this.hide()
    const left = Math.round(display.bounds.x + selection.x)
    const top = Math.round(display.bounds.y + selection.y)
    const right = left + Math.round(selection.width)
    const bottom = top + Math.round(selection.height)
    const parts: BorderPart[] = [
      {
        part: 'top',
        x: left - BORDER,
        y: top - BORDER,
        width: right - left + BORDER * 2,
        height: BORDER
      },
      {
        part: 'bottom',
        x: left - BORDER,
        y: bottom,
        width: right - left + BORDER * 2,
        height: BORDER
      },
      {
        part: 'left',
        x: left - BORDER,
        y: top,
        width: BORDER,
        height: bottom - top
      },
      {
        part: 'right',
        x: right,
        y: top,
        width: BORDER,
        height: bottom - top
      }
    ]

    const labelY =
      top - LABEL_HEIGHT - LABEL_GAP >= display.bounds.y
        ? top - LABEL_HEIGHT - LABEL_GAP
        : bottom + LABEL_GAP
    parts.push({
      part: 'label',
      x: Math.max(
        display.bounds.x,
        Math.min(left, display.bounds.x + display.bounds.width - LABEL_WIDTH)
      ),
      y: labelY,
      width: LABEL_WIDTH,
      height: LABEL_HEIGHT
    })

    for (const item of parts) {
      this.windows.push(this.createWindow(item, mode))
    }
  }

  hide(): void {
    for (const window of this.windows) {
      if (!window.isDestroyed()) window.destroy()
    }
    this.windows = []
  }

  dispose(): void {
    this.hide()
  }

  private createWindow(part: BorderPart, mode: 'auto' | 'manual'): BrowserWindow {
    const window = new BrowserWindow({
      x: part.x,
      y: part.y,
      width: Math.max(1, part.width),
      height: Math.max(1, part.height),
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
      focusable: false,
      show: false,
      title: '长截图边界',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setIgnoreMouseEvents(true, { forward: true })
    window.setMenuBarVisibility(false)
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.showInactive()
    })
    loadRoute(window, `long-capture-border?part=${part.part}&mode=${mode}`)
    return window
  }
}
