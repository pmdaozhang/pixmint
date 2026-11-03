import { describe, expect, it } from 'vitest'
import { bgraToRgbaInPlace } from '../src/shared/pixel-format'

describe('pixel format conversion', () => {
  it('converts BGRA to RGBA in place and forces alpha to opaque', () => {
    const pixels = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    expect(bgraToRgbaInPlace(pixels)).toBe(pixels)
    expect(Array.from(pixels)).toEqual([3, 2, 1, 255, 7, 6, 5, 255])
  })

  it('leaves incomplete trailing bytes untouched', () => {
    const pixels = new Uint8Array([1, 2, 3, 4, 9, 8])
    expect(Array.from(bgraToRgbaInPlace(pixels))).toEqual([3, 2, 1, 255, 9, 8])
  })
})
