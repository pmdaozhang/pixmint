import type { RecorderMode, RecorderSize } from './types'

export const MAX_GIF_DURATION_MS = 60_000
export const MAX_VIDEO_DURATION_MS = 600_000
export const GIF_FRAME_COLORS = 256
export const GIF_MAX_LONG_SIDE = 720

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
 * 背景：GIF 每帧要做调色板量化和 LZW 压缩，全屏 1919×1079 实测只有约 1.5 FPS。
 * 设计意图：把 GIF 长边限制在 720，优先保证帧率；小选区不超过 720 时不缩放。
 * 关键约束：这是 GIF 专用上限，视频仍按原尺寸 1920 长边保护。
 */
export function fitGifOutputSize(width: number, height: number): OutputSize {
  return fitOutputSize(width, height, '720')
}

/**
 * 背景：GIF 每帧 quantize 是全像素扫描，720 长边下仍会拖慢帧率。
 * 设计意图：大帧用降采样样本生成 256 色调色板，再把调色板应用到完整帧；
 * 调色板质量足够，但 quantize 成本显著下降。
 * 关键约束：小帧保持全像素量化；样本步长越大速度越快，颜色细节越少。
 */
export function gifPaletteSampleStep(width: number, height: number): number {
  const pixels = Math.max(1, width * height)
  if (pixels <= 120_000) return 1
  if (pixels <= 300_000) return 2
  return 3
}

export function pickVideoMime(isSupported: (mimeType: string) => boolean): VideoMime | null {
  return VIDEO_MIME_CANDIDATES.find((candidate) => isSupported(candidate.mimeType)) ?? null
}

export function estimateVideoBitrate(width: number, height: number, fps: number): number {
  const pixels = Math.max(1, width * height)
  const base = pixels * Math.max(10, Math.min(60, fps)) * 0.09
  return Math.round(Math.max(2_000_000, Math.min(24_000_000, base)))
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
