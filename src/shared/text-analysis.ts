export interface TextAnalysis {
  mode: 'word' | 'sentence'
  normalized: string
  tokens: string[]
}

export function normalizeOcrText(raw: string): string {
  let text = raw.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim()
  // Windows OCR 会在中文字符之间插入空格
  text = text.replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '')
  text = text.replace(/\s+([，。！？；：、,.!?;:])/g, '$1')
  text = text.replace(/([，。！？；：、])\s+/g, '$1')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

export function isCjkText(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text)
}

export function detectTranslationTarget(
  text: string,
  fallback: 'zh-CN' | 'en-US' = 'zh-CN'
): 'zh-CN' | 'en-US' {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  if (cjk === 0 && latin === 0) return fallback
  if (cjk === latin) return fallback
  // 内容更少的那种语言就是翻译目标
  return cjk > latin ? 'en-US' : 'zh-CN'
}

/**
 * Windows OCR 对小字号非常敏感：菜单文字这类 30–40px 高的选区经常直接返回空。
 * 小图先放大再识别，过大图保持原尺寸，避免不必要的内存和耗时。
 */
export function ocrUpscaleFactor(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1
  }
  let scale = height < 80 ? 4 : height < 160 ? 2 : 1
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
