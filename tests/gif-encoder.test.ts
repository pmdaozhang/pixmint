import { describe, expect, it } from 'vitest'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'

function frame(width: number, height: number, color: [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = color[0]
    data[index * 4 + 1] = color[1]
    data[index * 4 + 2] = color[2]
    data[index * 4 + 3] = color[3]
  }
  return data
}

describe('gifenc pipeline', () => {
  it('encodes a two-frame looping GIF', () => {
    const width = 8
    const height = 6
    const encoder = GIFEncoder({ auto: true })
    const colors: Array<[number, number, number, number]> = [
      [10, 132, 255, 255],
      [255, 69, 58, 255]
    ]
    for (const color of colors) {
      const rgba = frame(width, height, color)
      const palette = quantize(rgba, 256, { format: 'rgb565' })
      const index = applyPalette(rgba, palette, 'rgb565')
      encoder.writeFrame(index, width, height, {
        palette,
        delay: 66,
        repeat: 0
      })
    }
    encoder.finish()
    const bytes = encoder.bytes()
    expect(bytes.length).toBeGreaterThan(16)
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a')
    expect(bytes[bytes.length - 1]).toBe(0x3b)
    expect(String.fromCharCode(...bytes).includes('NETSCAPE2.0')).toBe(true)
  })

  it('preserves colors better with rgb565 than rgb444', () => {
    const width = 8
    const height = 6
    const target: [number, number, number] = [18, 187, 233]
    const rgba = frame(width, height, [target[0], target[1], target[2], 255])
    const sample = (format: 'rgb444' | 'rgb565'): [number, number, number] => {
      const palette = quantize(rgba, 256, { format })
      const index = applyPalette(rgba, palette, format)
      const color = palette[index[0]]
      return [color[0], color[1], color[2]]
    }
    const distance = (color: [number, number, number]): number =>
      Math.hypot(color[0] - target[0], color[1] - target[1], color[2] - target[2])
    expect(distance(sample('rgb565'))).toBeLessThanOrEqual(distance(sample('rgb444')))
  })
})
