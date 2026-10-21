import { BrowserWindow } from 'electron'
import { appIcon } from '../app-icon'
import { loadRoute } from './load'
import { disableWindowTransitions } from '../native-window'

let onboardingWindow: BrowserWindow | null = null
const SHADOW_MARGIN = 28

/**
 * 背景：安装后的首次启动需要先说明快捷键和划线工具，而不是直接堆出设置项。
 * 设计意图：使用独立无边框窗口承载引导，关闭后应用继续留在托盘，不创建主窗口。
 * 关键约束：尺寸与设置窗口共用阴影边距；页面必须通过 onboarding 路由加载。
 */
export function createOnboardingWindow(preloadPath: string): BrowserWindow {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.show()
    onboardingWindow.focus()
    return onboardingWindow
  }
  const options: Electron.BrowserWindowConstructorOptions = {
    width: 860 + SHADOW_MARGIN * 2,
    height: 548 + SHADOW_MARGIN * 2,
    frame: false,
    resizable: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    hasShadow: false,
    show: false,
    center: true,
    title: 'Pixmint 首次使用',
    icon: appIcon(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  }
  onboardingWindow = new BrowserWindow(options)
  disableWindowTransitions(onboardingWindow.getNativeWindowHandle())
  onboardingWindow.setIcon(appIcon())
  onboardingWindow.setSkipTaskbar(false)
  onboardingWindow.setMenuBarVisibility(false)
  onboardingWindow.on('closed', () => {
    onboardingWindow = null
  })
  const showOnboarding = (): void => {
    if (!onboardingWindow || onboardingWindow.isDestroyed()) return
    onboardingWindow.show()
    onboardingWindow.setSkipTaskbar(false)
    onboardingWindow.moveTop()
    onboardingWindow.focus()
  }
  onboardingWindow.once('ready-to-show', showOnboarding)
  loadRoute(onboardingWindow, 'onboarding')
  setTimeout(() => {
    if (onboardingWindow && !onboardingWindow.isDestroyed() && !onboardingWindow.isVisible()) {
      showOnboarding()
    }
  }, 800)
  return onboardingWindow
}
