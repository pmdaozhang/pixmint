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
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const header = dataUrl.slice(0, comma)
  const base64 = dataUrl.slice(comma + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  const mime = /^data:([^;]+)/.exec(header)?.[1] ?? 'image/png'
  return new Blob([bytes], { type: mime })
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
    setPreparing(true)
    setImageReady(false)
    resetUi()
    void (async () => {
      let bitmap: ImageBitmap | null = null
      try {
        bitmap = await createImageBitmap(dataUrlToBlob(data.imageDataUrl))
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
        // 解码结果已经落到 canvas，data URL 不再被 React 状态持有。
        setInit({ ...data, imageDataUrl: '' })
      } catch (error) {
        if (tokenRef.current !== token) return
        console.warn('OVERLAY_IMAGE_DECODE_FAILED', error)
        setInit({ ...data, imageDataUrl: '' })
      } finally {
        bitmap?.close()
        if (tokenRef.current === token) {
          setPreparing(false)
          setImageReady(true)
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
