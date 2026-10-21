import { describe, expect, it } from 'vitest'
import {
  analyzeText,
  detectTranslationTarget,
  normalizeOcrText,
  ocrUpscaleFactor
} from '../src/shared/text-analysis'

describe('OCR text analysis', () => {
  it('removes spaces Windows OCR inserts between Chinese characters', () => {
    expect(normalizeOcrText('你 好 世 界 SnapGlass OCR 测 试')).toBe(
      '你好世界 SnapGlass OCR 测试'
    )
  })

  it('keeps spaces between English words', () => {
    expect(normalizeOcrText('Hello   world')).toBe('Hello world')
  })

  it('detects a short Chinese phrase as a word', () => {
    expect(analyzeText('你好世界')).toMatchObject({ mode: 'word', normalized: '你好世界' })
  })

  it('detects a Chinese sentence', () => {
    expect(analyzeText('今天天气很好。')).toMatchObject({ mode: 'sentence' })
  })

  it('detects one to three English words as a word', () => {
    expect(analyzeText('New York')).toMatchObject({ mode: 'word' })
  })

  it('detects an English sentence', () => {
    expect(analyzeText('Hello world, this is a test.')).toMatchObject({ mode: 'sentence' })
  })

  it('translates all-Chinese content to English', () => {
    expect(detectTranslationTarget('你好世界')).toBe('en-US')
  })

  it('translates all-English content to Chinese', () => {
    expect(detectTranslationTarget('Hello world')).toBe('zh-CN')
  })

  it('translates mixed content to the minority language', () => {
    expect(detectTranslationTarget('Hello 你好世界')).toBe('zh-CN')
    expect(detectTranslationTarget('你好世界你好 hello')).toBe('en-US')
  })

  it('upscales small OCR selections', () => {
    expect(ocrUpscaleFactor(135, 35)).toBe(4)
    expect(ocrUpscaleFactor(400, 100)).toBe(2)
    expect(ocrUpscaleFactor(1920, 1080)).toBe(1)
    expect(ocrUpscaleFactor(0, 35)).toBe(1)
  })
})
