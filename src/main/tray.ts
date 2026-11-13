import { app, Menu, Tray, nativeImage, nativeTheme } from 'electron'
import type { UpdateState } from '../shared/types'
import { trayIconDataUrl } from './tray-icon'
import { proIconDataUrl } from './pro-icon'
import { t, type Language } from '../shared/i18n'

export interface TrayActions {
  onCapture: () => void
  onSettings: () => void
  onUpgrade: () => void
  onFeedback: () => void
  onShowUpdate?: () => void
  onQuit: () => void
  isPro: () => boolean
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
    { type: 'separator' },
    { label: t(language, '意见反馈…'), click: actions.onFeedback },
    { type: 'separator' },
    { label: t(language, '退出'), click: actions.onQuit }
  ])
}

export function createTray(actions: TrayActions, language: Language): Tray {
  const image = nativeImage
    .createFromDataURL(trayIconDataUrl(nativeTheme.shouldUseDarkColors))
    .resize({ width: 16, height: 16 })
  const tray = new Tray(image)
  const updateIcon = (): void => {
    tray.setImage(
      nativeImage
        .createFromDataURL(trayIconDataUrl(nativeTheme.shouldUseDarkColors))
        .resize({ width: 16, height: 16 })
    )
  }
  nativeTheme.on('updated', updateIcon)
  tray.setToolTip(`Pixmint ${app.getVersion()}`)
  tray.setContextMenu(buildTrayMenu(actions, language))
  tray.on('click', () => tray.popUpContextMenu())
  return tray
}
