import { app, Menu, Tray, nativeImage, nativeTheme } from 'electron'
import { trayIconDataUrl } from './tray-icon'
import { t, type Language } from '../shared/i18n'

export interface TrayActions {
  onCapture: () => void
  onSettings: () => void
  onFeedback: () => void
  onQuit: () => void
}

export function buildTrayMenu(actions: TrayActions, language: Language): Menu {
  return Menu.buildFromTemplate([
    { label: t(language, '截图  F1'), click: actions.onCapture },
    { label: t(language, '设置'), click: actions.onSettings },
    { type: 'separator' },
    { label: t(language, '意见反馈…'), click: actions.onFeedback },
    { type: 'separator' },
    { label: t(language, '退出 Pixmint'), click: actions.onQuit }
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
