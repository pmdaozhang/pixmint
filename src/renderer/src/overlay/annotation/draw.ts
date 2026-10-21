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
} from '@shared/arrow-geometry'
import type {
  Annotation,
  LineAnno,
  LineStyle,
  MosaicAnno,
  Point,
  Rect
} from '@shared/types'

export function subdivide(points: Point[], count: number): Point[] {
  if (points.length !== 2) return points.slice()
  const out: Point[] = []
  for (let i = 0; i <= count; i += 1) {
    const t = i / count
    out.push({
      x: points[0].x + (points[1].x - points[0].x) * t,
      y: points[0].y + (points[1].y - points[0].y) * t
    })
  }
  return out
}

export function wobble(points: Point[], amplitude: number): Point[] {
  return points.map((point, index) => {
    const t = Math.min(index, points.length - 2)
    const dx = points[t + 1].x - points[t].x
    const dy = points[t + 1].y - points[t].y
    const length = Math.hypot(dx, dy) || 1
    const fade = Math.min(1, Math.sin((Math.PI * index) / Math.max(1, points.length - 1)) * 3)
    const wave =
      Math.sin(index * 0.33 + points.length * 0.13) * 0.82 +
      Math.sin(index * 0.61 + 1.4) * 0.18
    const jitter = wave * amplitude * fade
    return { x: point.x + (-dy / length) * jitter, y: point.y + (dx / length) * jitter }
  })
}

/**
 * 背景：自由手绘的原始鼠标点会带高频抖动，直接描边会出现锯齿和生硬转折。
 * 设计意图：对内部点做多次加权平均，端点保持不动，让笔触顺滑但不改变起止位置。
 * 关键约束：只用于手绘风格；实线、细线、点线仍保留用户原始轨迹。
 */
export function smoothPolyline(points: Point[], passes = 2): Point[] {
  if (points.length < 3) return points.map((point) => ({ ...point }))
  let out = points.map((point) => ({ ...point }))
  for (let pass = 0; pass < passes; pass += 1) {
    out = out.map((point, index) => {
      if (index === 0 || index === out.length - 1) return point
      const previous = out[index - 1]
      const next = out[index + 1]
      return {
        x: (previous.x + point.x * 2 + next.x) / 4,
        y: (previous.y + point.y * 2 + next.y) / 4
      }
    })
  }
  return out
}

export function strokePathStyled(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  style: LineStyle,
  baseW: number,
  color: string
): void {
  if (points.length < 2) return
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const trace = (arr: Point[]): void => {
    ctx.beginPath()
    arr.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.stroke()
  }
  if (style === 'thin') {
    ctx.lineWidth = Math.max(1.1, baseW * 0.6)
    trace(points)
  } else if (style === 'dotted') {
    ctx.lineWidth = baseW
    ctx.setLineDash([baseW * 0.7, baseW * 2.1])
    trace(points)
    ctx.setLineDash([])
  } else if (style === 'sketch') {
    const total = pathLength(points)
    const sampleCount =
      points.length === 2
        ? Math.max(24, Math.min(220, Math.round(total / 1.2)))
        : points.length
    const source = points.length === 2 ? subdivide(points, sampleCount) : points
    const amplitude = Math.max(
      baseW * 0.12,
      Math.min(baseW * (points.length === 2 ? 0.45 : 0.3), total / 160)
    )
    const sub = points.length === 2 ? wobble(source, amplitude) : source
    const traceSmooth = (): void => {
      ctx.beginPath()
      ctx.moveTo(sub[0].x, sub[0].y)
      for (let i = 1; i < sub.length - 1; i += 1) {
        const nextX = (sub[i].x + sub[i + 1].x) / 2
        const nextY = (sub[i].y + sub[i + 1].y) / 2
        ctx.quadraticCurveTo(sub[i].x, sub[i].y, nextX, nextY)
      }
      const last = sub[sub.length - 1]
      ctx.lineTo(last.x, last.y)
      ctx.stroke()
    }
    const pass = (widthScale: number, alpha: number, dx: number, dy: number): void => {
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(dx, dy)
      ctx.lineWidth = Math.max(0.8, baseW * widthScale)
      traceSmooth()
      ctx.restore()
    }
    pass(0.62, points.length === 2 ? 0.14 : 0.1, 0.6, -0.45)
    pass(1, 1, 0, 0)
  } else {
    ctx.lineWidth = baseW
    trace(points)
  }
}

export function drawArrowHeadDir(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ux: number,
  uy: number,
  style: LineStyle,
  baseW: number,
  color: string,
  metricsOverride?: ReturnType<typeof arrowHeadMetrics>
): void {
  const metrics = metricsOverride ?? arrowHeadMetrics(style, baseW)
  const px = -uy
  const py = ux
  const baseX = x - ux * metrics.length
  const baseY = y - uy * metrics.length
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (metrics.open) {
    ctx.lineWidth = Math.max(1.1, baseW * 0.6)
    ctx.beginPath()
    ctx.moveTo(baseX + px * metrics.halfWidth, baseY + py * metrics.halfWidth)
    ctx.lineTo(x, y)
    ctx.lineTo(baseX - px * metrics.halfWidth, baseY - py * metrics.halfWidth)
    ctx.stroke()
    return
  }
  if (style === 'sketch') {
    const wingX = baseX + px * metrics.halfWidth
    const wingY = baseY + py * metrics.halfWidth
    const otherX = baseX - px * metrics.halfWidth
    const otherY = baseY - py * metrics.halfWidth
    const notchX = baseX + ux * metrics.length * 0.28
    const notchY = baseY + uy * metrics.length * 0.28
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(wingX, wingY)
    ctx.quadraticCurveTo(notchX, notchY, otherX, otherY)
    ctx.closePath()
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(baseX + px * metrics.halfWidth, baseY + py * metrics.halfWidth)
  ctx.lineTo(baseX - px * metrics.halfWidth, baseY - py * metrics.halfWidth)
  ctx.closePath()
  ctx.fill()
}

export function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: LineStyle,
  baseW: number,
  color: string,
  metricsOverride?: ReturnType<typeof arrowHeadMetrics>
): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)
  if (length < 0.5) return
  drawArrowHeadDir(
    ctx,
    x2,
    y2,
    dx / length,
    dy / length,
    style,
    baseW,
    color,
    metricsOverride
  )
}

export function grayAt(image: ImageData | null, x: number, y: number): number {
  if (!image) return 128
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return 128
  const offset = (py * image.width + px) * 4
  return (image.data[offset] + image.data[offset + 1] + image.data[offset + 2]) / 3
}

export function createMosaicCellsForRect(rect: Rect, size: number): Point[] {
  const cells: Point[] = []
  const step = Math.max(4, size)
  for (let x = rect.x + step / 2; x < rect.x + rect.width; x += step) {
    for (let y = rect.y + step / 2; y < rect.y + rect.height; y += step) {
      cells.push({ x, y })
    }
  }
  return cells
}

function drawLineAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: LineAnno
): void {
  const color = annotation.style.color
  const baseW = annotation.style.lineW
  const style = annotation.style.lineStyle
  const arrowMode = annotation.style.arrowMode
  const hasEndArrow = arrowMode !== 'none'
  const hasStartArrow = arrowMode === 'double'
  const headShare = hasStartArrow ? 0.3 : 0.42
  if (annotation.type === 'arrow') {
    const points = [
      { x: annotation.x1, y: annotation.y1 },
      { x: annotation.x2, y: annotation.y2 }
    ]
    let line = points
    const total = pathLength(points)
    if (total < 2.5) {
      strokePathStyled(ctx, line, style, baseW, color)
      return
    }
    const metrics = fitArrowHeadMetrics(
      arrowHeadMetrics(style, baseW),
      total,
      headShare
    )
    if (style !== 'sketch' && hasEndArrow) {
      line = trimPathEnd(line, Math.min(metrics.length * 0.86, total * 0.5))
    }
    if (style !== 'sketch' && hasStartArrow) {
      line = trimPathStart(line, Math.min(metrics.length * 0.86, total * 0.35))
    }
    strokePathStyled(ctx, line, style, baseW, color)
    if (hasEndArrow) {
      drawArrowHead(
        ctx,
        annotation.x1,
        annotation.y1,
        annotation.x2,
        annotation.y2,
        style,
        baseW,
        color,
        metrics
      )
    }
    if (hasStartArrow) {
      drawArrowHead(
        ctx,
        annotation.x2,
        annotation.y2,
        annotation.x1,
        annotation.y1,
        style,
        baseW,
        color,
        metrics
      )
    }
    return
  }
  const points = annotation.points?.length
    ? annotation.points
    : [
        { x: annotation.x1, y: annotation.y1 },
        { x: annotation.x2, y: annotation.y2 }
      ]
  const total = pathLength(points)
  if (total < 2.5) {
    strokePathStyled(ctx, points, style, baseW, color)
    return
  }
  const sourcePoints =
    style === 'sketch' && points.length > 2 ? smoothPolyline(points) : points
  const tangentPoints =
    style === 'sketch' ? sourcePoints : points.length > 2 ? smoothPolyline(points, 1) : points
  const metrics = fitArrowHeadMetrics(
    arrowHeadMetrics(style, baseW),
    total,
    headShare
  )
  const lookback = Math.max(4, Math.min(penLookback(baseW), total * 0.35))
  let line = sourcePoints
  let endDirection: Point | null = null
  if (style !== 'sketch' && hasEndArrow && sourcePoints.length > 1) {
    endDirection = endTangent(tangentPoints, lookback)
    const stop = metrics.open ? Math.max(1.5, metrics.length * 0.25) : metrics.length * 0.86
    line = endDirection
      ? straightenTail(sourcePoints, endDirection, lookback, stop)
      : trimPathEnd(sourcePoints, Math.min(stop, total * 0.5))
  }
  if (style !== 'sketch' && hasStartArrow && sourcePoints.length > 1) {
    const stop = metrics.open ? Math.max(1.5, metrics.length * 0.25) : metrics.length * 0.86
    line = trimPathStart(line, Math.min(stop, total * 0.35))
  }
  strokePathStyled(ctx, line, style, baseW, color)
  if (hasEndArrow && sourcePoints.length > 1) {
    const direction = endDirection ?? endTangent(tangentPoints, lookback)
    if (direction) {
      const tip = sourcePoints[sourcePoints.length - 1]
      drawArrowHeadDir(
        ctx,
        tip.x,
        tip.y,
        direction.x,
        direction.y,
        style,
        baseW,
        color,
        metrics
      )
    } else {
      const n = sourcePoints.length
      drawArrowHead(
        ctx,
        sourcePoints[n - 2].x,
        sourcePoints[n - 2].y,
        sourcePoints[n - 1].x,
        sourcePoints[n - 1].y,
        style,
        baseW,
        color,
        metrics
      )
    }
  }
  if (hasStartArrow && sourcePoints.length > 1) {
    const direction = startTangent(tangentPoints, lookback)
    if (direction) {
      const start = sourcePoints[0]
      drawArrowHeadDir(
        ctx,
        start.x,
        start.y,
        direction.x,
        direction.y,
        style,
        baseW,
        color,
        metrics
      )
    } else {
      drawArrowHead(
        ctx,
        sourcePoints[1].x,
        sourcePoints[1].y,
        sourcePoints[0].x,
        sourcePoints[0].y,
        style,
        baseW,
        color,
        metrics
      )
    }
  }
}

function drawMosaicAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: MosaicAnno,
  _background: ImageData | null,
  backgroundCanvas: CanvasImageSource | null
): void {
  const source = backgroundCanvas as HTMLCanvasElement | null
  if (!source) {
    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = '#0a84ff'
    ctx.lineWidth = 1.5
    ctx.strokeRect(
      Math.min(annotation.x1, annotation.x2),
      Math.min(annotation.y1, annotation.y2),
      Math.abs(annotation.x2 - annotation.x1),
      Math.abs(annotation.y2 - annotation.y1)
    )
    ctx.restore()
    return
  }
  const block = Math.max(1, Math.round(annotation.size))
  const pixelated = getPixelatedCanvas(source, block)
  if (annotation.mode === 'rect') {
    const x = Math.min(annotation.x1, annotation.x2)
    const y = Math.min(annotation.y1, annotation.y2)
    const width = Math.abs(annotation.x2 - annotation.x1)
    const height = Math.abs(annotation.y2 - annotation.y1)
    if (width <= 0 || height <= 0) return
    ctx.save()
    ctx.globalAlpha = MOSAIC_OPACITY
    ctx.beginPath()
    ctx.rect(x, y, width, height)
    ctx.clip()
    ctx.drawImage(pixelated, 0, 0)
    ctx.restore()
    return
  }
  if (!annotation.cells.length) return
  const mask = document.createElement('canvas')
  mask.width = source.width
  mask.height = source.height
  const maskCtx = mask.getContext('2d')
  if (!maskCtx) return
  maskCtx.strokeStyle = '#fff'
  maskCtx.fillStyle = '#fff'
  const brushWidth = annotation.brushSize ?? DEFAULT_MOSAIC_BRUSH
  maskCtx.lineWidth = brushWidth
  maskCtx.lineCap = 'round'
  maskCtx.lineJoin = 'round'
  if (annotation.cells.length === 1) {
    const point = annotation.cells[0]
    maskCtx.beginPath()
    maskCtx.arc(point.x, point.y, brushWidth / 2, 0, Math.PI * 2)
    maskCtx.fill()
  } else {
    maskCtx.beginPath()
    maskCtx.moveTo(annotation.cells[0].x, annotation.cells[0].y)
    for (let index = 1; index < annotation.cells.length; index += 1) {
      maskCtx.lineTo(annotation.cells[index].x, annotation.cells[index].y)
    }
    maskCtx.stroke()
  }
  const output = document.createElement('canvas')
  output.width = source.width
  output.height = source.height
  const outputCtx = output.getContext('2d')
  if (!outputCtx) return
  outputCtx.drawImage(pixelated, 0, 0)
  outputCtx.globalCompositeOperation = 'destination-in'
  outputCtx.drawImage(mask, 0, 0)
  ctx.save()
  ctx.globalAlpha = MOSAIC_OPACITY
  ctx.drawImage(output, 0, 0)
  ctx.restore()
}

const DEFAULT_MOSAIC_BRUSH = 24
const MOSAIC_OPACITY = 0.95
const pixelatedCache = new WeakMap<HTMLCanvasElement, Map<number, HTMLCanvasElement>>()

/**
 * 背景：密度滑杆会频繁重绘马赛克，如果每次重新降采样整张选区会很卡。
 * 设计意图：按“背景画布 + 块边长”缓存像素化结果，拖动滑杆或重绘标注时直接复用。
 * 关键约束：背景画布在选区和工具切换时会重建，旧缓存由 WeakMap 自动回收。
 */
function getPixelatedCanvas(source: HTMLCanvasElement, block: number): HTMLCanvasElement {
  if (block <= 1) return source
  let byBlock = pixelatedCache.get(source)
  if (!byBlock) {
    byBlock = new Map()
    pixelatedCache.set(source, byBlock)
  }
  const cached = byBlock.get(block)
  if (cached) return cached
  const sampleWidth = Math.max(1, Math.ceil(source.width / block))
  const sampleHeight = Math.max(1, Math.ceil(source.height / block))
  const sample = document.createElement('canvas')
  sample.width = sampleWidth
  sample.height = sampleHeight
  const sampleCtx = sample.getContext('2d')
  if (!sampleCtx) return source
  sampleCtx.imageSmoothingEnabled = true
  sampleCtx.drawImage(source, 0, 0, source.width, source.height, 0, 0, sampleWidth, sampleHeight)
  const output = document.createElement('canvas')
  output.width = source.width
  output.height = source.height
  const outputCtx = output.getContext('2d')
  if (!outputCtx) return source
  outputCtx.imageSmoothingEnabled = false
  outputCtx.drawImage(sample, 0, 0, sampleWidth, sampleHeight, 0, 0, source.width, source.height)
  byBlock.set(block, output)
  return output
}

function drawTextAnnotation(ctx: CanvasRenderingContext2D, annotation: Annotation): void {
  if (annotation.type !== 'text') return
  const style = annotation.style
  const font = `${annotation.italic ? 'italic ' : ''}${annotation.bold ? '700 ' : '400 '}${annotation.fontSize}px ${annotation.fontFamily}`
  ctx.fillStyle = style.color
  ctx.font = font
  ctx.textBaseline = 'top'
  ctx.fillText(annotation.text, annotation.x, annotation.y)
  if (annotation.underline) {
    const width = ctx.measureText(annotation.text).width
    ctx.strokeStyle = style.color
    ctx.lineWidth = Math.max(1, annotation.fontSize / 14)
    ctx.beginPath()
    ctx.moveTo(annotation.x, annotation.y + annotation.fontSize + 2)
    ctx.lineTo(annotation.x + width, annotation.y + annotation.fontSize + 2)
    ctx.stroke()
  }
}

export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  background: ImageData | null,
  backgroundCanvas: CanvasImageSource | null = null
): void {
  ctx.save()
  const style = annotation.style
  ctx.strokeStyle = style.color
  ctx.fillStyle = style.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (annotation.type === 'rect' || annotation.type === 'ellipse') {
    const x = Math.min(annotation.x1, annotation.x2)
    const y = Math.min(annotation.y1, annotation.y2)
    const width = Math.abs(annotation.x2 - annotation.x1)
    const height = Math.abs(annotation.y2 - annotation.y1)
    if (annotation.type === 'rect') {
      if (annotation.fill) {
        ctx.globalAlpha = 0.22
        ctx.fillRect(x, y, width, height)
        ctx.globalAlpha = 1
      }
      ctx.lineWidth = style.lineW
      ctx.strokeRect(x, y, width, height)
    } else {
      ctx.beginPath()
      ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
      if (annotation.fill) {
        ctx.globalAlpha = 0.22
        ctx.fill()
        ctx.globalAlpha = 1
      }
      ctx.lineWidth = style.lineW
      ctx.stroke()
    }
  } else if (annotation.type === 'arrow' || annotation.type === 'pen') {
    drawLineAnnotation(ctx, annotation)
  } else if (annotation.type === 'mosaic') {
    drawMosaicAnnotation(ctx, annotation, background, backgroundCanvas)
  } else if (annotation.type === 'text') {
    drawTextAnnotation(ctx, annotation)
  } else if (annotation.type === 'seq') {
    ctx.beginPath()
    ctx.arc(annotation.x, annotation.y, 12, 0, Math.PI * 2)
    ctx.fillStyle = style.color
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = '600 12px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(annotation.n), annotation.x, annotation.y + 0.5)
  }
  ctx.restore()
}
