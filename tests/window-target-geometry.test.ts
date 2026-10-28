import { describe, expect, it } from 'vitest'
import { chooseWindowTargetContentRect } from '../src/shared/window-target-geometry'

const displayRect = { x: 0, y: 0, width: 1920, height: 1080 }

describe('window target content geometry', () => {
  it('uses the scrollable content when it is visible', () => {
    expect(
      chooseWindowTargetContentRect({
        windowRect: { x: 100, y: 100, width: 900, height: 700 },
        clientRect: { x: 108, y: 132, width: 884, height: 668 },
        contentRect: { x: 120, y: 150, width: 700, height: 500 },
        displayRect
      })
    ).toEqual({ x: 120, y: 150, width: 700, height: 500 })
  })

  it('falls back to the client rect when UIA returns an offscreen element', () => {
    expect(
      chooseWindowTargetContentRect({
        windowRect: { x: 100, y: 100, width: 900, height: 700 },
        clientRect: { x: 108, y: 132, width: 884, height: 668 },
        contentRect: { x: 2200, y: 150, width: 700, height: 500 },
        displayRect
      })
    ).toEqual({ x: 108, y: 132, width: 884, height: 668 })
  })

  it('rejects a narrow scrollbar-like element', () => {
    expect(
      chooseWindowTargetContentRect({
        windowRect: { x: 100, y: 100, width: 900, height: 700 },
        clientRect: { x: 108, y: 132, width: 884, height: 668 },
        contentRect: { x: 936, y: 160, width: 56, height: 652 },
        displayRect
      })
    ).toEqual({ x: 108, y: 132, width: 884, height: 668 })
  })

  it('clips a partially visible content rect to the display', () => {
    expect(
      chooseWindowTargetContentRect({
        windowRect: { x: 100, y: 100, width: 1900, height: 700 },
        clientRect: { x: 108, y: 132, width: 1884, height: 668 },
        contentRect: { x: 100, y: 100, width: 1900, height: 1000 },
        displayRect
      })
    ).toEqual({ x: 100, y: 100, width: 1820, height: 980 })
  })

  it('rejects a target completely outside the display', () => {
    expect(
      chooseWindowTargetContentRect({
        windowRect: { x: 2500, y: 100, width: 900, height: 700 },
        clientRect: { x: 2508, y: 132, width: 884, height: 668 },
        contentRect: { x: 2520, y: 150, width: 700, height: 500 },
        displayRect
      })
    ).toBeNull()
  })
})
