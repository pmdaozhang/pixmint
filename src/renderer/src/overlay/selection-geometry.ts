import type { Rect } from '../../../shared/types'

export const MIN_SELECTION = 8

export type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const RESIZE_DIRS: ResizeDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function resizeSelectionRect(
  start: Rect,
  dir: ResizeDir,
  dx: number,
  dy: number,
  maxWidth: number,
  maxHeight: number
): Rect {
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height

  if (dir.includes('w')) {
    left = Math.min(Math.max(0, start.x + dx), right - MIN_SELECTION)
  }
  if (dir.includes('e')) {
    right = Math.max(Math.min(maxWidth, start.x + start.width + dx), left + MIN_SELECTION)
  }
  if (dir.includes('n')) {
    top = Math.min(Math.max(0, start.y + dy), bottom - MIN_SELECTION)
  }
  if (dir.includes('s')) {
    bottom = Math.max(Math.min(maxHeight, start.y + start.height + dy), top + MIN_SELECTION)
  }

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top)
  }
}

export function clampWindowRect(rect: Rect, bounds: Rect): Rect | null {
  const x = Math.max(0, rect.x - bounds.x)
  const y = Math.max(0, rect.y - bounds.y)
  const right = Math.min(bounds.width, rect.x + rect.width - bounds.x)
  const bottom = Math.min(bounds.height, rect.y + rect.height - bounds.y)
  if (right - x < MIN_SELECTION || bottom - y < MIN_SELECTION) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(right - x),
    height: Math.round(bottom - y)
  }
}
