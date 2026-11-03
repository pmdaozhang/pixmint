import { describe, expect, it } from 'vitest'
import {
  lineBlockFromParts,
  scaleOcrBlocks
} from '../src/shared/ocr-layout'

describe('OCR layout helpers', () => {
  it('maps OCR boxes from the upscaled image back to source pixels', () => {
    const blocks = scaleOcrBlocks(
      [
        { text: '  你好世界  ', x: 40, y: 20, width: 80, height: 40 },
        { text: '', x: 10, y: 10, width: 5, height: 5 }
      ],
      2
    )
    expect(blocks).toEqual([
      { text: '你好世界', x: 20, y: 10, width: 40, height: 20 }
    ])
  })

  it('treats invalid scale factors as one and drops invalid boxes', () => {
    const blocks = scaleOcrBlocks(
      [
        { text: 'A', x: 1, y: 2, width: 3, height: 4 },
        { text: 'B', x: 0, y: 0, width: 0, height: 4 }
      ],
      0
    )
    expect(blocks).toEqual([{ text: 'A', x: 1, y: 2, width: 3, height: 4 }])
  })

  it('merges recognition parts into one line box', () => {
    const line = lineBlockFromParts(
      [
        { text: 'Hello', x: 10, y: 20, width: 20, height: 10 },
        { text: 'world', x: 35, y: 19, width: 30, height: 12 }
      ],
      'Hello world'
    )
    expect(line).toEqual({
      text: 'Hello world',
      x: 10,
      y: 19,
      width: 55,
      height: 12
    })
  })

  it('returns null when a line has no usable parts or text', () => {
    expect(lineBlockFromParts([], 'text')).toBeNull()
    expect(
      lineBlockFromParts([{ text: 'A', x: 0, y: 0, width: 10, height: 10 }], '  ')
    ).toBeNull()
  })
})
