import { BrowserWindow } from 'electron'
import { appIcon } from '../app-icon'
import { loadRoute } from './load'
import { disableWindowTransitions } from '../native-window'

let whatsNewWindow: BrowserWindow | null = null
const SHADOW_MARGIN = 28

/**
 * 背景：检测到新版本时，只弹一个系统通知无法说明“更新了什么”。
 * 设计意图：用独立无边框窗口承载更新介绍，样式与首次引导一致。
 * 关键约束：同一版本只弹一次（由 skippedUpdateVersion 控制）；关闭窗口不退出应用。
 */
/** 收进系统托盘：隐藏窗口但保留进程和更新状态。 */
export function minimizeWhatsNewWindow(): void {
  if (whatsNewWindow && !whatsNewWindow.isDestroyed()) {
    whatsNewWindow.hide()
  }
}

export function createWhatsNewWindow(preloadPath: string, route = 'whats-new'): BrowserWindow {
  if (whatsNewWindow && !whatsNewWindow.isDestroyed()) {
    whatsNewWindow.show()
    whatsNewWindow.focus()
    return whatsNewWindow
  }
  const options: Electron.BrowserWindowConstructorOptions = {
    width: 760 + SHADOW_MARGIN * 2,
    height: 600 + SHADOW_MARGIN * 2,
    frame: false,
    resizable: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    hasShadow: false,
    show: false,
    center: true,
    title: 'Pixmint Update',
    icon: appIcon(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }
  whatsNewWindow = new BrowserWindow(options)
  disableWindowTransitions(whatsNewWindow.getNativeWindowHandle())
  whatsNewWindow.setIcon(appIcon())
  whatsNewWindow.setSkipTaskbar(false)
  whatsNewWindow.setMenuBarVisibility(false)
  whatsNewWindow.on('closed', () => {
    whatsNewWindow = null
  })
  const show = (): void => {
    if (!whatsNewWindow || whatsNewWindow.isDestroyed()) return
    whatsNewWindow.show()
    whatsNewWindow.moveTop()
    whatsNewWindow.focus()
  }
  whatsNewWindow.once('ready-to-show', show)
  loadRoute(whatsNewWindow, route)
  setTimeout(() => {
    if (whatsNewWindow && !whatsNewWindow.isDestroyed() && !whatsNewWindow.isVisible()) {
      show()
    }
  }, 800)
  return whatsNewWindow
}
