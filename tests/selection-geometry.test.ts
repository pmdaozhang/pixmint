import { describe, expect, it } from 'vitest'
import {
  MIN_SELECTION,
  RESIZE_DIRS,
  clampWindowRect,
  resizeSelectionRect
} from '../src/renderer/src/overlay/selection-geometry'

const start = { x: 100, y: 100, width: 200, height: 100 }

describe('overlay selection geometry', () => {
  it('resizes from the southeast corner', () => {
    expect(resizeSelectionRect(start, 'se', 40, 30, 1920, 1080)).toEqual({
      x: 100,
      y: 100,
      width: 240,
      height: 130
    })
  })

  it('resizes from the northwest corner', () => {
    expect(resizeSelectionRect(start, 'nw', -20, -10, 1920, 1080)).toEqual({
      x: 80,
      y: 90,
      width: 220,
      height: 110
    })
  })

  it('keeps the minimum size when dragging past the opposite edge', () => {
    const result = resizeSelectionRect(start, 'w', 1000, 0, 1920, 1080)
    expect(result.width).toBe(MIN_SELECTION)
  })

  it('exposes all eight resize directions', () => {
    expect(RESIZE_DIRS).toHaveLength(8)
    expect(new Set(RESIZE_DIRS).size).toBe(8)
  })

  it('clamps a window rect into the display and rejects tiny intersections', () => {
    expect(
      clampWindowRect(
        { x: 40, y: 50, width: 400, height: 300 },
        { x: 100, y: 100, width: 800, height: 600 }
      )
    ).toEqual({ x: 0, y: 0, width: 340, height: 250 })
    expect(
      clampWindowRect(
        { x: 95, y: 95, width: 4, height: 4 },
        { x: 100, y: 100, width: 800, height: 600 }
      )
    ).toBeNull()
  })
})
