import { BrowserWindow, screen } from 'electron'
import { appIcon } from '../app-icon'
import { disableWindowTransitions } from '../native-window'
import { loadRoute } from './load'

let shareWindow: BrowserWindow | null = null

/** 卡片 420 + 两侧阴影留白 28 */
const WIDTH = 420 + 28 * 2
const HEIGHT = 430 + 28 * 2
/** 离托盘任务栏 / 屏幕右边的距离 */
const EDGE_GAP = 12

/**
 * 分享链接弹框。
 *
 * 背景：从托盘菜单打开，属于轻量工具窗口，不该占任务栏，也不该盖住用户正在做的事。
 * 设计意图：无边框透明单例窗口，贴任务栏右下角出现（托盘菜单位置），失焦自动收起。
 * 关键约束：复制链接成功后在渲染层 0.6 秒内自行关闭；只保留一个实例。
 */
export function createShareWindow(preloadPath: string): BrowserWindow {
  if (shareWindow && !shareWindow.isDestroyed()) {
    shareWindow.show()
    placeNearTaskbar(shareWindow)
    shareWindow.moveTop()
    shareWindow.focus()
    return shareWindow
  }

  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'Pixmint 分享',
    icon: appIcon(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  shareWindow = window
  disableWindowTransitions(window.getNativeWindowHandle())
  window.setAlwaysOnTop(true, 'pop-up-menu')
  window.setMenuBarVisibility(false)
  // 点托盘菜单时失焦收起，和系统菜单行为一致。
  // 给 250ms 宽限：窗口刚显示时 Windows 焦点可能还没落到它身上，避免一弹出就秒关。
  let shownAt = 0
  window.on('show', () => {
    shownAt = Date.now()
  })
  window.on('blur', () => {
    if (Date.now() - shownAt < 250) return
    if (!window.isDestroyed() && !window.webContents.isDevToolsOpened()) window.hide()
  })
  window.on('closed', () => {
    shareWindow = null
  })
  window.once('ready-to-show', () => {
    if (window.isDestroyed()) return
    placeNearTaskbar(window)
    window.show()
    window.focus()
  })
  loadRoute(window, 'share')
  return window
}

export function closeShareWindow(): void {
  if (shareWindow && !shareWindow.isDestroyed()) shareWindow.hide()
}

/** 贴当前光标所在屏幕的工作区右下角（任务栏上方），多显示器也成立 */
function placeNearTaskbar(window: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  window.setPosition(
    Math.round(x + width - WIDTH - EDGE_GAP),
    Math.round(y + height - HEIGHT - EDGE_GAP)
  )
}
