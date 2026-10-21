import { app, nativeImage } from 'electron'
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OcrResult } from '../../shared/types'
import { normalizeOcrText, ocrUpscaleFactor } from '../../shared/text-analysis'
import { recognizeWindows } from './windows'

export async function recognizeImageDataUrl(dataUrl: string): Promise<OcrResult> {
  if (process.platform !== 'win32') {
    throw new Error('P1.0 当前仅接入 Windows 系统 OCR；macOS Vision 后端待实机接入')
  }
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) throw new Error('OCR 输入图像为空')
  const size = image.getSize()
  const factor = ocrUpscaleFactor(size.width, size.height)
  const input =
    factor > 1
      ? image.resize({
          width: Math.round(size.width * factor),
          height: Math.round(size.height * factor),
          quality: 'best'
        })
      : image
  if (factor > 1) {
    console.log('OCR_UPSCALE', size.width, size.height, '->', factor + 'x')
  }
  const filePath = join(app.getPath('temp'), `snapglass-ocr-${Date.now()}.png`)
  writeFileSync(filePath, input.toPNG())
  try {
    const result = await recognizeWindows(filePath)
    return {
      text: normalizeOcrText(result.text),
      lines: result.lines.map(normalizeOcrText).filter(Boolean)
    }
  } finally {
    try {
      unlinkSync(filePath)
    } catch {
      // 临时文件清理失败不影响识别结果
    }
  }
}
