import { BrowserWindow } from 'electron'
import { loadRoute } from './load'

/**
 * 背景：窗口选择后需要让用户在真实窗口内容上微调选区，而不是在冻结截图里盲调。
 * 设计意图：全屏透明窗口只画选区边框/遮罩/手柄，目标窗口保持在前台可见。
 * 关键约束：开始采集前必须销毁/隐藏本窗口，避免被截进长图或挡住滚动。
 */
export class WindowLongSelection {
  private window: BrowserWindow | null = null

  constructor(private readonly preloadPath: string) {}

  show(display: Electron.Display): void {
    this.hide()
    const window = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
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
      title: '窗口长截图选区',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setMenuBarVisibility(false)
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) {
        window.show()
        window.focus()
      }
    })
    window.on('closed', () => {
      if (this.window === window) this.window = null
    })
    this.window = window
    loadRoute(window, 'window-long-selection')
  }

  hide(): void {
    const window = this.window
    this.window = null
    if (window && !window.isDestroyed()) window.destroy()
  }

  dispose(): void {
    this.hide()
  }
}
