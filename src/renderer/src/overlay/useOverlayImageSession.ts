import { useCallback, useRef, useState } from 'react'
import type { OverlayInit } from '../../../shared/types'

export interface OverlayImageSession {
  init: OverlayInit | null
  preparing: boolean
  imageReady: boolean
  load(data: OverlayInit, resetUi: () => void): void
  clear(resetUi: () => void, preparing: boolean): void
}

/**
 * 背景：覆盖层初始化、取消和重新准备都要同步图片解码状态和 UI 状态。
 * 设计意图：把 init/preparing/imageReady 和图片解码令牌收进 hook，UI reset 由调用方注入。
 * 关键约束：旧图片加载完成不能覆盖新会话；解码失败也要结束 preparing，不能卡在加载态。
 */
export function useOverlayImageSession(): OverlayImageSession {
  const [init, setInit] = useState<OverlayInit | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [imageReady, setImageReady] = useState(false)
  const tokenRef = useRef(0)

  const load = useCallback((data: OverlayInit, resetUi: () => void): void => {
    const token = ++tokenRef.current
    setPreparing(true)
    setImageReady(false)
    resetUi()
    const image = new Image()
    const commit = (): void => {
      if (tokenRef.current !== token) return
      image.onload = null
      image.onerror = null
      image.removeAttribute('src')
      setInit(data)
      setPreparing(false)
      setImageReady(true)
    }
    image.onload = commit
    image.onerror = commit
    image.src = data.imageDataUrl
  }, [])

  const clear = useCallback((resetUi: () => void, nextPreparing: boolean): void => {
    tokenRef.current += 1
    setPreparing(nextPreparing)
    setImageReady(false)
    resetUi()
    setInit(null)
  }, [])

  return { init, preparing, imageReady, load, clear }
}
