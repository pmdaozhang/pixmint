/**
 * 背景：文字标注需要把输入内容限制在截图选区内，并在靠近选区边框时自动换行。
 * 设计意图：把断行与尺寸计算抽成纯函数，输入框约束、画布绘制和单测共用同一套结果。
 * 关键约束：中文按字断行、英文按词断行；单个超长词按字符强制断开；显式换行保留。
 */

export type TextWidthMeasure = (text: string) => number

export interface TextLayoutResult {
  lines: string[]
  /** 最长行宽度（像素） */
  width: number
  /** 总行高（像素） */
  height: number
  lineHeight: number
  /** 超过可用水深（高度）或宽度时标记，调用方据此阻止输入 */
  overflow: boolean
}

const CJK_RE =
  /[⺀-⻿　-〿぀-ヿ㄀-ㄯ㐀-䶿一-鿿豈-﫿＀-￯]/

const EPSILON = 1e-6

function isCjk(ch: string): boolean {
  return CJK_RE.test(ch)
}

/**
 * 贪心断行：以空格分隔的英文单词、单个中文字符为最小单位。
 * 换行处丢弃行尾空格；行首空格不保留。
 */
function wrapSegment(
  segment: string,
  measure: TextWidthMeasure,
  maxWidth: number
): string[] {
  const lines: string[] = []
  let line = ''
  let index = 0
  const length = segment.length

  const pushLine = (): void => {
    lines.push(line.trimEnd())
  }

  while (index < length) {
    const ch = segment[index]
    let atom: string
    if (ch === ' ') {
      atom = ' '
      index += 1
    } else if (isCjk(ch)) {
      atom = ch
      index += 1
    } else {
      let end = index
      while (end < length && segment[end] !== ' ' && !isCjk(segment[end])) end += 1
      atom = segment.slice(index, end)
      index = end
    }

    if (line.length > 0 && measure(line + atom) > maxWidth + EPSILON) {
      pushLine()
      line = ''
    }

    if (atom.trim().length === 0) continue

    if (measure(atom) > maxWidth + EPSILON) {
      for (const char of atom) {
        if (line.length > 0 && measure(line + char) > maxWidth + EPSILON) {
          pushLine()
          line = char
        } else {
          line += char
        }
      }
      continue
    }

    line += atom
  }

  pushLine()
  return lines
}

export function layoutText(
  text: string,
  measure: TextWidthMeasure,
  fontSize: number,
  maxWidth: number,
  maxHeight: number
): TextLayoutResult {
  const limit = maxWidth > 0 ? maxWidth : 1
  const segments = text.split('\n')
  const lines = segments.flatMap((segment) => wrapSegment(segment, measure, limit))
  const lineHeight = fontSize * 1.2
  const width = lines.reduce((max, line) => Math.max(max, measure(line)), 0)
  const height = lines.length * lineHeight
  return {
    lines,
    width,
    height,
    lineHeight,
    overflow: height > maxHeight + EPSILON || width > limit + EPSILON
  }
}
