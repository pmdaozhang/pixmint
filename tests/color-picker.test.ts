import { describe, expect, it } from 'vitest'
import { clampSourceRect, pixelAt, toHex, toRgbText } from '../src/renderer/src/overlay/color-picker'

function rgbaPixels(colors: Array<[number, number, number]>): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * 4)
  colors.forEach(([r, g, b], index) => {
    data[index * 4] = r
    data[index * 4 + 1] = g
    data[index * 4 + 2] = b
    data[index * 4 + 3] = 255
  })
  return data
}

describe('color picker helpers', () => {
  it('formats colors as uppercase hex and rgb labels', () => {
    expect(toHex({ r: 0, g: 0, b: 0 })).toBe('#000000')
    expect(toHex({ r: 255, g: 255, b: 255 })).toBe('#FFFFFF')
    expect(toHex({ r: 1, g: 2, b: 15 })).toBe('#01020F')
    expect(toHex({ r: 300, g: -4, b: 12.6 })).toBe('#FF000D')
    expect(toRgbText({ r: 1, g: 2, b: 15 })).toBe('1, 2, 15')
  })

  it('samples a pixel using row-major RGBA order', () => {
    const data = rgbaPixels([
      [10, 20, 30],
      [40, 50, 60],
      [70, 80, 90],
      [100, 110, 120]
    ])
    expect(pixelAt(data, 2, 2, 0, 0)).toEqual({ r: 10, g: 20, b: 30 })
    expect(pixelAt(data, 2, 2, 1, 0)).toEqual({ r: 40, g: 50, b: 60 })
    expect(pixelAt(data, 2, 2, 0, 1)).toEqual({ r: 70, g: 80, b: 90 })
    expect(pixelAt(data, 2, 2, 1, 1)).toEqual({ r: 100, g: 110, b: 120 })
  })

  it('clamps samples at the image edge', () => {
    const data = rgbaPixels([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]])
    expect(pixelAt(data, 2, 2, -10, -10)).toEqual({ r: 1, g: 2, b: 3 })
    expect(pixelAt(data, 2, 2, 99, 99)).toEqual({ r: 10, g: 11, b: 12 })
    expect(pixelAt(data, 0, 0, 0, 0)).toBeNull()
  })

  it('keeps the magnifier source rect inside the image', () => {
    expect(clampSourceRect(100, 100, 16, 12, 1920, 1080)).toEqual({
      x: 92,
      y: 94,
      width: 16,
      height: 12
    })
    expect(clampSourceRect(0, 0, 16, 12, 1920, 1080)).toEqual({
      x: 0,
      y: 0,
      width: 16,
      height: 12
    })
    expect(clampSourceRect(1919, 1079, 16, 12, 1920, 1080)).toEqual({
      x: 1904,
      y: 1068,
      width: 16,
      height: 12
    })
    expect(clampSourceRect(5, 5, 16, 12, 8, 6)).toEqual({
      x: 0,
      y: 0,
      width: 8,
      height: 6
    })
  })
})
