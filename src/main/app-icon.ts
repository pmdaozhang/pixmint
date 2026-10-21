import { app, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function appIconPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  const markIco = join(base, 'assets', 'icon-mark.ico')
  if (process.platform === 'win32' && existsSync(markIco)) return markIco
  const icoPath = join(base, 'assets', 'icon.ico')
  // Windows 任务栏对 PNG 的缩放经常回退到进程默认图标，优先用多尺寸 ICO。
  if (process.platform === 'win32' && existsSync(icoPath)) return icoPath
  return join(base, 'assets', 'icon.png')
}

export function appIcon(): Electron.NativeImage {
  const image = nativeImage.createFromPath(appIconPath())
  if (!image.isEmpty()) return image
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  const markPng = nativeImage.createFromPath(join(base, 'assets', 'icon-mark.png'))
  if (!markPng.isEmpty()) return markPng
  // asar 内的 ICO 在部分 Electron 版本无法被 nativeImage 直接读取，回退 PNG。
  return nativeImage.createFromPath(join(base, 'assets', 'icon.png'))
}
