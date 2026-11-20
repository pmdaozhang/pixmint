import { BrowserWindow, screen } from 'electron'
import { appIcon } from '../app-icon'
import { disableWindowTransitions } from '../native-window'
import { loadRoute } from './load'

let shareWindow: BrowserWindow | null = null

/** 卡片 420 + 两侧阴影留白 28 */
const WIDTH = 420 + 28 * 2
const HEIGHT = 430 + 28 * 2

/**
 * 分享链接弹框。
 *
 * 背景：从托盘菜单打开，属于轻量工具窗口，不该占任务栏。
 * 设计意图：无边框透明单例窗口，在光标所在屏幕正中弹出，失焦自动收起。
 * 关键约束：复制链接成功后在渲染层 0.6 秒内自行关闭；只保留一个实例。
 */
export function createShareWindow(preloadPath: string, parent?: BrowserWindow): BrowserWindow {
  const parentWindow = parent && !parent.isDestroyed() ? parent : undefined
  if (shareWindow && !shareWindow.isDestroyed()) {
    // 从托盘等无父窗口的入口再次打开时，解除旧的父子关系，否则会跟着购买窗一起被销毁
    if (shareWindow.getParentWindow() !== (parentWindow ?? null)) {
      shareWindow.setParentWindow(parentWindow ?? null)
    }
    shareWindow.show()
    centerOnScreen(shareWindow)
    shareWindow.moveTop()
    shareWindow.focus()
    return shareWindow
  }

  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    // 从购买窗打开时作为它的子窗口：父窗口收起时一起收起，但位置仍按屏幕居中计算
    parent: parentWindow,
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
    centerOnScreen(window)
    window.show()
    window.focus()
  })
  loadRoute(window, 'share')
  return window
}

export function closeShareWindow(): void {
  if (shareWindow && !shareWindow.isDestroyed()) shareWindow.hide()
}

/** 在当前光标所在屏幕的工作区正中显示，多显示器也成立 */
function centerOnScreen(window: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  window.setPosition(
    Math.round(x + (width - WIDTH) / 2),
    Math.round(y + (height - HEIGHT) / 2)
  )
}
