import type { LineStyle, Point } from './types'

export interface ArrowHeadMetrics {
  length: number
  halfWidth: number
  open: boolean
}

/**
 * 背景：短线或急弯上，固定尺寸箭头会比线段本身还长，导致箭头乱跳、看起来错位。
 * 设计意图：按可用路径长度等比收缩箭头，同时保留线宽带来的最大尺寸。
 * 关键约束：双箭头各占一段，调用方传入的 share 应小于单箭头。
 */
export function fitArrowHeadMetrics(
  metrics: ArrowHeadMetrics,
  pathLengthValue: number,
  share = 0.45
): ArrowHeadMetrics {
  const maxLength = Math.max(2.5, pathLengthValue * share)
  const scale = Math.min(1, maxLength / Math.max(0.001, metrics.length))
  return {
    length: metrics.length * scale,
    halfWidth: metrics.halfWidth * scale,
    open: metrics.open
  }
}

export function arrowHeadMetrics(style: LineStyle, baseW: number): ArrowHeadMetrics {
  if (style === 'thin') {
    return {
      length: Math.max(9, baseW * 4.2),
      halfWidth: Math.max(2.6, baseW * 1.35),
      open: true
    }
  }
  if (style === 'sketch') {
    return {
      length: Math.max(13, baseW * 5.5),
      halfWidth: Math.max(4.2, baseW * 1.7),
      open: false
    }
  }
  return {
    length: Math.max(11, baseW * 4.8),
    halfWidth: Math.max(3.2, baseW * 1.45),
    open: false
  }
}

export function pathLength(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return total
}

/** 沿路径从末端回缩指定距离，跨多个短采样点也正确裁切。 */
export function trimPathEnd(points: Point[], distance: number): Point[] {
  if (!points || points.length < 2 || distance <= 0) return points ? points.map((p) => ({ ...p })) : points
  const out = points.map((p) => ({ x: p.x, y: p.y }))
  let remain = distance
  while (out.length > 1 && remain > 0) {
    const a = out[out.length - 2]
    const b = out[out.length - 1]
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y)
    if (segmentLength <= 0.001) {
      out.pop()
      continue
    }
    if (segmentLength <= remain) {
      out.pop()
      remain -= segmentLength
    } else {
      const ratio = (segmentLength - remain) / segmentLength
      out[out.length - 1] = {
        x: a.x + (b.x - a.x) * ratio,
        y: a.y + (b.y - a.y) * ratio
      }
      remain = 0
    }
  }
  return out
}

/** 沿路径从起点回缩指定距离，供双箭头同时裁切两端。 */
export function trimPathStart(points: Point[], distance: number): Point[] {
  if (!points || points.length < 2 || distance <= 0) {
    return points ? points.map((p) => ({ ...p })) : points
  }
  return trimPathEnd(points.slice().reverse(), distance).reverse()
}

/**
 * 取回退一段路径后所在主线段的方向。
 * 这样收笔钩子只影响最后一小段，不会把整支箭头带歪。
 */
export function endTangent(points: Point[], radius: number): Point | null {
  if (!points || points.length < 2) return null
  const total = pathLength(points)
  if (total <= radius) {
    const start = points[0]
    const end = points[points.length - 1]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    return length < 0.5 ? null : { x: dx / length, y: dy / length }
  }
  let travelled = 0
  let i = points.length - 1
  while (i > 0 && travelled < radius) {
    travelled += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    i -= 1
  }
  const a = points[i]
  const b = points[Math.min(i + 1, points.length - 1)]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length < 0.5) return null
  return { x: dx / length, y: dy / length }
}

/**
 * 起点箭头方向。反转路径后复用稳定末端切线，避免手绘起笔抖动带歪箭头。
 */
export function startTangent(points: Point[], radius: number): Point | null {
  if (!points || points.length < 2) return null
  return endTangent(points.slice().reverse(), radius)
}

/**
 * 保留主线段，末端用三次贝塞尔平滑接到箭头内部的目标点。
 * 箭头尖仍是原始收笔点，但可见线段进入箭头时严格沿 dir。
 */
export function straightenTail(
  points: Point[],
  dir: Point,
  lookback: number,
  stopDistance = 0
): Point[] {
  if (!dir || !points || points.length < 2) {
    return points ? points.map((p) => ({ ...p })) : points
  }
  const tip = points[points.length - 1]
  const safeStop = Math.min(Math.max(0, stopDistance), pathLength(points) * 0.8)
  const target = { x: tip.x - dir.x * safeStop, y: tip.y - dir.y * safeStop }
  let i = points.length - 1
  let remain = lookback
  let join: Point | null = null
  while (i > 0) {
    const segment = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    if (segment >= remain) {
      const t = segment > 0 ? remain / segment : 0
      join = {
        x: points[i].x + (points[i - 1].x - points[i].x) * t,
        y: points[i].y + (points[i - 1].y - points[i].y) * t
      }
      break
    }
    remain -= segment
    i -= 1
  }
  if (!join) join = points[0]
  const head = points.slice(0, i)
  const push = (p: Point): void => {
    const last = head[head.length - 1]
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.01) head.push(p)
  }
  push(join)
  const span = Math.hypot(target.x - join.x, target.y - join.y)
  if (span < 0.01) {
    push(target)
    return head
  }
  const c1 = { x: join.x + dir.x * (span / 3), y: join.y + dir.y * (span / 3) }
  const c2 = { x: target.x - dir.x * (span / 3), y: target.y - dir.y * (span / 3) }
  const samples = 14
  for (let step = 1; step <= samples; step += 1) {
    const t = step / samples
    const mt = 1 - t
    push({
      x: mt * mt * mt * join.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * target.x,
      y: mt * mt * mt * join.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * target.y
    })
  }
  return head
}

export function penLookback(baseW: number): number {
  return Math.max(15, Math.min(28, baseW * 6))
}
