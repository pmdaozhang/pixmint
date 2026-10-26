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

  it('normalizes common OCR code-token confusions', () => {
    expect(normalizeOcrText('提交号：9c7øfbb')).toBe('提交号:9c70fbb')
    expect(normalizeOcrText('提交号：9c70fb b')).toBe('提交号:9c70fbb')
    expect(normalizeOcrText('版本：ø.3.7')).toBe('版本:0.3.7')
    expect(normalizeOcrText('网络：１２７．０．０．１：7892')).toBe(
      '网络:127.0.0.1:7892'
    )
    expect(normalizeOcrText('网络：127，0 ． 0，1：7892')).toBe('网络:127.0.0.1:7892')
    expect(normalizeOcrText('版本：0，3，7')).toBe('版本:0.3.7')
    expect(normalizeOcrText('大小，· 9S427331 字节')).toBe('大小，· 95427331 字节')
    expect(normalizeOcrText('G it')).toBe('Git')
    expect(normalizeOcrText('校验：SHA256 与源文亻牛一致')).toBe(
      '校验：SHA256 与源文件一致'
    )
    expect(
      normalizeOcrText(
        String.raw`路径:C:\Users\Administrator\Desktop\Pixmint Setup 0.3.7.20261025.exe`
      )
    ).toBe(
      String.raw`路径:C:\Users\Administrator\Desktop\Pixmint Setup 0.3.7-20261025.exe`
    )
    expect(normalizeOcrText(String.raw`路径.C:\Users\Administrator\Desktop\a.exe`)).toBe(
      String.raw`路径:C:\Users\Administrator\Desktop\a.exe`
    )
    expect(
      normalizeOcrText(
        String.raw`路径:C:\Users\Administrator\Desktop\PixmintSetup0.3.7-20261025.exe`
      )
    ).toBe(
      String.raw`路径:C:\Users\Administrator\Desktop\Pixmint Setup 0.3.7-20261025.exe`
    )
    expect(normalizeOcrText('大小，\n· 95427331 字节')).toBe('大小：95427331 字节')
    expect(normalizeOcrText('已完成，电脑将在20秒后关机。95427331字节')).toBe(
      '已完成，电脑将在20 秒后关机。95427331 字节'
    )
  })

  it('removes OCR spaces around path separators but keeps Chinese text', () => {
    expect(
      normalizeOcrText(String.raw`路径：C : \ Users \ Administrator \ Desktop \ a.exe`)
    ).toBe(String.raw`路径:C:\Users\Administrator\Desktop\a.exe`)
    expect(normalizeOcrText('状态：已推送，工作区干净')).toBe('状态：已推送，工作区干净')
  })

  it('keeps OCR line breaks', () => {
    expect(normalizeOcrText('第一行\n第二行')).toBe('第一行\n第二行')
    expect(normalizeOcrText('第一行。\n第二行')).toBe('第一行。\n第二行')
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

  it('returns null when the language is ambiguous', () => {
    expect(detectTranslationTarget('中文ab')).toBeNull()
    expect(detectTranslationTarget('2026-10-26 10:30')).toBeNull()
  })

  it('upscales small OCR selections', () => {
    expect(ocrUpscaleFactor(135, 35)).toBe(4)
    expect(ocrUpscaleFactor(400, 100)).toBe(3)
    expect(ocrUpscaleFactor(800, 420)).toBe(2)
    expect(ocrUpscaleFactor(1920, 1080)).toBe(2)
    expect(ocrUpscaleFactor(3840, 2160)).toBe(1)
    expect(ocrUpscaleFactor(0, 35)).toBe(1)
  })
})
