import { app, Menu, Tray, nativeImage, nativeTheme } from 'electron'
import { trayIconDataUrl } from './tray-icon'

export interface TrayActions {
  onCapture: () => void
  onRecordGif: () => void
  onRecordVideo: () => void
  onSettings: () => void
  onQuit: () => void
}

export function createTray(actions: TrayActions): Tray {
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
  const menu = Menu.buildFromTemplate([
    { label: '截图  F1', click: actions.onCapture },
    { label: 'GIF 录制  F2', click: actions.onRecordGif },
    { label: '视频录制  F4', click: actions.onRecordVideo },
    { label: '设置', click: actions.onSettings },
    { type: 'separator' },
    { label: '退出 Pixmint', click: actions.onQuit }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => tray.popUpContextMenu())
  return tray
}
