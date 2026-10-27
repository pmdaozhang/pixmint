import type { Rect } from './types'

export interface ScrollTarget {
  hwnd: number
  className: string
  title: string
  foreground: boolean
  rect: Rect
}

export interface ScrollResult {
  ok: boolean
  error?: string
}

/**
 * 解析滚动 helper 返回的目标窗口 JSON。
 * helper 返回 null 或坏 JSON 时一律按“没有目标”处理，不能把坏矩形传给截图层。
 */
export function parseScrollTarget(payload: string | null): ScrollTarget | null {
  if (!payload || payload === 'null') return null
  try {
    const start = payload.indexOf('{')
    const end = payload.lastIndexOf('}')
    if (start < 0 || end < start) return null
    const value = JSON.parse(payload.slice(start, end + 1)) as Partial<ScrollTarget>
    if (
      !Number.isInteger(value.hwnd) ||
      (value.hwnd ?? 0) <= 0 ||
      typeof value.className !== 'string' ||
      typeof value.foreground !== 'boolean' ||
      !value.rect ||
      !Number.isFinite(value.rect.x) ||
      !Number.isFinite(value.rect.y) ||
      !Number.isFinite(value.rect.width) ||
      !Number.isFinite(value.rect.height) ||
      value.rect.width <= 0 ||
      value.rect.height <= 0
    ) {
      return null
    }
    return {
      hwnd: value.hwnd as number,
      className: value.className,
      title: typeof value.title === 'string' ? value.title : '',
      foreground: value.foreground,
      rect: {
        x: value.rect.x,
        y: value.rect.y,
        width: value.rect.width,
        height: value.rect.height
      }
    }
  } catch {
    return null
  }
}

export function parseScrollResult(payload: string | null): ScrollResult {
  if (payload === 'ok') return { ok: true }
  if (!payload) return { ok: false, error: '滚动命令没有响应' }
  return { ok: false, error: payload }
}
