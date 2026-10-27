import { nativeImage } from 'electron'
import type { FrameImage } from '../../shared/long-capture'

/**
 * 把 Electron NativeImage 转成长截图使用的 BGRA 帧。
 * nativeImage.toBitmap() 的输出格式与 FrameImage 约定一致。
 */
export function frameFromNativeImage(image: Electron.NativeImage): FrameImage {
  if (image.isEmpty()) throw new Error('截图帧为空')
  const size = image.getSize()
  const data = new Uint8Array(image.toBitmap())
  if (data.length !== size.width * size.height * 4) {
    throw new Error('截图帧像素长度异常')
  }
  return { width: size.width, height: size.height, data }
}

export function frameFromPng(bytes: Uint8Array): FrameImage {
  return frameFromNativeImage(nativeImage.createFromBuffer(Buffer.from(bytes)))
}

export function frameFromDataUrl(dataUrl: string): FrameImage {
  return frameFromNativeImage(nativeImage.createFromDataURL(dataUrl))
}

export function encodePng(frame: FrameImage): Buffer {
  const image = nativeImage.createFromBitmap(Buffer.from(frame.data), {
    width: frame.width,
    height: frame.height
  })
  if (image.isEmpty()) throw new Error('长图编码失败')
  return image.toPNG()
}
