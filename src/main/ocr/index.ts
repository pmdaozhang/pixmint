import { app, nativeImage } from 'electron'
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scaleOcrBlocks } from '../../shared/ocr-layout'
import { bgraToRgbaInPlace } from '../../shared/pixel-format'
import { normalizeOcrText, ocrUpscaleFactor } from '../../shared/text-analysis'
import type { OcrResult } from '../../shared/types'
import { modelDir, recognizePaddle } from './paddle'
import { enqueueOcr } from './queue'
import { ocrWorker } from './remote'
import { recognizeWindows } from './windows'

export function recognizeImageDataUrl(dataUrl: string): Promise<OcrResult> {
  return enqueueOcr(() => recognizeImageDataUrlNow(dataUrl))
}

/**
 * 背景：ONNX 推理长期占用主进程事件循环，且原生层崩溃会带走整个应用。
 * 设计意图：默认把识别交给 utilityProcess；子进程启动失败或超时时回退到进程内实现，
 *          保证 OCR 功能不会因为"隔离改造"本身而不可用。
 * 关键约束：解码与缩放仍在主进程完成，子进程只接收 RGBA/PNG 与模型目录。
 */
async function recognizeImageDataUrlNow(dataUrl: string): Promise<OcrResult> {
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

  const backend = process.env.OCR_BACKEND === 'windows' ? 'windows' : 'auto'

  if (process.env.PIXMINT_OCR_INPROCESS !== '1' && backend !== 'windows') {
    try {
      const inputSize = input.getSize()
      const outcome = await ocrWorker.recognize({
        width: inputSize.width,
        height: inputSize.height,
        rgba: bgraToRgbaInPlace(input.toBitmap()),
        modelsDir: modelDir()
      })
      if (outcome.kind === 'result') return normalizeResult(outcome.result, factor)
      // 子进程判定 Paddle 无结果：直接用内存中的原图走 Windows OCR，避免额外的 PNG 往返。
      return recognizeWindowsInProcess(input, factor)
    } catch (error) {
      // 子进程不可用不应让用户失去 OCR：记录后走进程内路径。
      console.warn('OCR_WORKER_FALLBACK', error)
    }
  }

  return recognizeInProcess(input, factor, backend)
}

async function recognizeInProcess(
  input: Electron.NativeImage,
  factor: number,
  backend: 'auto' | 'windows'
): Promise<OcrResult> {
  const size = input.getSize()

  if (backend !== 'windows') {
    try {
      const paddle = await recognizePaddle(input)
      if (paddle.text.trim() || paddle.lines.length > 0) {
        console.log('OCR_BACKEND paddle')
        return normalizeResult(paddle, factor)
      }
      // 背景：单行窄条（如 303×20）检测不到文本框时，Paddle 会返回空结果而不是抛错。
      // 设计意图：空结果也进入 Windows OCR 兜底，避免直接告诉用户“未识别到文字”。
      console.warn('OCR_PADDLE_EMPTY_FALLBACK', size.width, size.height)
    } catch (error) {
      console.warn('OCR_PADDLE_FALLBACK', error)
    }
  }

  return recognizeWindowsInProcess(input, factor)
}

async function recognizeWindowsInProcess(
  input: Electron.NativeImage,
  factor: number
): Promise<OcrResult> {
  const filePath = join(app.getPath('temp'), `snapglass-ocr-${Date.now()}.png`)
  writeFileSync(filePath, input.toPNG())
  try {
    const result = await recognizeWindows(filePath, 'zh-Hans-CN')
    const text = result.lines.length > 0 ? result.lines.join('\n') : result.text
    console.log('OCR_BACKEND windows')
    return normalizeResult({ text, lines: result.lines, blocks: result.blocks }, factor)
  } finally {
    try {
      unlinkSync(filePath)
    } catch {
      // 临时文件清理失败不影响识别结果
    }
  }
}

function normalizeResult(result: OcrResult, factor: number): OcrResult {
  return {
    text: normalizeOcrText(result.text),
    lines: result.lines.map(normalizeOcrText).filter(Boolean),
    blocks: normalizeBlocks(result.blocks, factor)
  }
}

function normalizeBlocks(blocks: OcrResult['blocks'], factor: number): OcrResult['blocks'] {
  return scaleOcrBlocks(blocks, factor)
    .map((block) => ({ ...block, text: normalizeOcrText(block.text) }))
    .filter((block) => block.text.length > 0)
}
