import { describe, expect, it } from 'vitest'
import {
  clampRect,
  cropRectToImage,
  dimPanelsFor,
  normalizeRect,
  pointInRect
} from '../src/shared/geometry'

describe('selection geometry', () => {
  it('normalizes a reverse drag into a positive rect', () => {
    expect(normalizeRect(120, 90, 40, 30)).toEqual({ x: 40, y: 30, width: 80, height: 60 })
  })

  it('clamps a rect to display bounds', () => {
    expect(
      clampRect({ x: -10, y: -20, width: 120, height: 200 }, { x: 0, y: 0, width: 100, height: 100 })
    ).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  it('converts DIP selection to physical image pixels', () => {
    expect(
      cropRectToImage(
        { x: 100, y: 50, width: 200, height: 100 },
        { x: 0, y: 0, width: 1000, height: 500 },
        2000,
        1000
      )
    ).toEqual({ sx: 200, sy: 100, sw: 400, sh: 200 })
  })

  it('keeps crop inside the image for an oversized selection', () => {
    expect(
      cropRectToImage(
        { x: 900, y: 450, width: 200, height: 100 },
        { x: 0, y: 0, width: 1000, height: 500 },
        1000,
        500
      )
    ).toEqual({ sx: 900, sy: 450, sw: 100, sh: 50 })
  })

  it('detects points inside a rect', () => {
    expect(pointInRect({ x: 10, y: 10 }, { x: 0, y: 0, width: 20, height: 20 })).toBe(true)
    expect(pointInRect({ x: 21, y: 10 }, { x: 0, y: 0, width: 20, height: 20 })).toBe(false)
  })

  it('builds four dim panels around a selection without a giant shadow', () => {
    expect(
      dimPanelsFor(
        { x: 100, y: 50, width: 200, height: 100 },
        { x: 0, y: 0, width: 500, height: 300 }
      )
    ).toEqual({
      top: { x: 0, y: 0, width: 500, height: 50 },
      left: { x: 0, y: 50, width: 100, height: 100 },
      right: { x: 300, y: 50, width: 200, height: 100 },
      bottom: { x: 0, y: 150, width: 500, height: 150 }
    })
  })

  it('clamps the dim hole to the display bounds', () => {
    expect(
      dimPanelsFor(
        { x: -20, y: -10, width: 700, height: 500 },
        { x: 0, y: 0, width: 500, height: 300 }
      )
    ).toEqual({
      top: { x: 0, y: 0, width: 500, height: 0 },
      left: { x: 0, y: 0, width: 0, height: 300 },
      right: { x: 500, y: 0, width: 0, height: 300 },
      bottom: { x: 0, y: 300, width: 500, height: 0 }
    })
  })
})
