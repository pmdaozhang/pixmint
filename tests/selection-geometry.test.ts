import { describe, expect, it } from 'vitest'
import {
  MIN_SELECTION,
  RESIZE_DIRS,
  annotationShiftForSelection,
  clampWindowRect,
  moveSelectionRect,
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

  it('compensates selection origin movement so annotations stay on screen', () => {
    const current = { x: 100, y: 100, width: 200, height: 100 }
    const next = { x: 130, y: 90, width: 170, height: 110 }
    const shift = annotationShiftForSelection(current, next)
    expect(shift).toEqual({ dx: -30, dy: 10 })
    // 屏幕坐标 = 新画布原点 + 补偿后的本地坐标，必须等于原屏幕位置。
    expect(next.x + shift.dx).toBe(current.x)
    expect(next.y + shift.dy).toBe(current.y)
  })

  it('does not shift annotations when only the size changes', () => {
    const current = { x: 100, y: 100, width: 200, height: 100 }
    const next = { x: 100, y: 100, width: 260, height: 140 }
    expect(annotationShiftForSelection(current, next)).toEqual({ dx: 0, dy: 0 })
  })

  it('moves a selection without changing its size', () => {
    expect(moveSelectionRect(start, 30, -20, 1920, 1080)).toEqual({
      x: 130,
      y: 80,
      width: 200,
      height: 100
    })
  })

  it('clamps a moved selection inside the viewport', () => {
    expect(moveSelectionRect(start, -500, -500, 1920, 1080)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100
    })
    expect(moveSelectionRect(start, 5000, 5000, 1920, 1080)).toEqual({
      x: 1720,
      y: 980,
      width: 200,
      height: 100
    })
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
