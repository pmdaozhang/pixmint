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
  }, 30000)
})
