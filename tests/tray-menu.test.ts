import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: unknown[]) => ({ items: template })
  },
  nativeImage: {
    createFromDataURL: () => ({
      resize: () => ({ isEmpty: () => false, proIcon: true })
    })
  },
  Tray: class {},
  app: { getVersion: () => '0.0.0' },
  nativeTheme: { shouldUseDarkColors: true, on: () => undefined }
}))

import { buildTrayMenu, setTrayDownloading, type TrayActions } from '../src/main/tray'

interface MenuItemShape {
  label?: string
  type?: string
  icon?: unknown
  click?: () => void
}

function actions(pro: boolean): TrayActions {
  return {
    onCapture: vi.fn(),
    onSettings: vi.fn(),
    onUpgrade: vi.fn(),
    onFeedback: vi.fn(),
    onQuit: vi.fn(),
    isPro: () => pro
  }
}

function items(menu: ReturnType<typeof buildTrayMenu>): MenuItemShape[] {
  return (menu as unknown as { items: MenuItemShape[] }).items
}

describe('托盘会员入口', () => {
  it('未购买时单独成组显示「升级会员」，不带图标', () => {
    const template = items(buildTrayMenu(actions(false), 'zh-CN'))
    expect(template.map((item) => item.label ?? `[${item.type}]`)).toEqual([
      '截图  F1',
      '设置',
      '[separator]',
      '升级会员',
      '[separator]',
      '意见反馈…',
      '[separator]',
      '退出'
    ])
    expect(template[3].icon).toBeUndefined()
  })

  it('已购买时显示「终身会员」并带金色皇冠图标', () => {
    const template = items(buildTrayMenu(actions(true), 'zh-CN'))
    expect(template[3].label).toBe('终身会员')
    expect(template[3].icon).toBeDefined()
  })

  it('点击会员入口打开购买窗', () => {
    const handlers = actions(false)
    items(buildTrayMenu(handlers, 'zh-CN'))[3].click?.()
    expect(handlers.onUpgrade).toHaveBeenCalledTimes(1)
  })

  it('英文语言下文案正确', () => {
    const template = items(buildTrayMenu(actions(true), 'en-US'))
    expect(template[3].label).toBe('Lifetime member')
    expect(template[7].label).toBe('Quit')
  })
})

describe('托盘下载动画', () => {
  it('状态切换时启动换帧，重复状态不重置，结束后停止', () => {
    vi.useFakeTimers()
    const setImage = vi.fn()
    const tray = { setImage } as unknown as Parameters<typeof setTrayDownloading>[0]

    setTrayDownloading(tray, true)
    const started = setImage.mock.calls.length
    expect(started).toBeGreaterThan(0)

    vi.advanceTimersByTime(600)
    expect(setImage.mock.calls.length).toBe(started + 1)

    // 进度更新会反复调用；相同状态不能把定时器重置回第一帧
    setTrayDownloading(tray, true)
    vi.advanceTimersByTime(600)
    expect(setImage.mock.calls.length).toBe(started + 2)

    setTrayDownloading(tray, false)
    const stopped = setImage.mock.calls.length
    vi.advanceTimersByTime(1800)
    expect(setImage.mock.calls.length).toBe(stopped)
    vi.useRealTimers()
  })
})
