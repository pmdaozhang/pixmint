/**
 * 长截图的纯逻辑层。
 *
 * 约定：FrameImage.data 使用 BGRA、每像素 4 字节、自上而下排列，和
 * Electron nativeImage.toBitmap() 的 Windows 输出一致。这里不做 PNG 编解码，
 * 也不依赖 Electron，方便在 Vitest 里直接构造合成帧。
 */

export interface FrameImage {
  width: number
  height: number
  /** BGRA, 4 bytes per pixel, top-down. */
  data: Uint8Array
}

export interface OverlapMatchOptions {
  /** 已知固定表头高度；不传时自动检测。 */
  headerHeight?: number
  /** 最少保留的重叠比例，默认 0.22。 */
  minOverlapRatio?: number
  /** 横向采样步长，默认 4。 */
  sampleStepX?: number
  /** 纵向采样步长，默认 2。 */
  sampleStepY?: number
  /** 最低匹配置信度，默认 0.86。 */
  confidenceThreshold?: number
  /** 完整重叠区验证的最低置信度，默认 0.92。 */
  verificationThreshold?: number
  /** 期望滚动偏移；用于在重复内容中优先选择合理偏移。 */
  expectedOffset?: number
  /** 自动检测表头时允许的最大高度比例，默认 0.3。 */
  maxHeaderRatio?: number
}

export interface OverlapMatch {
  /** 滚动距离，也就是新增内容行数。 */
  offset: number
  /** 滚动后仍重叠的高度。 */
  overlap: number
  /** 需要追加到长图底部的新内容行数，等于 offset。 */
  newRows: number
  /** 0..1 的匹配置信度。 */
  confidence: number
  /** 本次匹配使用的固定表头高度。 */
  headerHeight: number
}

export interface LongCaptureStitcherLimits {
  /** 最大输出高度，默认不限制。 */
  maxHeight?: number
  /** 最大输出像素数，默认不限制。 */
  maxPixels?: number
}

export interface StitchAppendResult {
  appended: number
  truncated: boolean
}

const DEFAULT_MIN_OVERLAP_RATIO = 0.22
const DEFAULT_SAMPLE_STEP_X = 4
const DEFAULT_SAMPLE_STEP_Y = 2
const DEFAULT_CONFIDENCE = 0.86
const DEFAULT_VERIFICATION_CONFIDENCE = 0.92
const DEFAULT_MAX_HEADER_RATIO = 0.3
const BYTES_PER_PIXEL = 4
const EDGE_COUNT_THRESHOLD = 6
const HASH_ROW_RATIO = 0.8
const MIN_INFORMATIVE_RATIO = 0.005

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function assertFrame(frame: FrameImage): void {
  if (
    !Number.isInteger(frame.width) ||
    !Number.isInteger(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0
  ) {
    throw new Error('帧尺寸无效')
  }
  if (frame.data.length !== frame.width * frame.height * BYTES_PER_PIXEL) {
    throw new Error('帧像素长度与尺寸不匹配')
  }
}

function sameSize(a: FrameImage, b: FrameImage): boolean {
  return a.width === b.width && a.height === b.height
}

/** BT.601 近似灰度，输入是 BGRA。 */
function grayAt(data: Uint8Array, index: number): number {
  return (data[index] * 29 + data[index + 1] * 150 + data[index + 2] * 77) >> 8
}

/**
 * 行内强边缘像素数。
 * 只用平均梯度会让横线/空白行也显得“有内容”，这里只统计足够强的文字/图形边缘。
 */
function rowEdgeCount(data: Uint8Array, width: number, row: number): number {
  const base = row * width * BYTES_PER_PIXEL
  let count = 0
  for (let x = 2; x < width; x += 2) {
    const current = base + x * BYTES_PER_PIXEL
    const previous = current - 2 * BYTES_PER_PIXEL
    if (Math.abs(grayAt(data, current) - grayAt(data, previous)) > 12) {
      count += 1
    }
  }
  return count
}

/**
 * 量化行哈希。
 * 每 2 像素取 4 位灰度，能容忍轻微噪声/抗锯齿，但对不同的文字/数字非常敏感。
 */
function rowHash(data: Uint8Array, width: number, row: number): number {
  const base = row * width * BYTES_PER_PIXEL
  let hash = 2166136261
  for (let x = 0; x < width; x += 2) {
    const value = grayAt(data, base + x * BYTES_PER_PIXEL) >> 4
    hash ^= value
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function buildRowHashes(frame: FrameImage): Array<number | null> {
  const hashes = new Array<number | null>(frame.height).fill(null)
  for (let row = 0; row < frame.height; row += 1) {
    if (rowEdgeCount(frame.data, frame.width, row) >= EDGE_COUNT_THRESHOLD) {
      hashes[row] = rowHash(frame.data, frame.width, row)
    }
  }
  return hashes
}

/** 整帧近似相同：用于快速判定“没有滚动”。 */
export function framesAreSimilar(
  previous: FrameImage,
  next: FrameImage,
  options: {
    stepX?: number
    stepY?: number
    averageThreshold?: number
    maximumThreshold?: number
  } = {}
): boolean {
  assertFrame(previous)
  if (!sameSize(previous, next)) return false
  assertFrame(next)
  const stepX = Math.max(1, options.stepX ?? DEFAULT_SAMPLE_STEP_X)
  const stepY = Math.max(1, options.stepY ?? DEFAULT_SAMPLE_STEP_Y)
  let difference = 0
  let samples = 0
  let maximum = 0
  for (let y = 0; y < previous.height; y += stepY) {
    for (let x = 0; x < previous.width; x += stepX) {
      const index = (y * previous.width + x) * BYTES_PER_PIXEL
      const diff =
        Math.abs(previous.data[index] - next.data[index]) +
        Math.abs(previous.data[index + 1] - next.data[index + 1]) +
        Math.abs(previous.data[index + 2] - next.data[index + 2])
      difference += diff
      maximum = Math.max(maximum, diff)
      samples += 1
    }
  }
  if (samples === 0) return true
  const averageOk = difference / samples < (options.averageThreshold ?? 1.5)
  if (!averageOk) return false
  return options.maximumThreshold === undefined
    ? true
    : maximum < options.maximumThreshold
}

/**
 * 对候选偏移验证完整重叠区，而不是只看底部条带。
 * 重复纹理可能在局部条带上碰巧高分，但完整重叠区会把它淘汰。
 */
function overlapConfidence(
  previous: FrameImage,
  next: FrameImage,
  headerHeight: number,
  offset: number,
  stepX: number
): number {
  const scrollHeight = previous.height - headerHeight
  const overlapRows = scrollHeight - offset
  if (overlapRows <= 0) return 0

  const previousStart = headerHeight + offset
  const nextStart = headerHeight
  let difference = 0
  let samples = 0
  let informativeRows = 0
  let hashMatchedRows = 0
  // 完整验证使用更密的采样，并只统计有文字/边缘的行。
  const verificationStepX = Math.min(2, stepX)
  for (let row = 0; row < overlapRows; row += 1) {
    const edgeCount = rowEdgeCount(previous.data, previous.width, previousStart + row)
    if (edgeCount < EDGE_COUNT_THRESHOLD) continue
    informativeRows += 1
    if (
      rowHash(previous.data, previous.width, previousStart + row) ===
      rowHash(next.data, next.width, nextStart + row)
    ) {
      hashMatchedRows += 1
    }
    const previousBase = ((previousStart + row) * previous.width) * BYTES_PER_PIXEL
    const nextBase = ((nextStart + row) * next.width) * BYTES_PER_PIXEL
    for (let x = 0; x < previous.width; x += verificationStepX) {
      const index = x * BYTES_PER_PIXEL
      const diff = Math.abs(
        grayAt(previous.data, previousBase + index) -
          grayAt(next.data, nextBase + index)
      )
      difference += diff
      samples += 1
    }
  }
  if (
    samples === 0 ||
    informativeRows < Math.max(2, overlapRows * MIN_INFORMATIVE_RATIO)
  ) {
    return 0
  }
  const rowRatio = hashMatchedRows / informativeRows
  if (rowRatio < HASH_ROW_RATIO) return 0
  return Math.min(rowRatio, 1 - difference / (samples * 255))
}

/**
 * 检测两帧顶部共同的固定区域。
 *
 * 固定表头在滚动时会留在原位，因此两帧顶部相同的前缀就是表头高度。
 * 如果整个探测区域都相同，通常是“没有滚动”而不是超长表头，返回 0，
 * 让后续匹配失败并走“目标窗口没有滚动”的错误路径。
 */
export function detectStableHeader(
  previous: FrameImage,
  next: FrameImage,
  options: Pick<OverlapMatchOptions, 'maxHeaderRatio' | 'sampleStepX'> = {}
): number {
  assertFrame(previous)
  if (!sameSize(previous, next)) return 0
  assertFrame(next)

  const maxHeaderRows = Math.max(
    1,
    Math.min(
      previous.height,
      Math.floor(previous.height * (options.maxHeaderRatio ?? DEFAULT_MAX_HEADER_RATIO))
    )
  )
  const stepX = Math.max(1, options.sampleStepX ?? DEFAULT_SAMPLE_STEP_X)
  const tolerance = 6
  let stable = 0

  for (let y = 0; y < maxHeaderRows; y += 1) {
    let difference = 0
    let samples = 0
    for (let x = 0; x < previous.width; x += stepX) {
      const index = (y * previous.width + x) * BYTES_PER_PIXEL
      difference += Math.abs(grayAt(previous.data, index) - grayAt(next.data, index))
      samples += 1
    }
    if (samples === 0 || difference / samples > tolerance) break
    stable = y + 1
  }

  return stable >= maxHeaderRows ? 0 : stable
}

/**
 * 在上一帧底部条带和下一帧中搜索滚动偏移。
 *
 * 滚动方向是向下：下一帧顶部是旧内容上移后的结果，底部 d 行才是新内容。
 * 匹配时拿上一帧底部 strip 和下一帧对应位置比较；匹配成功返回 d。
 */
export function matchVerticalOverlap(
  previous: FrameImage,
  next: FrameImage,
  options: OverlapMatchOptions = {}
): OverlapMatch | null {
  assertFrame(previous)
  if (!sameSize(previous, next)) return null
  assertFrame(next)

  const stepX = Math.max(1, options.sampleStepX ?? DEFAULT_SAMPLE_STEP_X)
  const stepY = Math.max(1, options.sampleStepY ?? DEFAULT_SAMPLE_STEP_Y)
  if (framesAreSimilar(previous, next, { stepX, stepY })) return null

  const headerHeight =
    options.headerHeight ??
    detectStableHeader(previous, next, {
      maxHeaderRatio: options.maxHeaderRatio,
      sampleStepX: options.sampleStepX
    })
  const scrollHeight = previous.height - headerHeight
  if (scrollHeight < 32) return null

  const minOverlapRatio = clamp(options.minOverlapRatio ?? DEFAULT_MIN_OVERLAP_RATIO, 0.1, 0.6)
  const minOverlap = Math.max(16, Math.round(scrollHeight * minOverlapRatio))
  if (minOverlap >= scrollHeight) return null

  const maxOffset = scrollHeight - minOverlap
  if (maxOffset <= 0) return null

  const confidenceThreshold = clamp(
    options.confidenceThreshold ?? DEFAULT_CONFIDENCE,
    0.1,
    1
  )
  const verificationThreshold = clamp(
    options.verificationThreshold ?? DEFAULT_VERIFICATION_CONFIDENCE,
    0.1,
    1
  )
  const preferredOffset =
    options.expectedOffset ?? Math.round(scrollHeight * 0.7)

  const candidates: Array<{
    offset: number
    confidence: number
    score: number
  }> = []

  const previousHashes = buildRowHashes(previous)
  const nextHashes = buildRowHashes(next)

  for (let offset = 1; offset <= maxOffset; offset += 1) {
    const overlapRows = scrollHeight - offset
    if (overlapRows < 2) continue
    let informative = 0
    let matched = 0
    for (let row = 0; row < overlapRows; row += 1) {
      const previousHash = previousHashes[headerHeight + offset + row]
      if (previousHash === null) continue
      informative += 1
      if (previousHash === nextHashes[headerHeight + row]) matched += 1
    }
    if (informative < 2) continue
    const confidence = matched / informative
    if (confidence < 0.75) continue
    const distancePenalty =
      0.08 * (Math.abs(offset - preferredOffset) / Math.max(1, scrollHeight))
    const score = confidence - distancePenalty

    candidates.push({ offset, confidence, score })
  }

  candidates.sort((a, b) => b.score - a.score)
  for (const candidate of candidates.slice(0, 16)) {
    if (candidate.confidence < confidenceThreshold) continue
    const verified = overlapConfidence(
      previous,
      next,
      headerHeight,
      candidate.offset,
      stepX
    )
    if (verified < verificationThreshold) continue
    return {
      offset: candidate.offset,
      overlap: scrollHeight - candidate.offset,
      newRows: candidate.offset,
      confidence: Math.min(candidate.confidence, verified),
      headerHeight
    }
  }
  return null
}

/**
 * 增量拼接器。只保留当前长图和固定表头高度，不保留历史帧。
 *
 * 第一帧包含表头和首屏内容；之后每次只追加下一帧滚动区域底部的新行。
 * 表头因此天然只出现一次。
 */
export class LongCaptureStitcher {
  private width = 0
  private height = 0
  private headerHeight = 0
  private data = new Uint8Array(0)
  private initialized = false

  constructor(private readonly limits: LongCaptureStitcherLimits = {}) {}

  get currentHeight(): number {
    return this.height
  }

  get currentWidth(): number {
    return this.width
  }

  initialize(frame: FrameImage, headerHeight = 0): void {
    assertFrame(frame)
    if (!Number.isInteger(headerHeight) || headerHeight < 0 || headerHeight > frame.height) {
      throw new Error('固定表头高度无效')
    }

    const maxHeight = this.limits.maxHeight ?? Number.POSITIVE_INFINITY
    const maxPixels = this.limits.maxPixels ?? Number.POSITIVE_INFINITY
    if (frame.height > maxHeight || frame.width * frame.height > maxPixels) {
      throw new Error('首帧超过长截图上限')
    }

    this.width = frame.width
    this.height = frame.height
    this.headerHeight = headerHeight
    this.data = frame.data.slice()
    this.initialized = true
  }

  append(frame: FrameImage, match: OverlapMatch): StitchAppendResult {
    if (!this.initialized) throw new Error('拼接器尚未初始化')
    assertFrame(frame)
    if (frame.width !== this.width) throw new Error('帧宽度不一致')
    if (match.headerHeight !== this.headerHeight) throw new Error('固定表头高度不一致')
    if (!Number.isInteger(match.newRows) || match.newRows <= 0) {
      return { appended: 0, truncated: false }
    }
    if (match.newRows > frame.height - this.headerHeight) {
      throw new Error('新增行数超过可滚动区域')
    }

    const maxHeight = this.limits.maxHeight ?? Number.POSITIVE_INFINITY
    const maxPixels = this.limits.maxPixels ?? Number.POSITIVE_INFINITY
    const maxRowsByHeight = maxHeight - this.height
    const maxRowsByPixels = Math.floor(maxPixels / this.width) - this.height
    const allowed = Math.max(
      0,
      Math.min(match.newRows, maxRowsByHeight, maxRowsByPixels)
    )
    if (allowed <= 0) return { appended: 0, truncated: true }

    const rowBytes = this.width * BYTES_PER_PIXEL
    const sourceStart = (frame.height - allowed) * rowBytes
    const copyBytes = allowed * rowBytes
    const next = new Uint8Array(this.data.length + copyBytes)
    next.set(this.data)
    next.set(frame.data.subarray(sourceStart, sourceStart + copyBytes), this.data.length)
    this.data = next
    this.height += allowed

    return { appended: allowed, truncated: allowed < match.newRows }
  }

  getFrame(): FrameImage {
    if (!this.initialized) throw new Error('拼接器尚未初始化')
    return {
      width: this.width,
      height: this.height,
      data: this.data
    }
  }
}
