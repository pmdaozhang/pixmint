import type { OcrTextBlock } from '@shared/types'

export interface PinTextLayoutLine {
  id: string
  text: string
  left: number
  top: number
  width: number
  height: number
  fontSize: number
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/**
 * 背景：OCR 坐标基于原图像素，钉图窗口会随图片尺寸和工作区缩放而变化。
 * 设计意图：按当前图片显示尺寸生成绝对定位行框，文字层无需缩放整个 DOM。
 * 关键约束：行框必须夹在图片范围内；空文本、非法尺寸和零视口不产生节点。
 */
export function layoutPinTextLines(
  blocks: OcrTextBlock[],
  naturalSize: { width: number; height: number },
  viewport: { width: number; height: number }
): PinTextLayoutLine[] {
  if (!positive(naturalSize.width) || !positive(naturalSize.height)) return []
  if (!positive(viewport.width) || !positive(viewport.height)) return []
  const scaleX = viewport.width / naturalSize.width
  const scaleY = viewport.height / naturalSize.height
  return blocks
    .filter(
      (block) =>
        String(block.text ?? '').trim().length > 0 &&
        Number.isFinite(block.x) &&
        Number.isFinite(block.y) &&
        positive(block.width) &&
        positive(block.height)
    )
    .slice()
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .flatMap((block, index) => {
      const left = Math.max(0, Math.min(viewport.width, block.x * scaleX))
      const top = Math.max(0, Math.min(viewport.height, block.y * scaleY))
      const right = Math.max(0, Math.min(viewport.width, (block.x + block.width) * scaleX))
      const bottom = Math.max(
        0,
        Math.min(viewport.height, (block.y + block.height) * scaleY)
      )
      const width = right - left
      const height = bottom - top
      if (width <= 0 || height <= 0) return []
      return [
        {
          id: `${index}-${block.x}-${block.y}`,
          text: String(block.text).trim(),
          left,
          top,
          width,
          height,
          fontSize: Math.max(7, height * 0.9)
        }
      ]
    })
}
