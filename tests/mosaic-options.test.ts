import { describe, expect, it } from 'vitest'
import {
  mosaicDensityToSize,
} from '../src/renderer/src/overlay/options'

describe('mosaic slider semantics', () => {
  it('makes larger density values produce smaller mosaic blocks', () => {
    expect(mosaicDensityToSize(1)).toBe(20)
    expect(mosaicDensityToSize(100)).toBe(3)
    expect(mosaicDensityToSize(50)).toBe(12)
  })

  it('keeps the two extremes inside a normal mosaic range', () => {
    expect(mosaicDensityToSize(1)).toBeGreaterThanOrEqual(18)
    expect(mosaicDensityToSize(100)).toBeLessThanOrEqual(5)
    expect(mosaicDensityToSize(25)).toBeGreaterThan(mosaicDensityToSize(75))
  })
})
