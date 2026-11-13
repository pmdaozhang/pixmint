import type { BrowserWindow } from 'electron'

type ShowFn = () => void

const pending = new Map<number, ShowFn>()

/**
 * 背景：设置窗/购买窗此前在 ready-to-show 时立刻显示，而此时渲染层还在等
 * settings/license 等异步 IPC，首帧只是占位状态：设置窗先显示"正在加载设置…"
 * 的暗色面板，购买窗先显示套餐页再切会员恭喜页，看起来像闪了一下另一个弹框。
 * 设计意图：窗口保持隐藏，等渲染层初始数据渲染完成、主题和尺寸都应用后，
 * 通过 window:content-ready 通知主进程再显示，首帧即最终画面。
 * 关键约束：必须有超时兜底，渲染层异常时窗口仍能出现；每个窗口只显示一次；
 *          不能把网络请求放进显示门控，否则授权服务一慢窗口就迟迟不出现。
 */
export function showWhenRendererReady(
  window: BrowserWindow,
  show: ShowFn,
  timeoutMs = 2500
): void {
  const id = window.webContents.id
  pending.set(id, show)
  const timer = setTimeout(() => {
    if (pending.delete(id)) {
      console.warn('WINDOW_READY_TIMEOUT', window.getTitle())
      show()
    }
  }, timeoutMs)
  timer.unref?.()
  window.once('closed', () => {
    clearTimeout(timer)
    pending.delete(id)
  })
}

/** 渲染层完成首帧渲染后调用；返回 false 表示这个窗口没有在等待显示。 */
export function markWindowReady(webContentsId: number): boolean {
  const show = pending.get(webContentsId)
  if (!show) return false
  pending.delete(webContentsId)
  show()
  return true
}
