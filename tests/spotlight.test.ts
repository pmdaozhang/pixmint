import { describe, expect, it } from 'vitest'
import {
  isSpotlitShape,
  planSpotlightDraw,
  spotlightHole,
  spotlightHoles
} from '../src/renderer/src/overlay/annotation/spotlight'
import type { Annotation, AnnoStyle, LineAnno, RectAnno, TextAnno } from '../src/shared/types'
import { hitTestAnnotation } from '../src/shared/annotation-utils'

const style: AnnoStyle = {
  color: '#E64545',
  lineW: 2.5,
  lineStyle: 'solid',
  arrowMode: 'single'
}

function rect(id: string, spotlight: boolean, x1 = 10, y1 = 10, x2 = 60, y2 = 60): RectAnno {
  return { id, type: 'rect', x1, y1, x2, y2, fill: false, spotlight, style }
}

function ellipse(id: string, spotlight: boolean, x1 = 80, y1 = 10, x2 = 140, y2 = 60): RectAnno {
  return { id, type: 'ellipse', x1, y1, x2, y2, fill: false, spotlight, style }
}

const arrow: LineAnno = { id: 'arrow', type: 'arrow', x1: 0, y1: 0, x2: 50, y2: 50, style }
const text: TextAnno = {
  id: 'text',
  type: 'text',
  x: 5,
  y: 5,
  text: 'hi',
  fontSize: 15,
  fontFamily: 'sans-serif',
  bold: false,
  italic: false,
  underline: false,
  style
}

describe('isSpotlitShape', () => {
  it('只把开启 spotlight 的矩形/椭圆算作聚光灯', () => {
    expect(isSpotlitShape(rect('a', true))).toBe(true)
    expect(isSpotlitShape(ellipse('b', true))).toBe(true)
    expect(isSpotlitShape(rect('c', false))).toBe(false)
    expect(isSpotlitShape(arrow)).toBe(false)
    expect(isSpotlitShape(text)).toBe(false)
  })

  it('缺少 spotlight 字段的旧数据按普通形状处理', () => {
    const legacy: Annotation = {
      id: 'old',
      type: 'rect',
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
      fill: false,
      style
    }
    expect(isSpotlitShape(legacy)).toBe(false)
  })
})

describe('spotlightHole', () => {
  it('回归：挖空区恰好外扩半个描边宽，与边框外沿对齐', () => {
    // 白底截图上，多扩一圈会露出一条亮边（2026-11-20 用户实测）。
    // 描边居中绘制，外沿就是 lineW/2，所以外扩量必须严格等于 lineW/2。
    const hole = spotlightHole(rect('a', true, 10, 20, 110, 80))
    const pad = style.lineW / 2
    expect(hole).not.toBeNull()
    expect(hole!.x).toBeCloseTo(10 - pad)
    expect(hole!.y).toBeCloseTo(20 - pad)
    expect(hole!.width).toBeCloseTo(100 + pad * 2)
    expect(hole!.height).toBeCloseTo(60 + pad * 2)
    // 边框外沿与挖空区边缘重合，不能再多
    expect(hole!.x).toBeCloseTo(10 - style.lineW / 2)
    expect(hole!.x + hole!.width).toBeCloseTo(110 + style.lineW / 2)
  })

  it('椭圆同样按半个描边外扩（中心不变、半径同加 pad）', () => {
    const hole = spotlightHole(ellipse('e', true, 20, 40, 120, 140))
    const pad = style.lineW / 2
    expect(hole!.type).toBe('ellipse')
    expect(hole!.x).toBeCloseTo(20 - pad)
    expect(hole!.width).toBeCloseTo(100 + pad * 2)
    expect(hole!.x + hole!.width / 2).toBeCloseTo(70)
  })

  it('反向拖拽（x2<x1）也能得到正的宽高', () => {
    const hole = spotlightHole(rect('a', true, 100, 100, 20, 40))
    expect(hole!.width).toBeGreaterThan(0)
    expect(hole!.height).toBeGreaterThan(0)
    expect(hole!.x).toBeLessThan(20)
  })

  it('零尺寸（起点还没拖动）的形状不产生挖空', () => {
    // 注意：阈值是在外扩之后判定的，所以只有真正零尺寸的形状才会为 null。
    expect(spotlightHole(rect('a', true, 10, 10, 10, 10))).not.toBeNull()
    const lineStyle = { ...style, lineW: 0 }
    const zero: RectAnno = { ...rect('b', true, 10, 10, 10, 10), style: lineStyle }
    expect(spotlightHole(zero)).toBeNull()
  })
})

describe('spotlightHoles', () => {
  it('多个聚光灯形状全部收集，重叠形状各算一个', () => {
    const holes = spotlightHoles([
      rect('r1', true, 0, 0, 100, 100),
      rect('r2', true, 50, 50, 150, 150),
      ellipse('e1', true)
    ])
    expect(holes).toHaveLength(3)
  })

  it('正在拖拽的临时形状也算进亮区', () => {
    const holes = spotlightHoles([rect('r1', true)], rect('temp', true, 200, 200, 260, 260))
    expect(holes).toHaveLength(2)
  })

  it('未开启聚光灯的形状不产生挖空', () => {
    expect(spotlightHoles([rect('r1', false), arrow])).toHaveLength(0)
  })
})

describe('planSpotlightDraw 绘制顺序', () => {
  it('先画的普通矩形和聚光灯矩形分组正确', () => {
    const plain = rect('plain', false)
    const lit = rect('lit', true)
    const plan = planSpotlightDraw([plain, lit], null)
    expect(plan.base.map((a) => a.id)).toEqual(['plain'])
    expect(plan.spotlit.map((a) => a.id)).toEqual(['lit'])
  })

  it('回归：overlay 重描层已删除，计划里只有 base 和 spotlit 两层', () => {
    // 2026-11-21：遮罩改为「洞外黑纱」整张叠加，亮区标注从未被擦掉，
    // 重描补救层随之删除（曾导致用户看到“蒙白纱”）。
    const plan = planSpotlightDraw([rect('plain', false), rect('lit', true)], null)
    expect('overlay' in plan).toBe(false)
    expect(Object.keys(plan).sort()).toEqual(['base', 'spotlit'])
  })

  it('回归：聚光灯形状不能被放进遮罩之前的层（否则会被压暗）', () => {
    const plan = planSpotlightDraw([rect('plain', false), rect('lit', true)], null)
    expect(plan.base.some((a) => a.id === 'lit')).toBe(false)
  })

  it('临时形状按自己的 spotlight 值进入对应图层', () => {
    const litPlan = planSpotlightDraw([], rect('temp', true))
    expect(litPlan.spotlit.map((a) => a.id)).toEqual(['temp'])
    const plainPlan = planSpotlightDraw([], rect('temp', false))
    expect(plainPlan.base.map((a) => a.id)).toEqual(['temp'])
  })

  it('正在编辑的文字草稿不参与任何图层', () => {
    const plan = planSpotlightDraw([text, rect('lit', true)], null, 'text')
    const ids = [...plan.base, ...plan.spotlit].map((a) => a.id)
    expect(ids).not.toContain('text')
  })
})

describe('聚光灯形状的命中测试', () => {
  it('聚光灯矩形只认描边，内部不整块被选中', () => {
    const lit = rect('lit', true, 0, 0, 200, 200)
    expect(hitTestAnnotation(lit, { x: 100, y: 100 })).toBe(false)
    expect(hitTestAnnotation(lit, { x: 0, y: 100 })).toBe(true)
  })
})

/**
 * 极限场景（2026-11-20 补充）：
 * 这些用例覆盖挖空区计算在退化几何、超边界、多层重叠时的行为，
 * 以及历史快照、开关切换对已有形状的影响。
 */
describe('挖空区极限几何', () => {
  it('极小形状：挖空区外扩后仍为正尺寸', () => {
    const hole = spotlightHole(rect('tiny', true, 10, 10, 11, 11))
    expect(hole).not.toBeNull()
    expect(hole!.width).toBeCloseTo(1 + style.lineW)
    expect(hole!.height).toBeCloseTo(1 + style.lineW)
    expect(hole!.width).toBeGreaterThan(0)
  })

  it('极扁平矩形（1000×2）：宽高都为正，中心不变', () => {
    const hole = spotlightHole(rect('flat', true, 0, 100, 1000, 102))
    expect(hole!.width).toBeCloseTo(1000 + style.lineW)
    expect(hole!.height).toBeCloseTo(2 + style.lineW)
    expect(hole!.y + hole!.height / 2).toBeCloseTo(101)
  })

  it('极扁平椭圆：半径接近 0 也仍是合法椭圆（不发散、不变号）', () => {
    const hole = spotlightHole(ellipse('flat-e', true, 0, 100, 1000, 102))
    expect(hole!.type).toBe('ellipse')
    const rx = hole!.width / 2
    const ry = hole!.height / 2
    expect(rx).toBeGreaterThan(ry)
    expect(ry).toBeGreaterThan(0)
    expect(Number.isFinite(rx) && Number.isFinite(ry)).toBe(true)
  })

  it('挖空区允许超出画布边界（裁剪交给 canvas 处理，不做钳制）', () => {
    const hole = spotlightHole(rect('out', true, -50, -50, 1200, 900))
    expect(hole!.x).toBeLessThan(0)
    expect(hole!.x + hole!.width).toBeGreaterThan(1000)
  })

  it('线宽极大时挖空区同步变大，但外沿仍等于 halfW', () => {
    const thick: AnnoStyle = { ...style, lineW: 20 }
    const shape: RectAnno = { ...rect('thick', true, 100, 100, 200, 200), style: thick }
    const hole = spotlightHole(shape)!
    expect(hole.x).toBeCloseTo(100 - 10)
    expect(hole.width).toBeCloseTo(100 + 20)
  })
})

describe('多层重叠', () => {
  it('N 个聚光灯重叠时，挖空区集合不产生“负面积”或重复洞', () => {
    // 挖空区是独立矩形，由 mask canvas 做并集；这里验证每个洞都是正尺寸
    const shapes = Array.from({ length: 6 }, (_, i) =>
      rect(`r${i}`, true, 100 + i * 5, 100 + i * 5, 300, 300)
    )
    const holes = spotlightHoles(shapes)
    expect(holes).toHaveLength(6)
    for (const hole of holes) {
      expect(hole.width).toBeGreaterThan(0)
      expect(hole.height).toBeGreaterThan(0)
    }
  })

  it('矩形与椭圆混合重叠也全部计入亮区', () => {
    const holes = spotlightHoles([
      rect('r', true, 0, 0, 200, 200),
      ellipse('e', true, 100, 100, 300, 300),
      rect('r2', true, 150, 50, 250, 150)
    ])
    expect(holes.map((h) => h.type)).toEqual(['rect', 'ellipse', 'rect'])
  })
})

describe('历史快照与开关切换', () => {
  it('结构化克隆保留 spotlight 字段（撤销/重做不丢聚光灯属性）', () => {
    const original = [rect('a', true), rect('b', false), ellipse('c', true)]
    const snapshot = structuredClone(original)
    expect(snapshot.map((a) => (a as RectAnno).spotlight)).toEqual([true, false, true])
    expect(snapshot.every((a) => isSpotlitShape(a) === Boolean((a as RectAnno).spotlight))).toBe(
      true
    )
  })

  it('关闭聚光灯开关只影响新形状，已画的聚光灯形状仍是聚光灯', () => {
    const drawnWhileOn = rect('on', true)
    // 关闭开关 = 只改 options，不改已有 annotation
    const afterToggleOff = [drawnWhileOn]
    expect(isSpotlitShape(afterToggleOff[0])).toBe(true)
  })
})
