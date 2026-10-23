import { BrowserWindow, screen } from 'electron'

const WIDTH = 168
const HEIGHT = 40

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 背景：OCR/翻译在主进程里异步执行，覆盖层已经关闭，用户没有可见反馈。
 * 设计意图：用独立的小 toast 窗口提示“识别中...”，不抢焦点、不阻塞桌面。
 * 关键约束：窗口只在主进程存活期间存在；show 会替换旧 toast，hide 必须幂等。
 */
export class StatusToast {
  private window: BrowserWindow | null = null

  show(message: string): void {
    this.hide()
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const x = Math.round(display.workArea.x + (display.workArea.width - WIDTH) / 2)
    const y = Math.round(display.workArea.y + Math.min(96, display.workArea.height * 0.12))
    const window = new BrowserWindow({
      x,
      y,
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setIgnoreMouseEvents(true)
    const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; width: 100%; height: 100%; background: transparent; }
      body { display: flex; align-items: center; justify-content: center; }
      .toast {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        background: #1c1c1c;
        color: #fff;
        font: 13px/1.2 "Segoe UI", "Microsoft YaHei", sans-serif;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      }
    </style>
  </head>
  <body><div class="toast">${escapeHtml(message)}</div></body>
</html>`
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const reveal = (): void => {
      if (!window.isDestroyed() && !window.isVisible()) window.showInactive()
    }
    window.once('ready-to-show', reveal)
    window.webContents.once('did-finish-load', reveal)
    window.once('closed', () => {
      if (this.window === window) this.window = null
    })
    this.window = window
  }

  hide(): void {
    const window = this.window
    this.window = null
    if (window && !window.isDestroyed()) window.destroy()
  }
}
