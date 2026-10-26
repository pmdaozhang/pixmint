import { app, nativeImage } from 'electron'
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OcrResult } from '../../shared/types'
import { normalizeOcrText, ocrUpscaleFactor } from '../../shared/text-analysis'
import { recognizePaddle } from './paddle'
import { enqueueOcr } from './queue'
import { recognizeWindows } from './windows'

export function recognizeImageDataUrl(dataUrl: string): Promise<OcrResult> {
  return enqueueOcr(() => recognizeImageDataUrlNow(dataUrl))
}

async function recognizeImageDataUrlNow(dataUrl: string): Promise<OcrResult> {
  if (process.platform !== 'win32') {
    throw new Error('P1.0 当前仅接入 Windows 系统 OCR；macOS Vision 后端待实机接入')
  }
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) throw new Error('OCR 输入图像为空')

  if (process.env.OCR_BACKEND !== 'windows') {
    try {
      const paddle = await recognizePaddle(image)
      console.log('OCR_BACKEND paddle')
      return {
        text: normalizeOcrText(paddle.text),
        lines: paddle.lines.map(normalizeOcrText).filter(Boolean)
      }
    } catch (error) {
      console.warn('OCR_PADDLE_FALLBACK', error)
    }
  }

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
    const result = await recognizeWindows(filePath, 'zh-Hans-CN')
    const text = result.lines.length > 0 ? result.lines.join('\n') : result.text
    console.log('OCR_BACKEND windows')
    return {
      text: normalizeOcrText(text),
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
