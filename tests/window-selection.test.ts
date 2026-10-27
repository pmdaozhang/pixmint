import { describe, expect, it } from 'vitest'
import {
  MIN_WINDOW_SELECTION,
  clampWindowSelection,
  resizeWindowSelection
} from '../src/shared/window-selection'

const bounds = { x: 100, y: 80, width: 800, height: 600 }
const start = { x: 200, y: 180, width: 500, height: 360 }

describe('window selection geometry', () => {
  it('keeps a selection inside the window content rect', () => {
    expect(clampWindowSelection({ x: -50, y: 20, width: 1200, height: 900 }, bounds)).toEqual({
      x: 100,
      y: 80,
      width: 800,
      height: 600
    })
  })

  it('keeps the opposite edge fixed when dragging west', () => {
    expect(resizeWindowSelection(start, 'w', -120, 0, bounds)).toEqual({
      x: 100,
      y: 180,
      width: 600,
      height: 360
    })
  })

  it('keeps the opposite edge fixed when dragging north', () => {
    expect(resizeWindowSelection(start, 'n', 0, -90, bounds)).toEqual({
      x: 200,
      y: 90,
      width: 500,
      height: 450
    })
  })

  it('stops at the content bounds when dragging east or south', () => {
    expect(resizeWindowSelection(start, 'se', 1200, 900, bounds)).toEqual({
      x: 200,
      y: 180,
      width: 700,
      height: 500
    })
  })

  it('does not collapse below the minimum size', () => {
    expect(resizeWindowSelection(start, 'nw', 1000, 1000, bounds)).toEqual({
      x: 580,
      y: 420,
      width: MIN_WINDOW_SELECTION,
      height: MIN_WINDOW_SELECTION
    })
  })

  it('uses the content size when the target is smaller than the minimum', () => {
    const small = { x: 10, y: 20, width: 90, height: 70 }
    expect(clampWindowSelection({ x: 0, y: 0, width: 200, height: 200 }, small)).toEqual({
      x: 10,
      y: 20,
      width: 90,
      height: 70
    })
  })
})
