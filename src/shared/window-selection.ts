import type { Rect } from './types'

export type SelectionHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const SELECTION_HANDLES: SelectionHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w'
]

export const MIN_WINDOW_SELECTION = 120

/**
 * 背景：窗口长截图选区必须始终落在目标窗口内容区，页面缩放或小窗口不能产生负宽高。
 * 设计意图：把所有边界收口到纯函数，UI 只负责把指针位移传进来，便于单测覆盖八个方向。
 * 关键约束：窗口内容区小于最小尺寸时，以边界尺寸为准，不能把选区反向折叠。
 */
export function clampWindowSelection(
  rect: Rect,
  bounds: Rect,
  minSize = MIN_WINDOW_SELECTION
): Rect {
  const maxWidth = Math.max(1, bounds.width)
  const maxHeight = Math.max(1, bounds.height)
  const minWidth = Math.min(minSize, maxWidth)
  const minHeight = Math.min(minSize, maxHeight)
  const width = Math.max(minWidth, Math.min(rect.width, maxWidth))
  const height = Math.max(minHeight, Math.min(rect.height, maxHeight))
  return {
    x: Math.max(bounds.x, Math.min(rect.x, bounds.x + maxWidth - width)),
    y: Math.max(bounds.y, Math.min(rect.y, bounds.y + maxHeight - height)),
    width,
    height
  }
}

/**
 * 背景：用户拖动四角或边线时，只应改变对应边，另一侧保持固定。
 * 设计意图：先按方向计算原始矩形，再统一做边界与最小尺寸约束，避免每个手柄各写一套 clamp。
 * 关键约束：西/北方向改变原点时必须同步改变宽高，不能只移动选区。
 */
export function resizeWindowSelection(
  start: Rect,
  handle: SelectionHandle,
  dx: number,
  dy: number,
  bounds: Rect,
  minSize = MIN_WINDOW_SELECTION
): Rect {
  const minWidth = Math.min(minSize, Math.max(1, bounds.width))
  const minHeight = Math.min(minSize, Math.max(1, bounds.height))
  const boundsRight = bounds.x + bounds.width
  const boundsBottom = bounds.y + bounds.height
  const startRight = start.x + start.width
  const startBottom = start.y + start.height
  let left = start.x
  let top = start.y
  let right = startRight
  let bottom = startBottom
  if (handle.includes('w')) {
    left = Math.max(bounds.x, Math.min(start.x + dx, startRight - minWidth))
    right = startRight
  } else if (handle.includes('e')) {
    right = Math.min(boundsRight, Math.max(startRight + dx, start.x + minWidth))
    left = start.x
  }
  if (handle.includes('n')) {
    top = Math.max(bounds.y, Math.min(start.y + dy, startBottom - minHeight))
    bottom = startBottom
  } else if (handle.includes('s')) {
    bottom = Math.min(boundsBottom, Math.max(startBottom + dy, start.y + minHeight))
    top = start.y
  }

  return clampWindowSelection(
    {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    },
    bounds,
    minSize
  )
}
