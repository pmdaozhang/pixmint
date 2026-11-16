import { BrowserWindow, nativeTheme, screen } from 'electron'
import type { ThemeSetting } from '../../shared/types'

/** 浅色和深色共用同一个窗口尺寸，胶囊本身按内容收缩。 */
const WIDTH = 280
const HEIGHT = 80

interface ToastPalette {
  background: string
  border: string
  color: string
  shadow: string
  inset: string
  blur: string
}

const DARK_PALETTE: ToastPalette = {
  background: 'rgba(28, 28, 30, 0.86)',
  border: 'rgba(255, 255, 255, 0.14)',
  color: '#f5f5f7',
  shadow: '0 1px 2px rgba(0, 0, 0, 0.38), 0 12px 28px -14px rgba(0, 0, 0, 0.62)',
  inset: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
  blur: 'blur(16px) saturate(140%)'
}

const LIGHT_PALETTE: ToastPalette = {
  background: 'rgba(255, 255, 255, 0.9)',
  border: 'rgba(20, 20, 24, 0.13)',
  color: '#34343a',
  shadow: '0 1px 2px rgba(20, 20, 24, 0.05), 0 12px 26px -14px rgba(20, 20, 24, 0.3)',
  inset: 'inset 0 1px 0 rgba(255, 255, 255, 0.75)',
  blur: 'blur(16px) saturate(140%)'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toastHtml(message: string, palette: ToastPalette): string {
  const label = message.replace(/(\.{3}|…)\s*$/, '')

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        font: 12px/1 "Segoe UI", "Microsoft YaHei", sans-serif;
      }
      .toast {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        max-width: calc(100vw - 16px);
        padding: 8px 15px;
        border-radius: 999px;
        border: 1px solid ${palette.border};
        background: ${palette.background};
        color: ${palette.color};
        box-shadow: ${palette.shadow}, ${palette.inset};
        -webkit-backdrop-filter: ${palette.blur};
        backdrop-filter: ${palette.blur};
        font-weight: 500;
        letter-spacing: 0.06em;
        white-space: nowrap;
      }
      .toast > span:first-child {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dots {
        display: inline-flex;
        align-items: flex-end;
        gap: 3px;
        height: 10px;
        margin-left: 1px;
        transform: translateY(1px);
      }
      .dots i {
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: currentColor;
        opacity: 0.28;
        animation: breathe 1.25s ease-in-out infinite;
      }
      .dots i:nth-child(2) { animation-delay: 0.14s; }
      .dots i:nth-child(3) { animation-delay: 0.28s; }
      @keyframes breathe {
        0%, 60%, 100% { opacity: 0.28; transform: translateY(0); }
        30%           { opacity: 0.95; transform: translateY(-2px); }
      }
      @media (prefers-reduced-motion: reduce) {
        .dots i { animation: none; opacity: 0.6; }
      }
    </style>
  </head>
  <body>
    <div class="toast">
      <span>${escapeHtml(label)}</span>
      <span class="dots"><i></i><i></i><i></i></span>
    </div>
  </body>
</html>`
}

/**
 * 背景：OCR/翻译在主进程里异步执行，覆盖层已经关闭，用户没有可见反馈。
 * 设计意图：用独立的小 toast 窗口提示“识别中...”，不抢焦点、不阻塞桌面。
 * 关键约束：窗口只在主进程存活期间存在；show 会替换旧 toast，hide 必须幂等。
 */
export class StatusToast {
  private window: BrowserWindow | null = null

  show(message: string, theme: ThemeSetting = 'system'): void {
    this.hide()
    const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
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
    const html = toastHtml(message, dark ? DARK_PALETTE : LIGHT_PALETTE)
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
