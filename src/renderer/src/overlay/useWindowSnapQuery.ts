import { useCallback, useEffect, useRef, useState } from 'react'
import type { OverlayInit, Rect } from '../../../shared/types'
import { clampWindowRect } from './selection-geometry'

export interface WindowSnapQuery {
  hoverRect: Rect | null
  querySnap(point: { x: number; y: number }): void
  cancelSnap(): void
}

/**
 * 背景：鼠标悬停窗口吸附涉及节流、异步查询和最新请求优先，散在主组件里容易竞态。
 * 设计意图：把 hoverRect、查询令牌和指针位置收进 hook，只暴露 query/cancel。
 * 关键约束：旧查询结果不能覆盖新位置；取消后不能再回写 hoverRect。
 */
export function useWindowSnapQuery(init: OverlayInit | null): WindowSnapQuery {
  const [hoverRect, setHoverRect] = useState<Rect | null>(null)
  const queryIdRef = useRef(0)
  const lastSnapAtRef = useRef(0)
  const lastSnapPointRef = useRef<{ x: number; y: number } | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const busyRef = useRef(false)

  const cancelSnap = useCallback(() => {
    queryIdRef.current += 1
    lastSnapPointRef.current = null
    lastPointerRef.current = null
    busyRef.current = false
    setHoverRect(null)
  }, [])

  const querySnap = useCallback(
    (point: { x: number; y: number }) => {
      if (!init) return
      lastPointerRef.current = point
      if (busyRef.current) return
      const now = performance.now()
      const lastPoint = lastSnapPointRef.current
      if (lastPoint && Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 2) return
      if (now - lastSnapAtRef.current < 30) return
      lastSnapAtRef.current = now
      lastSnapPointRef.current = point
      const queryId = ++queryIdRef.current
      busyRef.current = true
      void window.snapglass.overlay
        .windowAt(point.x + init.bounds.x, point.y + init.bounds.y)
        .then((rect) => {
          if (queryId !== queryIdRef.current) return
          setHoverRect(rect ? clampWindowRect(rect, init.bounds) : null)
        })
        .catch(() => {
          if (queryId === queryIdRef.current) setHoverRect(null)
        })
        .finally(() => {
          busyRef.current = false
          const latest = lastPointerRef.current
          if (
            latest &&
            (Math.abs(latest.x - point.x) > 2 || Math.abs(latest.y - point.y) > 2)
          ) {
            querySnap(latest)
          }
        })
    },
    [init]
  )

  useEffect(() => {
    cancelSnap()
  }, [init, cancelSnap])

  return { hoverRect, querySnap, cancelSnap }
}
