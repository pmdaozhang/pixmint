import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { OverlayInit } from '../../../shared/types'

export interface OverlayImageSession {
  init: OverlayInit | null
  preparing: boolean
  imageReady: boolean
  canvasRef: RefObject<HTMLCanvasElement | null>
  load(data: OverlayInit, resetUi: () => void): void
  clear(resetUi: () => void, preparing: boolean): void
}

/**
 * 背景：覆盖层初始化、取消和重新准备都要同步图片解码状态和 UI 状态。
 * 设计意图：把 init/preparing/imageReady 和图片解码令牌收进 hook，UI reset 由调用方注入。
 * 关键约束：旧图片加载完成不能覆盖新会话；解码失败也要结束 preparing，不能卡在加载态。
 */
/**
 * 背景：快速路径现在直接传 PNG 字节（原生抓屏），不再有 base64。
 * 兼容路径仍可能给 data URL；用 <img>.decode() 交给浏览器原生解码，
 * 避免几 MB 的字符串在渲染主线程里逐字节 atob 循环，也不放宽 CSP 的 connect-src。
 */
async function imageToBitmap(data: OverlayInit): Promise<ImageBitmap> {
  if (data.imageBytes && data.imageBytes.length > 0) {
    // IPC 传回来的字节是普通 ArrayBuffer；TS 的 Uint8Array<ArrayBufferLike> 需要收窄。
    return createImageBitmap(new Blob([data.imageBytes as unknown as BlobPart], { type: 'image/png' }))
  }
  const image = new Image()
  image.src = data.imageDataUrl
  await image.decode()
  return createImageBitmap(image)
}

export function useOverlayImageSession(): OverlayImageSession {
  const [init, setInit] = useState<OverlayInit | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [imageReady, setImageReady] = useState(false)
  const tokenRef = useRef(0)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  if (!canvasRef.current) {
    const canvas = document.createElement('canvas')
    canvas.className = 'overlay-screen'
    canvas.style.visibility = 'hidden'
    canvasRef.current = canvas
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const root = document.getElementById('root')
    if (root?.parentNode) root.parentNode.insertBefore(canvas, root)
    else document.body.appendChild(canvas)
    return () => canvas.remove()
  }, [])

  const load = useCallback((data: OverlayInit, resetUi: () => void): void => {
    const token = ++tokenRef.current
    const decodeStartedAt = performance.now()
    setPreparing(true)
    setImageReady(false)
    resetUi()
    void (async () => {
      let bitmap: ImageBitmap | null = null
      const releasePayload = (): void => {
        // 解码结果已经落到 canvas，PNG 字节/data URL 不再被 React 状态持有。
        setInit({ ...data, imageDataUrl: '', imageBytes: undefined })
      }
      try {
        bitmap = await imageToBitmap(data)
        if (tokenRef.current !== token) return
        const canvas = canvasRef.current
        if (canvas) {
          if (canvas.width !== bitmap.width) canvas.width = bitmap.width
          if (canvas.height !== bitmap.height) canvas.height = bitmap.height
          const context = canvas.getContext('2d')
          if (context) {
            context.clearRect(0, 0, canvas.width, canvas.height)
            context.drawImage(bitmap, 0, 0)
          }
        }
        releasePayload()
      } catch (error) {
        if (tokenRef.current !== token) return
        console.warn('OVERLAY_IMAGE_DECODE_FAILED', error)
        releasePayload()
      } finally {
        bitmap?.close()
        if (tokenRef.current === token) {
          setPreparing(false)
          setImageReady(true)
        }
        // 解码/绘制明显变慢时落一条 warn，方便线上定位“遮罩晚几秒”。
        const decodeMs = performance.now() - decodeStartedAt
        if (decodeMs > 400) {
          console.warn(
            'OVERLAY_DECODE_SLOW',
            Math.round(decodeMs),
            data.imageBytes?.length ?? data.imageDataUrl.length
          )
        }
      }
    })()
  }, [canvasRef])

  const clear = useCallback((resetUi: () => void, nextPreparing: boolean): void => {
    tokenRef.current += 1
    setPreparing(nextPreparing)
    setImageReady(false)
    resetUi()
    setInit(null)
    const canvas = canvasRef.current
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }, [canvasRef])

  return { init, preparing, imageReady, canvasRef, load, clear }
}
