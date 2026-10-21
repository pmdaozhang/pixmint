import type { Point, Rect } from './types'

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  }
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

export function clampRect(rect: Rect, bounds: Rect): Rect {
  const left = clamp(rect.x, bounds.x, bounds.x + bounds.width)
  const top = clamp(rect.y, bounds.y, bounds.y + bounds.height)
  const right = clamp(rect.x + rect.width, bounds.x, bounds.x + bounds.width)
  const bottom = clamp(rect.y + rect.height, bounds.y, bounds.y + bounds.height)
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  }
}

export interface DimPanels {
  top: Rect
  left: Rect
  right: Rect
  bottom: Rect
}

/**
 * 背景：截图覆盖层需要在选区外画暗色遮罩。
 * 设计意图：用四块实色矩形替代 `box-shadow: 0 0 0 9999px`，避免 Chromium
 * 为全屏透明窗口分配超大阴影层；大选区时这是最容易拖死合成器的路径。
 * 关键约束：选区会先被限制在 bounds 内，四块矩形允许出现 0 宽/0 高，
 * 调用方应跳过空矩形，避免无意义的 DOM 节点。
 */
export function dimPanelsFor(hole: Rect, bounds: Rect): DimPanels {
  const inner = clampRect(hole, bounds)
  const right = inner.x + inner.width
  const bottom = inner.y + inner.height
  return {
    top: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: Math.max(0, inner.y - bounds.y)
    },
    left: {
      x: bounds.x,
      y: inner.y,
      width: Math.max(0, inner.x - bounds.x),
      height: inner.height
    },
    right: {
      x: right,
      y: inner.y,
      width: Math.max(0, bounds.x + bounds.width - right),
      height: inner.height
    },
    bottom: {
      x: bounds.x,
      y: bottom,
      width: bounds.width,
      height: Math.max(0, bounds.y + bounds.height - bottom)
    }
  }
}

export interface ImageCrop {
  sx: number
  sy: number
  sw: number
  sh: number
}

/** 把覆盖层 DIP 选区换算成原始截图里的物理像素裁剪区域。 */
export function cropRectToImage(
  selection: Rect,
  displayBounds: Rect,
  imageWidth: number,
  imageHeight: number
): ImageCrop {
  const scaleX = displayBounds.width > 0 ? imageWidth / displayBounds.width : 1
  const scaleY = displayBounds.height > 0 ? imageHeight / displayBounds.height : 1
  const sx = clamp(selection.x * scaleX, 0, imageWidth)
  const sy = clamp(selection.y * scaleY, 0, imageHeight)
  const sw = clamp(selection.width * scaleX, 0, imageWidth - sx)
  const sh = clamp(selection.height * scaleY, 0, imageHeight - sy)
  return { sx, sy, sw, sh }
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y)
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1)
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t))
}
