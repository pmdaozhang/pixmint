import { describe, expect, it } from 'vitest'
import { clampOpacity, fitPinWindowSize, nextPinSize } from '../src/main/pin-state'

describe('pin window state', () => {
  it('keeps opacity in a safe range', () => {
    expect(clampOpacity(0.1)).toBe(0.2)
    expect(clampOpacity(1.4)).toBe(1)
    expect(clampOpacity(0.7)).toBe(0.7)
  })

  it('zooms in while preserving aspect ratio', () => {
    const next = nextPinSize(400, 200, 1)
    expect(next.width).toBe(440)
    expect(next.height).toBe(220)
  })

  it('zooms out and respects the minimum width', () => {
    const next = nextPinSize(100, 50, -1)
    expect(next.width).toBeGreaterThanOrEqual(80)
    expect(next.width / next.height).toBeCloseTo(2, 5)
  })

  it('keeps a short text selection from being stretched to the old minimum height', () => {
    const size = fitPinWindowSize(300, 14, 1920, 1080, 20)
    expect(size.width).toBe(300)
    expect(size.height).toBe(14)
    expect(size.totalWidth).toBe(340)
    expect(size.totalHeight).toBe(54)
    expect(size.width / size.height).toBeCloseTo(300 / 14, 5)
  })

  it('scales a large pin down without changing its aspect ratio', () => {
    const size = fitPinWindowSize(4000, 2000, 1920, 1080, 20)
    expect(size.totalWidth).toBeLessThanOrEqual(1920)
    expect(size.totalHeight).toBeLessThanOrEqual(1080)
    expect(size.width / size.height).toBeCloseTo(2, 5)
  })

  it('handles extreme aspect ratios without collapsing a dimension to zero', () => {
    const narrow = fitPinWindowSize(1, 100, 1920, 1080, 20)
    const wide = fitPinWindowSize(1000, 1, 1920, 1080, 20)
    expect(narrow.width).toBeGreaterThanOrEqual(1)
    expect(narrow.height).toBe(100)
    expect(wide.width).toBe(1000)
    expect(wide.height).toBeGreaterThanOrEqual(1)
  })
})
