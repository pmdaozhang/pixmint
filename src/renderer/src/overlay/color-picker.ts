export interface RgbColor {
  r: number
  g: number
  b: number
}

export interface SourceRect {
  x: number
  y: number
  width: number
  height: number
}

/** 统一输出大写 #RRGGBB，避免 Ctrl+C 复制出来的格式在不同入口不一致。 */
export function toHex({ r, g, b }: RgbColor): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase()
}

export function toRgbLabel({ r, g, b }: RgbColor): string {
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * 从整屏截图的像素缓冲区里取一个像素。坐标会被夹到图像范围内，
 * 这样鼠标移动到屏幕边缘时仍然能取到边缘像素而不是越界。
 */
export function pixelAt(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number
): RgbColor | null {
  if (width <= 0 || height <= 0) return null
  const px = Math.min(width - 1, Math.max(0, Math.floor(x)))
  const py = Math.min(height - 1, Math.max(0, Math.floor(y)))
  const offset = (py * width + px) * 4
  if (offset + 2 >= data.length) return null
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2] }
}

/**
 * 放大镜取源区域：以鼠标所在物理像素为中心，尽量保持源区域完整；
 * 靠近四边时向内收，保证 drawImage 的源矩形不会越界。
 */
export function clampSourceRect(
  centerX: number,
  centerY: number,
  sourceWidth: number,
  sourceHeight: number,
  imageWidth: number,
  imageHeight: number
): SourceRect {
  const width = Math.max(1, Math.min(sourceWidth, imageWidth))
  const height = Math.max(1, Math.min(sourceHeight, imageHeight))
  const x = Math.min(
    Math.max(0, Math.floor(centerX - width / 2)),
    Math.max(0, imageWidth - width)
  )
  const y = Math.min(
    Math.max(0, Math.floor(centerY - height / 2)),
    Math.max(0, imageHeight - height)
  )
  return { x, y, width, height }
}
