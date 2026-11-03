import { describe, expect, it } from 'vitest'
import { layoutPinTextLines } from '../src/renderer/src/pin/pin-text'

describe('pin text layer layout', () => {
  it('maps OCR pixels into the current pin display size', () => {
    const [line] = layoutPinTextLines(
      [{ text: '你好世界', x: 960, y: 540, width: 200, height: 100 }],
      { width: 1920, height: 1080 },
      { width: 960, height: 540 }
    )
    expect(line.text).toBe('你好世界')
    expect(line.left).toBe(480)
    expect(line.top).toBe(270)
    expect(line.width).toBe(100)
    expect(line.height).toBe(50)
    expect(line.fontSize).toBe(45)
  })

  it('sorts lines in reading order and drops empty text', () => {
    const lines = layoutPinTextLines(
      [
        { text: 'second', x: 20, y: 50, width: 100, height: 20 },
        { text: '', x: 0, y: 0, width: 50, height: 20 },
        { text: 'first', x: 20, y: 10, width: 100, height: 20 }
      ],
      { width: 200, height: 100 },
      { width: 200, height: 100 }
    )
    expect(lines.map((line) => line.text)).toEqual(['first', 'second'])
  })

  it('clamps a box to the visible image area', () => {
    const [line] = layoutPinTextLines(
      [{ text: 'edge', x: 1900, y: 100, width: 100, height: 20 }],
      { width: 1920, height: 1080 },
      { width: 960, height: 540 }
    )
    expect(line.left).toBe(950)
    expect(line.width).toBe(10)
  })

  it('returns no lines for empty images or invalid viewports', () => {
    const blocks = [{ text: 'A', x: 0, y: 0, width: 10, height: 10 }]
    expect(
      layoutPinTextLines(blocks, { width: 0, height: 0 }, { width: 100, height: 100 })
    ).toEqual([])
    expect(
      layoutPinTextLines(blocks, { width: 100, height: 100 }, { width: 0, height: 100 })
    ).toEqual([])
  })
})
