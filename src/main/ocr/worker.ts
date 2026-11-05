import type { OcrResult } from '../../shared/types'
import { recognizePaddleRgba } from './paddle'

/**
 * 背景：OCR 原先跑在 Electron 主进程里，ONNX 推理会占住主进程事件循环，
 * 原生层崩溃还会带走整个应用。
 * 设计意图：用 utilityProcess 承载推理，主进程只负责解码/缩放/转发。
 * 关键约束：子进程不依赖 Electron 的 app 或 nativeImage；模型目录由主进程下发。
 */

interface WorkerRequest {
  id: number
  width: number
  height: number
  rgba: Uint8Array
  modelsDir: string
}

interface RawOcrResult {
  text: string
  lines: string[]
  blocks?: OcrResult['blocks']
}

interface UtilityParentPort {
  on(event: 'message', listener: (message: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as unknown as { parentPort?: UtilityParentPort }).parentPort

if (parentPort) {
  parentPort.on('message', (message) => {
    void handleRequest(message.data as WorkerRequest)
  })
}

async function handleRequest(request: WorkerRequest): Promise<void> {
  const outcome = await recognize(request)
  parentPort?.postMessage({ id: request.id, ok: true, ...outcome })
}

/**
 * 背景：Paddle 失败时原实现会由子进程调用 Windows OCR，因此主进程每次都要额外编码一份 PNG。
 * 设计意图：子进程只跑 Paddle，失败时回一个 fallback 信号，由主进程用内存中的原图走 Windows OCR。
 * 关键约束：成功路径不再产生 PNG 编码与拷贝；失败路径的额外成本只影响兜底场景。
 */
async function recognize(
  request: WorkerRequest
): Promise<{ result: RawOcrResult } | { fallback: 'windows' }> {
  try {
    const paddle = await recognizePaddleRgba(
      request.width,
      request.height,
      request.rgba,
      request.modelsDir
    )
    if (paddle.text.trim() || paddle.lines.length > 0) {
      console.log('OCR_BACKEND paddle')
      return { result: { text: paddle.text, lines: paddle.lines, blocks: paddle.blocks } }
    }
    // 背景：单行窄条（如 303×20）检测不到文本框时，Paddle 会返回空结果而不是抛错。
    // 设计意图：空结果也进入 Windows OCR 兜底，避免直接告诉用户“未识别到文字”。
    console.warn('OCR_PADDLE_EMPTY_FALLBACK', request.width, request.height)
  } catch (error) {
    console.warn('OCR_PADDLE_FALLBACK', error)
  }
  return { fallback: 'windows' }
}
