import { clipboard, nativeImage, Notification } from 'electron'
import { writeFileSync } from 'node:fs'

export function imageFromDataUrl(dataUrl: string): Electron.NativeImage {
  return nativeImage.createFromDataURL(dataUrl)
}

export function imageFromBytes(bytes: Uint8Array): Electron.NativeImage {
  return nativeImage.createFromBuffer(Buffer.from(bytes))
}

export function copyImage(dataUrl: string): void {
  clipboard.writeImage(imageFromDataUrl(dataUrl))
}

export function copyImageBytes(bytes: Uint8Array): void {
  clipboard.writeImage(imageFromBytes(bytes))
}

export function saveImage(dataUrl: string, filePath: string): void {
  writeFileSync(filePath, imageFromDataUrl(dataUrl).toPNG())
}

export function saveImageBytes(bytes: Uint8Array, filePath: string): void {
  writeFileSync(filePath, imageFromBytes(bytes).toPNG())
}

export function notify(body: string): void {
  try {
    new Notification({ title: 'Pixmint', body, silent: true }).show()
  } catch {
    // 通知不可用时不影响主流程
  }
}
