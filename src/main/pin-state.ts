export function clampOpacity(value: number): number {
  return Math.max(0.2, Math.min(1, value))
}

export interface PinWindowSize {
  width: number
  height: number
  totalWidth: number
  totalHeight: number
}

/**
 * 背景：短文字选区只有十几像素高，旧实现分别套 80×60 最小值后把图片拉变形。
 * 设计意图：宽高共用同一缩放比例，并在舍入时由主边反算另一边，确保比例不漂移。
 * 关键约束：不放大原图；工作区极小时仍保证图片宽高至少 1px，并保留阴影边距。
 */
export function fitPinWindowSize(
  width: number,
  height: number,
  workAreaWidth: number,
  workAreaHeight: number,
  padding = 20
): PinWindowSize {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1)
  const safeHeight = Math.max(1, Number.isFinite(height) ? height : 1)
  const safePadding = Math.max(0, padding)
  const availableWidth = Math.max(1, workAreaWidth - safePadding * 2)
  const availableHeight = Math.max(1, workAreaHeight - safePadding * 2)
  const scale = Math.min(
    1,
    availableWidth / safeWidth,
    availableHeight / safeHeight
  )
  let pinWidth: number
  let pinHeight: number
  if (safeWidth >= safeHeight) {
    pinWidth = Math.max(1, Math.round(safeWidth * scale))
    pinHeight = Math.max(1, Math.round((pinWidth * safeHeight) / safeWidth))
  } else {
    pinHeight = Math.max(1, Math.round(safeHeight * scale))
    pinWidth = Math.max(1, Math.round((pinHeight * safeWidth) / safeHeight))
  }
  return {
    width: pinWidth,
    height: pinHeight,
    totalWidth: pinWidth + safePadding * 2,
    totalHeight: pinHeight + safePadding * 2
  }
}

export function nextPinSize(
  width: number,
  height: number,
  direction: 1 | -1,
  minWidth = 80,
  maxWidth = 2400
): { width: number; height: number } {
  const factor = direction > 0 ? 1.1 : 0.9
  const nextWidth = Math.round(Math.max(minWidth, Math.min(maxWidth, width * factor)))
  const ratio = height / width
  return { width: nextWidth, height: Math.max(1, Math.round(nextWidth * ratio)) }
}
