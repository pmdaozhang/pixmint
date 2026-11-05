import { app } from 'electron'
import type { NativeImage } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as ort from 'onnxruntime-node'
import { PaddleOcrService } from 'paddleocr'
import { lineBlockFromParts } from '../../shared/ocr-layout'
import { bgraToRgbaInPlace } from '../../shared/pixel-format'
import { normalizeOcrText } from '../../shared/text-analysis'
import type { OcrResult, OcrTextBlock } from '../../shared/types'

const DET_MODEL = 'PP-OCRv5_mobile_det_infer.onnx'
const REC_MODEL = 'PP-OCRv5_mobile_rec_infer.onnx'
const DICT_FILE = 'ppocrv5_dict.txt'

let servicePromise: { dir: string; promise: Promise<PaddleOcrService> } | null = null

/**
 * 背景：Windows OCR 对 14–16px 中英混排、代码字段和小数点不稳定。
 * 设计意图：用 PP-OCRv5 mobile + ONNX Runtime 本地推理作为主后端，Windows OCR 只做兜底。
 * 关键约束：模型和原生 ONNX 运行时都随包分发，不联网；服务和模型只加载一次。
 */
export async function recognizePaddle(image: NativeImage): Promise<OcrResult> {
  const size = image.getSize()
  const rgba = bgraToRgbaInPlace(image.toBitmap())
  return recognizePaddleRgba(size.width, size.height, rgba, modelDir())
}

/**
 * 背景：OCR 移到 utilityProcess 后，子进程拿不到 Electron 的 nativeImage。
 * 设计意图：把"解码 + 缩放"留在主进程，子进程只接收 RGBA 与模型目录。
 * 关键约束：rgba 必须已是 RGBA 顺序；模型目录由调用方显式传入，避免子进程依赖 app。
 */
export async function recognizePaddleRgba(
  width: number,
  height: number,
  rgba: Uint8Array,
  modelsDir: string
): Promise<OcrResult> {
  const service = await getService(modelsDir)
  const started = Date.now()
  const results = await service.recognize({ width, height, data: rgba })
  const processed = service.processRecognition(results)
  const lines = processed.lines
    .map((line) => line.map((item) => item.text).join(' ').trim())
    .filter(Boolean)
  const text = lines.length > 0 ? lines.join('\n') : processed.text
  const blocks = processed.lines
    .map((line) =>
      lineBlockFromParts(
        line.map((item) => ({
          text: item.text,
          x: item.box.x,
          y: item.box.y,
          width: item.box.width,
          height: item.box.height
        })),
        normalizeOcrText(line.map((item) => item.text).join(' '))
      )
    )
    .filter((block): block is OcrTextBlock => block !== null)
  console.log(
    'OCR_PADDLE',
    'ms=' + (Date.now() - started),
    'confidence=' + processed.confidence.toFixed(4),
    'lines=' + lines.length,
    'blocks=' + blocks.length
  )
  return { text, lines, blocks }
}

export async function disposePaddle(): Promise<void> {
  const pending = servicePromise
  servicePromise = null
  if (!pending) return
  try {
    const service = await pending.promise
    await service.destroy()
  } catch {
    // 关闭阶段不再抛错
  }
}

export function modelDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'ocr')
    : join(app.getAppPath(), 'assets', 'ocr')
}

function getService(dir: string): Promise<PaddleOcrService> {
  if (servicePromise?.dir === dir) return servicePromise.promise
  const promise = createService(dir).catch((error) => {
    if (servicePromise?.promise === promise) servicePromise = null
    throw error
  })
  servicePromise = { dir, promise }
  return promise
}

async function createService(dir: string): Promise<PaddleOcrService> {
  const started = Date.now()
  const [detectionModel, recognitionModel, dictionaryText] = await Promise.all([
    readFile(join(dir, DET_MODEL)),
    readFile(join(dir, REC_MODEL)),
    readFile(join(dir, DICT_FILE), 'utf8')
  ])
  const dictionary = dictionaryText.split(/\r?\n/)
  // PP-OCRv5 mobile 的输出类别比字典多一个 CTC blank；保留末尾空项即可对齐索引。
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
  console.log('OCR_PADDLE_INIT', 'ms=' + (Date.now() - started), dir)
  return service
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer
}
