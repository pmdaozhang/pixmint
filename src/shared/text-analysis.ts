import type { Language } from './types'

export interface TextAnalysis {
  mode: 'word' | 'sentence'
  normalized: string
  tokens: string[]
}

export function normalizeOcrText(raw: string): string {
  let text = raw.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim()
  // OCR 偶尔把半角数字/字母识别成全角，先统一回半角，避免版本号和路径被拆散。
  text = text.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  )
  // 等宽字体的斜杠零常被 OCR 读成 ø，只在数字或版本号上下文中修正。
  text = text
    .replace(/(?<=\d)[øØ]|[øØ](?=\d)/g, '0')
    .replace(/(?<![A-Za-z])[øØ](?=\.\d)/g, '0')
  // Windows OCR 会在中文字符之间插入空格
  text = text.replace(/(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '')
  text = text.replace(/[ \t]+([，。！？；：、,.!?;:])/g, '$1')
  text = text.replace(/([，。！？；：、])[ \t]+/g, '$1')
  text = text
    .split('\n')
    .map(normalizeCodeLikeLine)
    .join('\n')
  // 这些是 OCR 把左右结构字拆成偏旁的结果，不是正常词语，做保守纠正。
  text = text.replace(/亻牛/g, '件').replace(/彳圣/g, '径')
  // OCR 偶尔把“大小：”和数值拆成两行，并在数值前加一个项目符号。
  text = text.replace(/(大小|尺寸)[，,]\s*\n\s*[·•]\s*(?=\d)/g, '$1：')
  text = text.replace(/(\d)(秒|字节|分钟|小时|次|个)/g, '$1 $2')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 背景：路径、URL、IP、提交号和分支名里一旦混入空格或全角标点，整段就不可用。
 * 设计意图：只在整行看起来像代码/路径时做保守替换，普通中文句子不受影响。
 * 关键约束：不做形近字替换，避免把正确中文改坏。
 */
function normalizeCodeLikeLine(line: string): string {
  const label = line.trim()
  if (/^G\s*(?:l|i)t$/i.test(label)) return 'Git'
  if (/^SHA\s*256$/i.test(label)) return 'SHA256'

  const candidate = line
    .replace(/：/g, ':')
    .replace(/／/g, '/')
    .replace(/＼/g, '\\')
    .replace(/．/g, '.')
    .replace(/－/g, '-')
    .replace(/＿/g, '_')
  const compacted = candidate.replace(/\s*([\\/:._-])\s*/g, '$1')
  const ipCandidate = compacted.replace(/[，,]/g, '.')
  if (/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/.test(ipCandidate)) {
    return ipCandidate
  }
  const versionLike = /(版本|version)/i.test(candidate)
  const numericLike = /(大小|字节|size|bytes)/i.test(candidate)
  const hashLike = /(提交号|commit|hash)/i.test(candidate)
  const codeLike =
    /[A-Za-z]:\\|https?:\/\/|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b\d+\.\d+\.\d+\b|\b[0-9a-f]{7,40}\b|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+/.test(
      compacted
    )
  if (!codeLike && !versionLike && !numericLike && !hashLike) return line

  let result = compacted.replace(/(\d)[，,．.](?=\d)/g, '$1.')
  if (numericLike) {
    result = result.replace(/\b[0-9OlIS]{4,}\b/g, (token) =>
      token.replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5')
    )
  }
  if (/(提交号|commit|hash)/i.test(result)) {
    result = result.replace(
      /\b([0-9a-fA-F]{4,})\s+([0-9a-fA-F]{1,8})\b/g,
      (match, left: string, right: string) => {
        const joined = left + right
        return joined.length >= 7 && joined.length <= 40 ? joined : match
      }
    )
  }
  // 发布包常见的“版本号-日期.exe”，OCR 常把连字符读成点。
  result = result.replace(
    /(\d+\.\d+\.\d+)\.(\d{8})(?=\.(?:exe|msi|zip|dmg|pkg|appimage)$)/i,
    '$1-$2'
  )
  // 路径标签后的冒号被读成点或逗号时恢复，例如“路径.C:\Users...”。
  result = result.replace(/^([^:]{1,16})[.，,](?=[A-Za-z]:\\)/, '$1:')
  result = result.replace(/PixmintSetup(?=\d)/g, 'Pixmint Setup ')
  return result
}

export function isCjkText(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text)
}

export function detectTranslationTarget(
  text: string
): 'zh-CN' | 'en-US' | null {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  if (cjk === 0 && latin === 0) return null
  if (cjk === latin) return null
  // 内容更少的那种语言就是翻译目标
  return cjk > latin ? 'en-US' : 'zh-CN'
}

/**
 * 中英字符数相等或没有明确语言时，按界面语言给一个默认方向。
 * 中文界面默认 CN→EN，英文界面默认 EN→CN；用户仍可在弹框里切换。
 */
export function defaultTranslationTarget(language: Language): 'zh-CN' | 'en-US' {
  return language === 'en-US' ? 'zh-CN' : 'en-US'
}

/**
 * Windows OCR 对小字号非常敏感：菜单文字这类 30–40px 高的选区经常直接返回空。
 * 小图先放大再识别，过大图保持原尺寸，避免不必要的内存和耗时。
 */
export function ocrUpscaleFactor(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1
  }
  // 大选区里也可能只有 14–16px 的小字；不能只按选区高度判断。
  let scale = height < 80 ? 4 : height < 200 ? 3 : 2
  const maxDimension = 8192
  const maxPixels = 16_000_000
  while (
    scale > 1 &&
    (width * scale > maxDimension ||
      height * scale > maxDimension ||
      width * height * scale * scale > maxPixels)
  ) {
    scale -= 1
  }
  return scale
}

export function analyzeText(raw: string): TextAnalysis {
  const text = normalizeOcrText(raw)
  if (!text) return { mode: 'sentence', normalized: '', tokens: [] }
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (isCjkText(oneLine)) {
    const compact = oneLine.replace(/\s/g, '')
    const hasSentenceMark = /[。！？!?；;]/.test(oneLine)
    const hasListMark = /[，,、]/.test(oneLine)
    const isWord = compact.length > 0 && compact.length <= 8 && !hasSentenceMark && !hasListMark
    return { mode: isWord ? 'word' : 'sentence', normalized: compact, tokens: [compact] }
  }
  const tokens = oneLine.split(/\s+/).filter(Boolean)
  const hasSentenceMark = /[.!?;]/.test(oneLine)
  const isWord =
    tokens.length > 0 &&
    tokens.length <= 3 &&
    !hasSentenceMark &&
    tokens.every((token) => /^[A-Za-z][A-Za-z'-]*$/.test(token))
  return {
    mode: isWord ? 'word' : 'sentence',
    normalized: tokens.join(' '),
    tokens
  }
}
