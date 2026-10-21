import { BrowserWindow } from 'electron'
import { appIcon } from '../app-icon'
import { loadRoute } from './load'
import { disableWindowTransitions } from '../native-window'

let settingsWindow: BrowserWindow | null = null
const SHADOW_MARGIN = 28

export function createSettingsWindow(preloadPath: string): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }
  const options: Electron.BrowserWindowConstructorOptions = {
    width: 860 + SHADOW_MARGIN * 2,
    height: 660 + SHADOW_MARGIN * 2,
    minWidth: 720 + SHADOW_MARGIN * 2,
    minHeight: 540 + SHADOW_MARGIN * 2,
    frame: false,
    resizable: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    hasShadow: false,
    show: false,
    title: 'Pixmint 设置',
    icon: appIcon(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  }
  settingsWindow = new BrowserWindow(options)
  disableWindowTransitions(settingsWindow.getNativeWindowHandle())
  // 部分 Windows 版本会忽略构造参数里的 icon，创建后再显式设置一次。
  const icon = appIcon()
  settingsWindow.setIcon(icon)
  // 透明无边框窗口在部分 Windows 版本会被当作工具窗口，显式要求显示在任务栏。
  settingsWindow.setSkipTaskbar(false)
  console.log('SETTINGS_ICON_SET', icon.isEmpty() ? 'EMPTY' : icon.getSize())
  settingsWindow.setMenuBarVisibility(false)
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
  const showSettings = (): void => {
    if (!settingsWindow || settingsWindow.isDestroyed()) return
    // 先显示窗口，图标设置失败不能阻断设置面板出现。
    settingsWindow.show()
    try {
      settingsWindow.setIcon(appIcon())
    } catch (error) {
      console.warn('SETTINGS_ICON_FAILED', error)
    }
    // 必须在 show() 之后再清一次工具窗口样式，否则透明窗口仍可能不进任务栏。
    settingsWindow.setSkipTaskbar(false)
    settingsWindow.moveTop()
    settingsWindow.focus()
  }
  // 监听必须在 loadRoute 之前注册；打包版页面加载很快，晚注册会错过 ready-to-show。
  settingsWindow.once('ready-to-show', showSettings)
  loadRoute(settingsWindow, 'settings')
  setTimeout(() => {
    if (settingsWindow && !settingsWindow.isDestroyed() && !settingsWindow.isVisible()) {
      showSettings()
    }
  }, 800)
  return settingsWindow
}

export function focusSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
  }
}
