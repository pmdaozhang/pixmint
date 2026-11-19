/**
 * 聚光灯绘制路径的性能基准（作为单测跑，进 CI）。
 *
 * 背景：聚光灯让每次 pointermove 都要走一次完整重绘，分组和挖空区计算如果写得太重，
 * 拖拽会掉帧。这里只量纯函数部分，预算取 16ms 帧预算的 25%（4ms）；
 * 按经验纯函数一旦超过这个量级，叠加 canvas 合成就会明显卡顿。
 */
import { describe, expect, it } from 'vitest'
import { planSpotlightDraw, spotlightHoles } from '../src/renderer/src/overlay/annotation/spotlight'
import type { Annotation, AnnoStyle } from '../src/shared/types'

const style: AnnoStyle = {
  color: '#0d0d0d',
  lineW: 2.5,
  lineStyle: 'solid',
  arrowMode: 'single'
}

function makeAnnotations(count: number): Annotation[] {
  const out: Annotation[] = []
  for (let i = 0; i < count; i += 1) {
    const x = (i * 37) % 1200
    const y = (i * 53) % 800
    out.push({
      id: `r${i}`,
      type: i % 3 === 0 ? 'ellipse' : 'rect',
      x1: x,
      y1: y,
      x2: x + 40 + (i % 80),
      y2: y + 30 + (i % 60),
      fill: false,
      spotlight: i % 2 === 0,
      style
    })
  }
  return out
}

function bench(annotations: Annotation[], runs: number): number {
  // 预热，避免第一次 JIT 干扰
  for (let i = 0; i < 30; i += 1) {
    planSpotlightDraw(annotations, null)
    spotlightHoles(annotations, null)
  }
  const start = performance.now()
  for (let i = 0; i < runs; i += 1) {
    planSpotlightDraw(annotations, null)
    spotlightHoles(annotations, null)
  }
  return (performance.now() - start) / runs
}

describe('聚光灯绘制路径性能', () => {
  const BUDGET = 4

  it(`200 个形状的单帧纯函数开销 < ${BUDGET}ms`, () => {
    const perFrame = bench(makeAnnotations(200), 200)
    expect(perFrame).toBeLessThan(BUDGET)
  })

  it(`500 个形状的单帧纯函数开销 < ${BUDGET}ms`, () => {
    const perFrame = bench(makeAnnotations(500), 200)
    expect(perFrame).toBeLessThan(BUDGET)
  })
})
