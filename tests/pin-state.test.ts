import { describe, expect, it } from 'vitest'
import { clampOpacity, nextPinSize } from '../src/main/pin-state'

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
})
