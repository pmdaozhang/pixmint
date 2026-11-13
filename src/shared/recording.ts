import type { RecorderMode, RecorderSize } from './types'

export const MAX_GIF_DURATION_MS = 60_000
export const MAX_VIDEO_DURATION_MS = 600_000
export const GIF_FRAME_COLORS = 256
export const GIF_MAX_LONG_SIDE = 1080

export interface OutputSize {
  width: number
  height: number
}

export interface VideoMime {
  mimeType: string
  extension: 'mp4' | 'webm'
}

const VIDEO_MIME_CANDIDATES: VideoMime[] = [
  // avc1 在 canvas.captureStream + MediaRecorder 下可能提前结束视频轨；
  // Chromium 官方提示改用 avc3（带内 SPS/PPS）可避免编码描述变化。
  { mimeType: 'video/mp4;codecs=avc3,mp4a.40.2', extension: 'mp4' },
  { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
  { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' }
]

export function maxDurationFor(mode: RecorderMode): number {
  return mode === 'gif' ? MAX_GIF_DURATION_MS : MAX_VIDEO_DURATION_MS
}

/**
 * 输出尺寸以「长边不超过 720/480」为准，原始尺寸保持物理像素。
 * 同时对原始尺寸做 1920 长边保护，避免 4K 选区把 GIF 编码器拖死。
 */
export function fitOutputSize(width: number, height: number, size: RecorderSize): OutputSize {
  const safeWidth = Math.max(2, Math.round(width))
  const safeHeight = Math.max(2, Math.round(height))
  const requestedMax =
    size === 'original' ? 1920 : Number.parseInt(size, 10)
  const longSide = Math.max(safeWidth, safeHeight)
  if (longSide <= requestedMax) return { width: safeWidth, height: safeHeight }
  const scale = requestedMax / longSide
  return {
    width: Math.max(2, Math.round(safeWidth * scale)),
    height: Math.max(2, Math.round(safeHeight * scale))
  }
}

/**
 * 视频输出尺寸：720/1080 是“短边上限”，只缩小、不放大。
 * 选区本身小于目标时保持原生分辨率，避免把小区域拉伸放糊；
 * 选区大于目标时才按比例缩小到目标短边。
 * GIF 不走这里，仍用 fitGifOutputSize 限制长边 720。
 */
export function fitVideoOutputSize(width: number, height: number, size: RecorderSize): OutputSize {
  const safeWidth = Math.max(2, Math.round(width))
  const safeHeight = Math.max(2, Math.round(height))
  if (size === 'original') return fitOutputSize(safeWidth, safeHeight, 'original')
  if (size === '480') return fitOutputSize(safeWidth, safeHeight, '480')
  const target = size === '1080' ? 1080 : 720
  const shortSide = Math.min(safeWidth, safeHeight)
  if (shortSide <= target) return { width: safeWidth, height: safeHeight }
  const scale = target / shortSide
  return {
    width: Math.max(2, Math.round(safeWidth * scale)),
    height: Math.max(2, Math.round(safeHeight * scale))
  }
}

/**
 * 背景：GIF 每帧要做调色板量化和 LZW 压缩，全屏 1919×1079 实测只有约 1.5 FPS。
 * 设计意图：把 GIF 长边限制在 1080，让小选区保持原生分辨率、大选区也只缩到 1080，
 * 避免 720 长边把界面文字先缩糊；帧率靠录制器按实际编码速度丢帧兜底。
 * 关键约束：这是 GIF 专用上限，视频不走这里。
 */
export function fitGifOutputSize(width: number, height: number): OutputSize {
  return fitOutputSize(width, height, '1080')
}

/**
 * 背景：GIF 每帧 quantize 是全像素扫描，1080 长边下全像素统计仍然偏慢。
 * 设计意图：1080 以内的帧尽量用全像素生成调色板，保证文字抗锯齿和小色块不丢色；
 * 只有接近 1080×1080 的方形大帧才降采样，控制编码压力。
 * 关键约束：只影响调色板统计，不改变最终帧尺寸和逐像素映射。
 */
export function gifPaletteSampleStep(width: number, height: number): number {
  const pixels = Math.max(1, width * height)
  if (pixels <= 900_000) return 1
  if (pixels <= 1_800_000) return 2
  return 3
}

export function pickVideoMime(isSupported: (mimeType: string) => boolean): VideoMime | null {
  return VIDEO_MIME_CANDIDATES.find((candidate) => isSupported(candidate.mimeType)) ?? null
}

export function estimateVideoBitrate(width: number, height: number, fps: number): number {
  const pixels = Math.max(1, width * height)
  // 0.18 bit/pixel 是文字、表格类屏幕内容比较稳妥的码率；
  // 旧值 0.09 在 720p/1080p 下文字边缘会糊。
  const base = pixels * Math.max(10, Math.min(60, fps)) * 0.18
  return Math.round(Math.max(3_000_000, Math.min(30_000_000, base)))
}

/**
 * 背景：GIF 量化在选区较大时会慢于实时，编码器会主动丢帧。
 * 设计意图：用两帧真实采集时间的差值作为上一帧的显示时长，
 * 即使丢帧，播放总时长仍与录制时间一致，避免“开了加速”。
 * 关键约束：gifenc 的 delay 单位是毫秒；首帧没有上一帧时使用标称帧间隔。
 */
export function gifFrameDelay(
  now: number,
  lastFrameAt: number,
  fallbackDelay: number
): number {
  const delay = lastFrameAt > 0 ? now - lastFrameAt : fallbackDelay
  return Math.max(10, Math.round(delay))
}

export function formatRecordingDuration(ms: number): string {
  const safe = Math.max(0, ms)
  const totalSeconds = safe / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`
}

export function recordingFileName(mode: RecorderMode, extension: string, date = new Date()): string {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ].join('')
  return `Pixmint-${mode === 'gif' ? 'GIF' : 'Video'}-${stamp}.${extension}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
