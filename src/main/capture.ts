import { desktopCapturer, screen } from 'electron'
import type { DisplayCapture } from '../shared/types'
import { logDiagnostic } from './diagnostics'
import { fastCapture } from './fast-capture'

interface NativeImageLike {
  width: number
  height: number
  toPngSync(): Buffer
}

interface NativeMonitorClass {
  all(): NativeImageMonitorLike[]
  fromPoint(x: number, y: number): NativeImageMonitorLike | null
}

interface NativeImageMonitorLike {
  captureImageSync(): NativeImageLike
}

let nativeMonitorPromise: Promise<NativeMonitorClass | null> | null = null

/**
 * 背景：常驻 PowerShell + GDI + System.Drawing 的 PNG 编码在 1080p 下要 ~190ms
 *（GDI 85ms + PNG 118ms），是 F1 延迟的最后一段大头。
 * 设计意图：优先使用 node-screenshots 的原生抓屏（Windows Graphics Capture），
 * 实测抓取 + PNG 编码 65–87ms；模块不可用时自动回退到 PowerShell / desktopCapturer。
 * 关键约束：原生模块按需加载，加载失败只记日志，不能影响应用启动和截图。
 */
function loadNativeMonitor(): Promise<NativeMonitorClass | null> {
  if (nativeMonitorPromise) return nativeMonitorPromise
  nativeMonitorPromise = import('node-screenshots')
    .then((module) => {
      const mod = module as unknown as {
        Monitor?: NativeMonitorClass
        default?: { Monitor?: NativeMonitorClass }
      }
      const Monitor = mod.Monitor ?? mod.default?.Monitor ?? null
      if (!Monitor) logDiagnostic('capture', 'native capture module has no Monitor', 'warn')
      return Monitor
    })
    .catch((error: unknown) => {
      logDiagnostic('capture', `native capture unavailable: ${String(error)}`, 'warn')
      return null
    })
  return nativeMonitorPromise
}

/** 启动/唤醒时提前加载原生模块，避免第一次 F1 现场 require。 */
export function prewarmNativeCapture(): void {
  void loadNativeMonitor()
}

async function captureNative(display: Electron.Display): Promise<DisplayCapture | null> {
  const Monitor = await loadNativeMonitor()
  if (!Monitor) return null
  try {
    const scale = display.scaleFactor || 1
    const px = Math.round(display.bounds.x * scale) + 1
    const py = Math.round(display.bounds.y * scale) + 1
    const monitor = Monitor.fromPoint(px, py) ?? Monitor.all()[0]
    if (!monitor) return null
    const started = Date.now()
    const image = monitor.captureImageSync()
    const png = image.toPngSync()
    if (!png || png.length === 0) return null
    const elapsed = Date.now() - started
    if (elapsed > 120) {
      logDiagnostic('capture', `native capture slow ${elapsed}ms`, 'warn')
    }
    return {
      displayId: display.id,
      bounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      },
      scaleFactor: display.scaleFactor,
      imageDataUrl: '',
      imageBytes: png,
      imageWidth: image.width,
      imageHeight: image.height
    }
  } catch (error) {
    logDiagnostic('capture', `native capture failed: ${String(error)}`, 'warn')
    return null
  }
}

function thumbnailToCapture(
  display: Electron.Display,
  source: Electron.DesktopCapturerSource
): DisplayCapture | null {
  if (!source || source.thumbnail.isEmpty()) return null
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
    imageDataUrl: '',
    imageBytes: source.thumbnail.toPNG(),
    imageWidth: size.width,
    imageHeight: size.height
  }
}

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
    const capture = thumbnailToCapture(display, source)
    if (capture) captures.push(capture)
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
  const capture = thumbnailToCapture(display, source)
  if (!capture) {
    throw new Error('无法读取屏幕。请检查系统的屏幕录制权限。')
  }
  return capture
}

/** 原生抓屏优先；失败时回退到常驻 PowerShell；再失败由调用方回退 desktopCapturer。 */
export async function captureDisplayFast(
  display: Electron.Display
): Promise<DisplayCapture | null> {
  const native = await captureNative(display)
  if (native) return native
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
