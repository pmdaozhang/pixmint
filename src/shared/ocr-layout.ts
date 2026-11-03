import type { OcrTextBlock } from './types'

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/**
 * 背景：OCR 为了识别小字会先放大输入，返回的坐标属于放大后的临时图。
 * 设计意图：统一在主进程边界把坐标还原到原图像素，渲染层只处理一种坐标系。
 * 关键约束：非法缩放系数按 1 处理；空文本和零宽高框必须在进入渲染层前丢弃。
 */
export function scaleOcrBlocks(
  blocks: OcrTextBlock[] | undefined,
  scaleFactor: number
): OcrTextBlock[] {
  if (!blocks?.length) return []
  const factor = finitePositive(scaleFactor) ? scaleFactor : 1
  return blocks
    .map((block) => ({
      text: String(block.text ?? '').trim(),
      x: block.x / factor,
      y: block.y / factor,
      width: block.width / factor,
      height: block.height / factor
    }))
    .filter(
      (block) =>
        block.text.length > 0 &&
        Number.isFinite(block.x) &&
        Number.isFinite(block.y) &&
        finitePositive(block.width) &&
        finitePositive(block.height)
    )
}

/**
 * 背景：PaddleOCR 一行可能包含多个识别片段，渲染层需要一行一个命中框。
 * 设计意图：用片段包围盒的并集生成行框，让文字选择层和图片行位置一致。
 * 关键约束：没有有效片段或文本为空时返回 null，调用方不得渲染空行。
 */
export function lineBlockFromParts(
  parts: OcrTextBlock[],
  text?: string
): OcrTextBlock | null {
  const valid = parts.filter(
    (part) =>
      Number.isFinite(part.x) &&
      Number.isFinite(part.y) &&
      finitePositive(part.width) &&
      finitePositive(part.height)
  )
  if (valid.length === 0) return null
  const lineText = String(text ?? valid.map((part) => part.text).join(' ')).trim()
  if (!lineText) return null
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const part of valid) {
    left = Math.min(left, part.x)
    top = Math.min(top, part.y)
    right = Math.max(right, part.x + part.width)
    bottom = Math.max(bottom, part.y + part.height)
  }
  return {
    text: lineText,
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  }
}
