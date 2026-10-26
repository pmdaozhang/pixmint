import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decode } from 'fast-png'
import * as ort from 'onnxruntime-node'
import { PaddleOcrService } from 'paddleocr'

const root = fileURLToPath(new URL('..', import.meta.url))
const modelDir = join(root, 'assets', 'ocr')
const fixture = join(root, 'tests', 'fixtures', 'ocr-mixed.png')

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer
}

describe.skipIf(process.platform !== 'win32')('PaddleOCR local backend', () => {
  it('recognizes mixed Chinese, code and path fields', async () => {
    const [detectionModel, recognitionModel, dictionaryText, pngBytes] = await Promise.all([
      readFile(join(modelDir, 'PP-OCRv5_mobile_det_infer.onnx')),
      readFile(join(modelDir, 'PP-OCRv5_mobile_rec_infer.onnx')),
      readFile(join(modelDir, 'ppocrv5_dict.txt'), 'utf8'),
      readFile(fixture)
    ])
    const dictionary = dictionaryText.split(/\r?\n/)
    if (dictionary[dictionary.length - 1] !== '') dictionary.push('')
    const service = await PaddleOcrService.createInstance({
      ort: ort as never,
      modelPreset: 'PP-OCRv5_mobile',
      detection: {
        modelBuffer: toArrayBuffer(detectionModel),
        maxSideLimit: 1600
      },
      recognition: {
        modelBuffer: toArrayBuffer(recognitionModel),
        charactersDictionary: dictionary
      }
    })
    try {
      const png = decode(pngBytes)
      if (png.depth !== 8) throw new Error('fixture must be 8-bit PNG')
      const results = await service.recognize({
        width: png.width,
        height: png.height,
        data: png.data as Uint8Array
      })
      const processed = service.processRecognition(results)
      expect(processed.confidence).toBeGreaterThan(0.9)
      expect(processed.text).toContain('9c70fbb')
      expect(processed.text).toContain('feat/stability-foundation')
      expect(processed.text).toContain('127.0.0.1:7892')
      expect(processed.text).toContain('0.3.7')
      expect(processed.text).toContain('Git')
    } finally {
      await service.destroy()
    }
  }, 30000)
})
