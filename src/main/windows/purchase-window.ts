import { BrowserWindow } from 'electron'
import { appIcon } from '../app-icon'
import { loadRoute } from './load'
import { showWhenRendererReady } from './show-when-ready'
import { disableWindowTransitions } from '../native-window'

let purchaseWindow: BrowserWindow | null = null
const SHADOW_MARGIN = 28

function routeFor(feature?: string): string {
  return feature ? `purchase?feature=${encodeURIComponent(feature)}` : 'purchase'
}

/**
 * 额度用尽或用户主动升级时打开的购买窗。
 * 单一实例；再次打开会更新 feature 参数并置顶，避免叠出多个窗口。
 */
export function createPurchaseWindow(preloadPath: string, feature?: string): BrowserWindow {
  const route = routeFor(feature)
  if (purchaseWindow && !purchaseWindow.isDestroyed()) {
    loadRoute(purchaseWindow, route)
    purchaseWindow.show()
    purchaseWindow.moveTop()
    purchaseWindow.focus()
    return purchaseWindow
  }
  const window = new BrowserWindow({
    width: 760 + SHADOW_MARGIN * 2,
    height: 620 + SHADOW_MARGIN * 2,
    frame: false,
    resizable: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    hasShadow: false,
    show: false,
    center: true,
    alwaysOnTop: true,
    title: 'Pixmint Pro',
    icon: appIcon(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  purchaseWindow = window
  disableWindowTransitions(window.getNativeWindowHandle())
  window.setIcon(appIcon())
  window.setMenuBarVisibility(false)
  window.setAlwaysOnTop(true, 'screen-saver')
  window.on('closed', () => {
    purchaseWindow = null
  })
  const show = (): void => {
    if (!purchaseWindow || purchaseWindow.isDestroyed()) return
    purchaseWindow.show()
    purchaseWindow.moveTop()
    purchaseWindow.focus()
  }
  // 等渲染层确认授权状态、会员页/购买页和窗口尺寸都确定后再显示，
  // 避免会员先闪一下购买套餐页再切到恭喜页。
  showWhenRendererReady(window, show)
  loadRoute(window, route)
  return window
}

export function isPurchaseWindowOpen(): boolean {
  return Boolean(purchaseWindow && !purchaseWindow.isDestroyed())
}
