import { describe, expect, it } from 'vitest'
import {
  LongCaptureStitcher,
  detectStableHeader,
  matchVerticalOverlap,
  type FrameImage
} from '../src/shared/long-capture'

const WIDTH = 48
const FRAME_HEIGHT = 96
const HEADER_HEIGHT = 16

function pagePixel(row: number, x: number): [number, number, number, number] {
  const hash = (salt: number): number => {
    let value = Math.imul(row, 374761393) + Math.imul(x, 668265263) + Math.imul(salt, 2246822519)
    value = Math.imul(value ^ (value >>> 13), 1274126177)
    return (value ^ (value >>> 16)) & 255
  }
  return [
    hash(1),
    hash(2),
    hash(3),
    255
  ]
}

function headerPixel(x: number): [number, number, number, number] {
  return [24, 48 + (x % 32), 196, 255]
}

function createPage(height: number): Uint8Array {
  const data = new Uint8Array(WIDTH * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const [b, g, r, a] = pagePixel(y, x)
      const index = (y * WIDTH + x) * 4
      data[index] = b
      data[index + 1] = g
      data[index + 2] = r
      data[index + 3] = a
    }
  }
  return data
}

function frameAt(
  page: Uint8Array,
  scrollY: number,
  frameHeight = FRAME_HEIGHT,
  headerHeight = HEADER_HEIGHT
): FrameImage {
  const data = new Uint8Array(WIDTH * frameHeight * 4)
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = (y * WIDTH + x) * 4
      if (y < headerHeight) {
        const [b, g, r, a] = headerPixel(x)
        data[index] = b
        data[index + 1] = g
        data[index + 2] = r
        data[index + 3] = a
      } else {
        const pageRow = scrollY + (y - headerHeight)
        const pageIndex = (pageRow * WIDTH + x) * 4
        data[index] = page[pageIndex]
        data[index + 1] = page[pageIndex + 1]
        data[index + 2] = page[pageIndex + 2]
        data[index + 3] = page[pageIndex + 3]
      }
    }
  }
  return { width: WIDTH, height: frameHeight, data }
}

function rowBytes(frame: FrameImage, row: number): Uint8Array {
  const start = row * frame.width * 4
  return frame.data.subarray(start, start + frame.width * 4)
}

describe('detectStableHeader', () => {
  it('finds the fixed header height', () => {
    const page = createPage(400)
    const previous = frameAt(page, 0)
    const next = frameAt(page, 20)
    expect(detectStableHeader(previous, next)).toBe(HEADER_HEIGHT)
  })

  it('returns zero when the first row changes', () => {
    const page = createPage(400)
    const previous = frameAt(page, 0, FRAME_HEIGHT, 0)
    const next = frameAt(page, 20, FRAME_HEIGHT, 0)
    expect(detectStableHeader(previous, next)).toBe(0)
  })

  it('returns zero when frames are identical', () => {
    const page = createPage(400)
    const frame = frameAt(page, 0)
    expect(detectStableHeader(frame, frame)).toBe(0)
  })
})

describe('matchVerticalOverlap', () => {
  it('matches a known scroll offset with a fixed header', () => {
    const page = createPage(400)
    const previous = frameAt(page, 0)
    const next = frameAt(page, 20)
    const match = matchVerticalOverlap(previous, next, { headerHeight: HEADER_HEIGHT })

    expect(match).not.toBeNull()
    expect(match?.offset).toBe(20)
    expect(match?.newRows).toBe(20)
    expect(match?.overlap).toBe(FRAME_HEIGHT - HEADER_HEIGHT - 20)
    expect(match?.headerHeight).toBe(HEADER_HEIGHT)
    expect(match?.confidence).toBeGreaterThan(0.99)
  })

  it('auto-detects the fixed header', () => {
    const page = createPage(400)
    const previous = frameAt(page, 0)
    const next = frameAt(page, 24)
    const match = matchVerticalOverlap(previous, next)

    expect(match?.headerHeight).toBe(HEADER_HEIGHT)
    expect(match?.offset).toBe(24)
  })

  it('tolerates small pixel noise', () => {
    const page = createPage(400)
    const previous = frameAt(page, 0)
    const next = frameAt(page, 20)
    const noisy = { ...next, data: next.data.slice() }
    for (let index = 0; index < noisy.data.length; index += 97) {
      noisy.data[index] = (noisy.data[index] + 2) & 255
    }
    const match = matchVerticalOverlap(previous, noisy, { headerHeight: HEADER_HEIGHT })
    expect(match?.offset).toBe(20)
    expect(match?.confidence).toBeGreaterThan(0.99)
  })

  it('returns null when the scroll offset leaves too little overlap', () => {
    const page = createPage(500)
    const previous = frameAt(page, 0)
    const next = frameAt(page, 75)
    const match = matchVerticalOverlap(previous, next, { headerHeight: HEADER_HEIGHT })
    expect(match).toBeNull()
  })

  it('returns null for identical frames with no new content', () => {
    const page = createPage(400)
    const previous = frameAt(page, 0)
    const next = frameAt(page, 0)
    const match = matchVerticalOverlap(previous, next, { headerHeight: HEADER_HEIGHT })
    expect(match).toBeNull()
  })

  it('rejects frames with different sizes', () => {
    const page = createPage(400)
    const previous = frameAt(page, 0)
    const next = { ...frameAt(page, 20), width: WIDTH + 4, data: new Uint8Array(0) }
    expect(matchVerticalOverlap(previous, next, { headerHeight: 0 })).toBeNull()
  })
})

describe('LongCaptureStitcher', () => {
  it('appends only new bottom rows and keeps the header once', () => {
    const page = createPage(400)
    const first = frameAt(page, 0)
    const second = frameAt(page, 20)
    const match = matchVerticalOverlap(first, second, { headerHeight: HEADER_HEIGHT })
    expect(match).not.toBeNull()

    const stitcher = new LongCaptureStitcher()
    stitcher.initialize(first, HEADER_HEIGHT)
    const result = stitcher.append(second, match!)
    expect(result).toEqual({ appended: 20, truncated: false })

    const output = stitcher.getFrame()
    expect(output.height).toBe(FRAME_HEIGHT + 20)
    expect(output.height - HEADER_HEIGHT).toBe(100)

    // 表头只出现一次。
    expect(Buffer.from(rowBytes(output, 0)).equals(Buffer.from(rowBytes(first, 0)))).toBe(true)
    expect(Buffer.from(rowBytes(output, HEADER_HEIGHT - 1)).equals(
      Buffer.from(rowBytes(first, HEADER_HEIGHT - 1))
    )).toBe(true)

    // 表头之后应是页面第 0..99 行。
    for (let y = 0; y < 100; y += 1) {
      const outputRow = HEADER_HEIGHT + y
      const expected = new Uint8Array(WIDTH * 4)
      for (let x = 0; x < WIDTH; x += 1) {
        const [b, g, r, a] = pagePixel(y, x)
        const index = x * 4
        expected[index] = b
        expected[index + 1] = g
        expected[index + 2] = r
        expected[index + 3] = a
      }
      expect(Buffer.from(rowBytes(output, outputRow)).equals(Buffer.from(expected))).toBe(true)
    }
  })

  it('truncates at the max height', () => {
    const page = createPage(400)
    const first = frameAt(page, 0)
    const second = frameAt(page, 20)
    const match = matchVerticalOverlap(first, second, { headerHeight: HEADER_HEIGHT })
    const stitcher = new LongCaptureStitcher({
      maxHeight: FRAME_HEIGHT + 10
    })
    stitcher.initialize(first, HEADER_HEIGHT)
    const result = stitcher.append(second, match!)

    expect(result).toEqual({ appended: 10, truncated: true })
    expect(stitcher.currentHeight).toBe(FRAME_HEIGHT + 10)
  })

  it('rejects an invalid header height', () => {
    const page = createPage(400)
    const frame = frameAt(page, 0)
    const stitcher = new LongCaptureStitcher()
    expect(() => stitcher.initialize(frame, FRAME_HEIGHT + 1)).toThrow()
  })
})
