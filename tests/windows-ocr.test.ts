import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { recognizeWindows } from '../src/main/ocr/windows'
import { normalizeOcrText } from '../src/shared/text-analysis'

const fixture = fileURLToPath(new URL('./fixtures/ocr-sample.png', import.meta.url))

describe.skipIf(process.platform !== 'win32')('Windows Media OCR', () => {
  it('recognizes the Chinese fixture', async () => {
    const result = await recognizeWindows(fixture)
    const text = normalizeOcrText(result.text)
    expect(text).toContain('你好世界')
    expect(text).toContain('SnapGlass')
    expect(result.blocks?.length).toBeGreaterThan(0)
    expect(result.blocks?.every((block) => block.width > 0 && block.height > 0)).toBe(true)
  }, 30000)
})
