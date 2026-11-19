import { distanceToSegment, normalizeRect, pointInRect } from './geometry'
import type {
  Annotation,
  LineAnno,
  MosaicAnno,
  Point,
  Rect,
  RectAnno,
  SeqAnno,
  TextAnno,
  Tool
} from './types'

export function annotationBounds(annotation: Annotation): Rect {
  if (annotation.type === 'rect' || annotation.type === 'ellipse') {
    const rect = annotation as RectAnno
    return normalizeRect(rect.x1, rect.y1, rect.x2, rect.y2)
  }
  if (annotation.type === 'arrow' || annotation.type === 'pen') {
    const line = annotation as LineAnno
    const points: Point[] = line.points?.length
      ? line.points
      : [
          { x: line.x1, y: line.y1 },
          { x: line.x2, y: line.y2 }
        ]
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys)
    }
  }
  if (annotation.type === 'mosaic') {
    const mosaic = annotation as MosaicAnno
    return normalizeRect(mosaic.x1, mosaic.y1, mosaic.x2, mosaic.y2)
  }
  if (annotation.type === 'text') {
    const text = annotation as TextAnno
    const width =
      text.width && text.width > 0
        ? text.width
        : Math.max(24, text.text.length * text.fontSize * 1.05)
    // 多行文字按行数计算高度，和绘制（fontSize * 1.2 行高）保持一致。
    const lineCount = Math.max(1, text.text.split('\n').length)
    return {
      x: text.x,
      y: text.y,
      width,
      height: lineCount * text.fontSize * 1.2
    }
  }
  const seq = annotation as SeqAnno
  return { x: seq.x - 14, y: seq.y - 14, width: 28, height: 28 }
}

/**
 * 背景：文字标注需要区分「框内点击编辑」和「边框拖动」。
 * 设计意图：命中矩形外沿一定容差即视为边框，供光标切换为十字。
 * 关键约束：四角同时满足横竖条件，避免角点漏判。
 */
export function isNearRectBorder(point: Point, rect: Rect, tolerance = 6): boolean {
  const nearLeft = Math.abs(point.x - rect.x) <= tolerance
  const nearRight = Math.abs(point.x - (rect.x + rect.width)) <= tolerance
  const nearTop = Math.abs(point.y - rect.y) <= tolerance
  const nearBottom = Math.abs(point.y - (rect.y + rect.height)) <= tolerance
  const withinVertical =
    point.y >= rect.y - tolerance && point.y <= rect.y + rect.height + tolerance
  const withinHorizontal =
    point.x >= rect.x - tolerance && point.x <= rect.x + rect.width + tolerance
  return (
    ((nearLeft || nearRight) && withinVertical) ||
    ((nearTop || nearBottom) && withinHorizontal)
  )
}

/**
 * 背景：矩形/箭头工具 hover 边线用 move 光标，文字工具也应统一为 move。
 * 设计意图：文字没有“线”，用外扩一圈模拟边框：外扩 outer 与内缩 inner 之间
 *          的环带视为可移动边框，环带所围的内部保留为编辑区（text 光标）。
 * 关键约束：内缩量取 min(inner, 宽高的一半)，避免小文字框内部被吃光。
 */
export function isInBorderBand(
  point: Point,
  rect: Rect,
  outer = 12,
  inner = 6
): boolean {
  const expanded: Rect = {
    x: rect.x - outer,
    y: rect.y - outer,
    width: rect.width + outer * 2,
    height: rect.height + outer * 2
  }
  const shrinkX = Math.min(inner, rect.width / 2)
  const shrinkY = Math.min(inner, rect.height / 2)
  const innerRect: Rect = {
    x: rect.x + shrinkX,
    y: rect.y + shrinkY,
    width: Math.max(0, rect.width - shrinkX * 2),
    height: Math.max(0, rect.height - shrinkY * 2)
  }
  return pointInRect(point, expanded) && !pointInRect(point, innerRect)
}

export function hitTestAnnotation(annotation: Annotation, point: Point): boolean {
  const tolerance = Math.max(6, annotation.style.lineW + 4)
  if (annotation.type === 'rect' || annotation.type === 'ellipse') {
    const rectAnno = annotation as RectAnno
    const rect = annotationBounds(annotation)
    // 聚光灯形状只认描边，否则半透明遮罩下的整块区域都会被当成分片选中。
    if (rectAnno.fill && !rectAnno.spotlight && pointInRect(point, rect)) return true
    if (rectAnno.type === 'rect') {
      const nearLeft = Math.abs(point.x - rect.x) <= tolerance && point.y >= rect.y - tolerance && point.y <= rect.y + rect.height + tolerance
      const nearRight = Math.abs(point.x - (rect.x + rect.width)) <= tolerance && point.y >= rect.y - tolerance && point.y <= rect.y + rect.height + tolerance
      const nearTop = Math.abs(point.y - rect.y) <= tolerance && point.x >= rect.x - tolerance && point.x <= rect.x + rect.width + tolerance
      const nearBottom = Math.abs(point.y - (rect.y + rect.height)) <= tolerance && point.x >= rect.x - tolerance && point.x <= rect.x + rect.width + tolerance
      return nearLeft || nearRight || nearTop || nearBottom
    }
    if (rect.width < 1 || rect.height < 1) return false
    const rx = rect.width / 2
    const ry = rect.height / 2
    const nx = (point.x - (rect.x + rx)) / (rx + tolerance)
    const ny = (point.y - (rect.y + ry)) / (ry + tolerance)
    return nx * nx + ny * ny <= 1
  }
  if (annotation.type === 'arrow' || annotation.type === 'pen') {
    const line = annotation as LineAnno
    const points: Point[] = line.points?.length
      ? line.points
      : [
          { x: line.x1, y: line.y1 },
          { x: line.x2, y: line.y2 }
        ]
    for (let i = 1; i < points.length; i += 1) {
      if (distanceToSegment(point, points[i - 1], points[i]) <= tolerance) return true
    }
    return false
  }
  if (annotation.type === 'mosaic') {
    // 马赛克是破坏性效果，不允许再被选中拖动；需要修改时用撤销或重新绘制。
    return false
  }
  if (annotation.type === 'text') {
    const rect = annotationBounds(annotation)
    const padding = 4
    return (
      point.x >= rect.x - padding &&
      point.x <= rect.x + rect.width + padding &&
      point.y >= rect.y - padding &&
      point.y <= rect.y + rect.height + padding
    )
  }
  return pointInRect(point, annotationBounds(annotation))
}

/**
 * 背景：注释命中曾不分当前工具，马赛克工具仍会拖动已有图形，切工具后也容易误操作。
 * 设计意图：只允许当前工具编辑同类型注释；空白处仍按该工具新建内容。
 * 关键约束：马赛克是破坏性效果，始终不可拖动；返回 false 时会落到绘制分支。
 */
export function canMoveAnnotationWithTool(annotation: Annotation, tool: Tool): boolean {
  if (tool === 'shape') return annotation.type === 'rect' || annotation.type === 'ellipse'
  if (tool === 'arrow') return annotation.type === 'arrow' || annotation.type === 'pen'
  if (tool === 'text') return annotation.type === 'text'
  if (tool === 'seq') return annotation.type === 'seq'
  return false
}

export function moveAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  if (annotation.type === 'rect' || annotation.type === 'ellipse') {
    const rect = annotation as RectAnno
    rect.x1 += dx
    rect.y1 += dy
    rect.x2 += dx
    rect.y2 += dy
  } else if (annotation.type === 'arrow' || annotation.type === 'pen') {
    const line = annotation as LineAnno
    line.x1 += dx
    line.y1 += dy
    line.x2 += dx
    line.y2 += dy
    line.points = line.points?.map((p) => ({ x: p.x + dx, y: p.y + dy }))
  } else if (annotation.type === 'mosaic') {
    const mosaic = annotation as MosaicAnno
    mosaic.x1 += dx
    mosaic.y1 += dy
    mosaic.x2 += dx
    mosaic.y2 += dy
    mosaic.cells = mosaic.cells.map((cell) => ({ ...cell, x: cell.x + dx, y: cell.y + dy }))
  } else {
    const positioned = annotation as TextAnno | SeqAnno
    positioned.x += dx
    positioned.y += dy
  }
  return annotation
}

export function cloneAnnotations(annotations: Annotation[]): Annotation[] {
  return annotations.map((annotation) => structuredClone(annotation))
}

/**
 * 背景：笔刷马赛克原先只在鼠标事件点放格子，快速拖动时相邻格子会留下明显空隙。
 * 设计意图：沿上一格到当前点的线段按块边长插值补格，保证连续覆盖。
 * 关键约束：步长取块边长的 0.7 倍产生少量重叠；不足一个步长时留给下一次移动，
 * 避免高刷新率鼠标产生海量重叠格子。
 */
export function appendMosaicBrushCells(
  cells: Point[],
  from: Point,
  to: Point,
  size: number
): boolean {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy)
  const step = Math.max(2, size * 0.7)
  if (distance < step) return false
  const count = Math.floor(distance / step)
  for (let index = 1; index <= count; index += 1) {
    const t = (index * step) / distance
    cells.push({ x: from.x + dx * t, y: from.y + dy * t })
  }
  return true
}
