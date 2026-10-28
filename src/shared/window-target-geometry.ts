import type { Rect } from './types'

export interface WindowTargetRects {
  windowRect: Rect
  clientRect: Rect
  contentRect: Rect
  displayRect: Rect
}

function intersection(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y)
  }
}

/**
 * 背景：UI Automation 可能返回屏幕外或极小的滚动元素，直接把坐标交给选区层会导致“没有边框”。
 * 设计意图：按内容区、客户区、窗口区依次回退，并裁剪到目标显示器可见范围。
 * 关键约束：返回物理像素矩形；调用方负责按所在显示器 DPI 转成 DIP。
 */
export function chooseWindowTargetContentRect(
  rects: WindowTargetRects,
  minVisible = 40
): Rect | null {
  const clientVisible = intersection(rects.clientRect, rects.displayRect)
  const clientArea = Math.max(1, clientVisible.width * clientVisible.height)
  const candidates: Array<{ rect: Rect; minAreaRatio: number }> = [
    { rect: rects.contentRect, minAreaRatio: 0.35 },
    { rect: rects.clientRect, minAreaRatio: 0 },
    { rect: rects.windowRect, minAreaRatio: 0 }
  ]
  for (const { rect: candidate, minAreaRatio } of candidates) {
    if (candidate.width <= 0 || candidate.height <= 0) continue
    const visible = intersection(candidate, rects.displayRect)
    if (visible.width < minVisible || visible.height < minVisible) continue
    if (visible.width * visible.height < clientArea * minAreaRatio) continue
    return {
      x: Math.round(visible.x),
      y: Math.round(visible.y),
      width: Math.round(visible.width),
      height: Math.round(visible.height)
    }
  }
  return null
}
