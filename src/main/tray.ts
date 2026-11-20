import { execFileSync } from 'node:child_process'
import { app, Menu, Tray, nativeImage, nativeTheme } from 'electron'
import type { UpdateState } from '../shared/types'
import { trayIconDataUrl, type TrayDownloadFrame } from './tray-icon'
import { proIconDataUrl } from './pro-icon'
import { t, type Language } from '../shared/i18n'

export interface TrayActions {
  onCapture: () => void
  onSettings: () => void
  onUpgrade: () => void
  onFeedback: () => void
  onShowUpdate?: () => void
  /** 分享减会员费入口；返回 null 表示活动已结束，菜单里不出现这一项 */
  getShare?: () => { count: number } | null
  onShare: () => void
  onQuit: () => void
  isPro: () => boolean
}

/**
 * 托盘里的分享入口：只保留一行主标签，分享进度在弹框里展示。
 * Windows 原生菜单的小字容易被截断，菜单里不再放 sublabel。
 */
function shareMenuItems(actions: TrayActions, language: Language): Electron.MenuItemConstructorOptions[] {
  const share = actions.getShare?.()
  // 已购用户的入口由 getShare 返回 null 隐藏；进度只在弹框里展示，菜单保持单行不拥挤
  if (!share) return []
  return [{ label: t(language, '分享得会员'), click: actions.onShare }]
}

function proIcon(): Electron.NativeImage {
  return nativeImage
    .createFromDataURL(proIconDataUrl())
    .resize({ width: 16, height: 16 })
}

function updatePercent(update: UpdateState): number {
  return Math.round(update.progress?.percent ?? 0)
}

/** 托盘 tooltip 里显示后台下载/安装进度。 */
export function trayTooltip(update: UpdateState): string {
  const base = `Pixmint ${app.getVersion()}`
  if (update.status === 'downloading' || update.status === 'verifying') {
    return `${base} · 后台更新 ${updatePercent(update)}%`
  }
  if (update.status === 'downloaded' || update.status === 'installing') {
    return `${base} · 正在安装更新…`
  }
  return base
}

function updateMenuItems(
  actions: TrayActions,
  language: Language,
  update: UpdateState
): Electron.MenuItemConstructorOptions[] {
  if (update.status === 'downloading' || update.status === 'verifying') {
    return [
      {
        label: t(language, '后台更新中 {percent}%', { percent: updatePercent(update) }),
        enabled: false
      },
      { label: t(language, '查看更新进度'), click: actions.onShowUpdate }
    ]
  }
  if (update.status === 'downloaded' || update.status === 'installing') {
    return [{ label: t(language, '正在安装更新…'), enabled: false }]
  }
  return []
}

export function buildTrayMenu(
  actions: TrayActions,
  language: Language,
  update: UpdateState = { status: 'idle' }
): Menu {
  const pro = actions.isPro()
  const updateItems = updateMenuItems(actions, language, update)
  if (updateItems.length > 0) updateItems.push({ type: 'separator' })
  return Menu.buildFromTemplate([
    { label: t(language, '截图  F1'), click: actions.onCapture },
    { label: t(language, '设置'), click: actions.onSettings },
    ...updateItems,
    { type: 'separator' },
    // 会员入口单独成组：未购买显示「升级会员」，已购买显示带金色皇冠图标的「终身会员」。
    pro
      ? { label: t(language, '终身会员'), icon: proIcon(), click: actions.onUpgrade }
      : { label: t(language, '升级会员'), click: actions.onUpgrade },
    ...shareMenuItems(actions, language),
    { type: 'separator' },
    { label: t(language, '意见反馈…'), click: actions.onFeedback },
    { type: 'separator' },
    { label: t(language, '退出'), click: actions.onQuit }
  ])
}

const TRAY_SIZE = { width: 16, height: 16 }

/**
 * 托盘图标跟随 Windows 任务栏主题，而不是应用主题。
 * nativeTheme.themeSource 会被应用设置改成 light/dark，直接读 shouldUseDarkColors
 * 会在“应用深色 + 系统浅色任务栏”时选中白色图标，落在浅色托盘上几乎看不见。
 */
function readSystemTrayIsDark(): boolean {
  if (process.platform === 'win32') {
    try {
      const output = execFileSync(
        'reg',
        [
          'query',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
          '/v',
          'SystemUsesLightTheme'
        ],
        { encoding: 'utf8', windowsHide: true }
      )
      const match = /SystemUsesLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(output)
      if (match) return Number.parseInt(match[1], 16) === 0
    } catch {
      // 读不到注册表时退回 nativeTheme，至少不会比原来更差
    }
  }
  return nativeTheme.shouldUseDarkColors
}

// 下载动画每 600ms 会重建一次图标，不能每次都 spawn 一个 reg 进程。
let systemTrayDarkCache: boolean | null = null

function systemTrayIsDark(): boolean {
  if (systemTrayDarkCache === null) systemTrayDarkCache = readSystemTrayIsDark()
  return systemTrayDarkCache
}

function refreshSystemTrayTheme(): void {
  systemTrayDarkCache = readSystemTrayIsDark()
}

function trayImage(downloadFrame?: TrayDownloadFrame): Electron.NativeImage {
  return nativeImage
    .createFromDataURL(trayIconDataUrl(systemTrayIsDark(), downloadFrame))
    .resize(TRAY_SIZE)
}

let downloadTimer: ReturnType<typeof setInterval> | null = null
let downloadFrame: TrayDownloadFrame = 0
let downloading = false

/**
 * 下载中让托盘图标在两帧之间切换，形成缓慢的上下浮动。
 * 更新进度会频繁触发 onState，状态相同直接返回，避免每次都重置换帧定时器。
 */
export function setTrayDownloading(target: Tray, active: boolean): void {
  if (active === downloading) return
  if (downloadTimer) {
    clearInterval(downloadTimer)
    downloadTimer = null
  }
  downloading = active
  if (!active) {
    downloadFrame = 0
    target.setImage(trayImage())
    return
  }
  target.setImage(trayImage(downloadFrame))
  downloadTimer = setInterval(() => {
    downloadFrame = downloadFrame === 0 ? 1 : 0
    target.setImage(trayImage(downloadFrame))
  }, 600)
}

export function createTray(actions: TrayActions, language: Language): Tray {
  refreshSystemTrayTheme()
  const tray = new Tray(trayImage())
  const updateIcon = (): void => {
    if (tray.isDestroyed()) return
    refreshSystemTrayTheme()
    tray.setImage(downloading ? trayImage(downloadFrame) : trayImage())
  }
  nativeTheme.on('updated', updateIcon)
  // 应用主题固定时 nativeTheme 不一定会在系统任务栏换色时发事件，低频兜底检查。
  setInterval(() => {
    if (tray.isDestroyed()) return
    const next = readSystemTrayIsDark()
    if (next === systemTrayDarkCache) return
    systemTrayDarkCache = next
    tray.setImage(downloading ? trayImage(downloadFrame) : trayImage())
  }, 60_000).unref()
  tray.setToolTip(`Pixmint ${app.getVersion()}`)
  tray.setContextMenu(buildTrayMenu(actions, language))
  // Windows 上 setContextMenu 后左键单击不会自动弹出，手动弹出；
  // 分享进度可能在菜单收起期间变化，弹出前重建一次，保证小字里的次数是最新的。
  tray.on('click', () => {
    tray.setContextMenu(buildTrayMenu(actions, language))
    tray.popUpContextMenu()
  })
  return tray
}
