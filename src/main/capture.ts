import { desktopCapturer, screen } from 'electron'
import type { DisplayCapture } from '../shared/types'
import { fastCapture } from './fast-capture'

/**
 * 先截屏再创建覆盖层，避免把覆盖层自身截进去。
 * 每个显示器独立返回原图，物理像素尺寸由 Electron thumbnail 实际大小决定。
 */
export async function captureDisplays(): Promise<DisplayCapture[]> {
  const displays = screen.getAllDisplays()
  if (displays.length === 0) throw new Error('没有检测到可截图的显示器')
  const maxWidth = Math.max(
    ...displays.map((display) => Math.round(display.bounds.width * display.scaleFactor))
  )
  const maxHeight = Math.max(
    ...displays.map((display) => Math.round(display.bounds.height * display.scaleFactor))
  )
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxWidth, height: maxHeight },
    fetchWindowIcons: false
  })
  if (sources.length === 0) {
    throw new Error('无法读取屏幕。请检查系统的屏幕录制权限。')
  }
  const captures: DisplayCapture[] = []
  displays.forEach((display, index) => {
    const source =
      sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[index]
    if (!source || source.thumbnail.isEmpty()) return
    const size = source.thumbnail.getSize()
    captures.push({
      displayId: display.id,
      bounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      },
      scaleFactor: display.scaleFactor,
      imageDataUrl: source.thumbnail.toDataURL(),
      imageWidth: size.width,
      imageHeight: size.height
    })
  })
  if (captures.length === 0) throw new Error('截图源为空，可能是屏幕录制权限未开启')
  return captures
}

/** 只截当前显示器，减少 F1 到覆盖层出现的等待时间。 */
export async function captureDisplay(display: Electron.Display): Promise<DisplayCapture> {
  const width = Math.max(1, Math.round(display.bounds.width * display.scaleFactor))
  const height = Math.max(1, Math.round(display.bounds.height * display.scaleFactor))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false
  })
  const source =
    sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('无法读取屏幕。请检查系统的屏幕录制权限。')
  }
  const size = source.thumbnail.getSize()
  return {
    displayId: display.id,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    },
    scaleFactor: display.scaleFactor,
    imageDataUrl: source.thumbnail.toDataURL(),
    imageWidth: size.width,
    imageHeight: size.height
  }
}

/** GDI 快速截屏；失败或超时返回 null，由调用方回退到 desktopCapturer。 */
export async function captureDisplayFast(
  display: Electron.Display
): Promise<DisplayCapture | null> {
  const physical = screen.dipToScreenRect(null, display.bounds)
  const dataUrl = await fastCapture.capture(physical)
  if (!dataUrl) return null
  return {
    displayId: display.id,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    },
    scaleFactor: display.scaleFactor,
    imageDataUrl: dataUrl,
    imageWidth: physical.width,
    imageHeight: physical.height
  }
}
