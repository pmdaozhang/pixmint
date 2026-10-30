import { BrowserWindow } from 'electron'
import type { FeedbackStatusEvent } from '../../shared/feedback'
import { appIcon } from '../app-icon'
import { disableWindowTransitions } from '../native-window'
import { loadRoute } from './load'

let feedbackWindow: BrowserWindow | null = null
const SHADOW_MARGIN = 28

/**
 * 背景：反馈从托盘进入，需要像设置页一样是独立窗口，而不是占用截图覆盖层。
 * 设计意图：固定尺寸、无边框透明外壳，内部页面负责玻璃卡片和阴影边距。
 * 关键约束：同一时间只保留一个反馈窗口；再次点击托盘入口只聚焦已有窗口。
 */
export function createFeedbackWindow(preloadPath: string): BrowserWindow {
  if (feedbackWindow && !feedbackWindow.isDestroyed()) {
    feedbackWindow.show()
    feedbackWindow.focus()
    return feedbackWindow
  }

  feedbackWindow = new BrowserWindow({
    width: 548 + SHADOW_MARGIN * 2,
    height: 500 + SHADOW_MARGIN * 2,
    frame: false,
    resizable: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: false,
    hasShadow: false,
    show: false,
    center: true,
    title: 'Pixmint 意见反馈',
    icon: appIcon(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  disableWindowTransitions(feedbackWindow.getNativeWindowHandle())
  feedbackWindow.setIcon(appIcon())
  feedbackWindow.setSkipTaskbar(false)
  feedbackWindow.setMenuBarVisibility(false)
  feedbackWindow.on('closed', () => {
    feedbackWindow = null
  })

  const showFeedback = (): void => {
    if (!feedbackWindow || feedbackWindow.isDestroyed()) return
    feedbackWindow.show()
    feedbackWindow.setSkipTaskbar(false)
    feedbackWindow.moveTop()
    feedbackWindow.focus()
  }

  feedbackWindow.once('ready-to-show', showFeedback)
  loadRoute(feedbackWindow, 'feedback')
  setTimeout(() => {
    if (feedbackWindow && !feedbackWindow.isDestroyed() && !feedbackWindow.isVisible()) {
      showFeedback()
    }
  }, 800)
  return feedbackWindow
}

export function sendFeedbackStatus(event: FeedbackStatusEvent): void {
  if (!feedbackWindow || feedbackWindow.isDestroyed()) return
  feedbackWindow.webContents.send('feedback:status', event)
}

