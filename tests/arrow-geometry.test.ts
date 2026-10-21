import { describe, expect, it } from 'vitest'
import {
  arrowHeadMetrics,
  endTangent,
  fitArrowHeadMetrics,
  pathLength,
  penLookback,
  startTangent,
  straightenTail,
  trimPathEnd,
  trimPathStart
} from '../src/shared/arrow-geometry'
import type { Point } from '../src/shared/types'

describe('hand-drawn arrow geometry', () => {
  it('trims an exact distance across multiple short segments', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 }
    ]
    const trimmed = trimPathEnd(points, 15)
    expect(trimmed).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 }
    ])
  })

  it('trims the start of a path for a double arrow', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 }
    ]
    expect(trimPathStart(points, 15)).toEqual([
      { x: 15, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 }
    ])
  })

  it('computes a stable tangent despite a short end hook', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 120, y: 0 },
      { x: 150, y: 10 },
      { x: 152, y: 40 }
    ]
    const tangent = endTangent(points, 40)
    expect(tangent).not.toBeNull()
    expect(tangent!.x).toBeGreaterThan(0.9)
  })

  it('computes a stable outward tangent at the start', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 }
    ]
    const tangent = startTangent(points, 40)
    expect(tangent).not.toBeNull()
    expect(tangent!.x).toBeLessThan(-0.9)
  })

  it('keeps the arrow tangent aligned with a short upward hook', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 10 },
      { x: 92, y: -18 }
    ]
    const tangent = endTangent(points, 12)
    expect(tangent).not.toBeNull()
    expect(tangent!.y).toBeLessThan(-0.8)
  })

  it('scales the hand-drawn arrow head with line width', () => {
    const thin = arrowHeadMetrics('sketch', 2)
    const thick = arrowHeadMetrics('sketch', 8)
    expect(thin.open).toBe(false)
    expect(thick.length).toBeGreaterThan(thin.length)
    expect(thick.halfWidth).toBeGreaterThan(thin.halfWidth)
  })

  it('fits the arrow head inside a very short path', () => {
    const metrics = arrowHeadMetrics('sketch', 2.5)
    const fitted = fitArrowHeadMetrics(metrics, 10, 0.42)
    expect(fitted.length).toBeLessThanOrEqual(4.2001)
    expect(fitted.halfWidth).toBeLessThan(metrics.halfWidth)
  })

  it('straightens the tail onto the arrow axis without moving the tip', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 120, y: 0 },
      { x: 150, y: 10 },
      { x: 152, y: 40 }
    ]
    const dir = endTangent(points, 50)!
    const originalTip = points[points.length - 1]
    const core = straightenTail(points, dir, 50, 12)
    const lineEnd = core[core.length - 1]
    const beforeTip = core[core.length - 2]
    const dx = lineEnd.x - beforeTip.x
    const dy = lineEnd.y - beforeTip.y
    const length = Math.hypot(dx, dy)
    expect(lineEnd.x).toBeCloseTo(originalTip.x - dir.x * 12, 5)
    expect(lineEnd.y).toBeCloseTo(originalTip.y - dir.y * 12, 5)
    expect((dx / length) * dir.x + (dy / length) * dir.y).toBeGreaterThan(0.98)
  })

  it('keeps the path length calculation stable', () => {
    expect(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBe(5)
  })

  it('derives a usable lookback from line width', () => {
    expect(penLookback(2.5)).toBeGreaterThanOrEqual(15)
    expect(penLookback(10)).toBeLessThanOrEqual(28)
  })
})
