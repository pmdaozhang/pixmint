import { GIFEncoder, applyPalette, quantize, type GIFEncoderInstance } from 'gifenc'
import { gifPaletteSampleStep } from '@shared/recording'

type WorkerRequest =
  | { type: 'init'; width: number; height: number; fps: number }
  | { type: 'frame'; data: ArrayBuffer; delay: number }
  | { type: 'finish' }
  | { type: 'reset' }

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'frame'; frameCount: number }
  | { type: 'done'; bytes: ArrayBuffer; frameCount: number }
  | { type: 'error'; message: string }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
}

let encoder: GIFEncoderInstance | null = null
let width = 0
let height = 0
let fps = 15
let frameCount = 0

/**
 * 背景：quantize 需要扫描整帧，是全屏 GIF 最常见的瓶颈。
 * 设计意图：按步长抽取像素生成调色板样本，再把调色板应用到完整帧。
 * 关键约束：只影响调色板统计，不改变最终帧尺寸和逐像素映射。
 */
function sampleRgba(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  step: number
): Uint8Array {
  if (step <= 1) return source
  const sampleWidth = Math.max(1, Math.floor(sourceWidth / step))
  const sampleHeight = Math.max(1, Math.floor(sourceHeight / step))
  const output = new Uint8Array(sampleWidth * sampleHeight * 4)
  for (let y = 0; y < sampleHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, y * step)
    for (let x = 0; x < sampleWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, x * step)
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4
      const targetOffset = (y * sampleWidth + x) * 4
      output[targetOffset] = source[sourceOffset]
      output[targetOffset + 1] = source[sourceOffset + 1]
      output[targetOffset + 2] = source[sourceOffset + 2]
      output[targetOffset + 3] = source[sourceOffset + 3]
    }
  }
  return output
}

function reset(widthValue: number, heightValue: number, fpsValue: number): void {
  width = Math.max(2, Math.round(widthValue))
  height = Math.max(2, Math.round(heightValue))
  fps = Math.max(1, Math.round(fpsValue))
  frameCount = 0
  encoder = GIFEncoder({ auto: true })
}

scope.onmessage = (event): void => {
  try {
    const message = event.data
    if (message.type === 'init') {
      reset(message.width, message.height, message.fps)
      scope.postMessage({ type: 'ready' })
      return
    }

    if (message.type === 'reset') {
      encoder = null
      frameCount = 0
      return
    }

    if (message.type === 'frame') {
      if (!encoder) throw new Error('GIF 编码器尚未初始化')
      const rgba = new Uint8Array(message.data)
      // rgb565 比 rgb444 多保留 4 位颜色信息，明显减少 GIF 的偏色和色带。
      const sample = sampleRgba(rgba, width, height, gifPaletteSampleStep(width, height))
      const palette = quantize(sample, 256, { format: 'rgb565' })
      const index = applyPalette(rgba, palette, 'rgb565')
      encoder.writeFrame(index, width, height, {
        palette,
        delay: Math.max(10, Math.round(message.delay)),
        repeat: 0
      })
      frameCount += 1
      scope.postMessage({ type: 'frame', frameCount })
      return
    }

    if (message.type === 'finish') {
      if (!encoder) throw new Error('GIF 编码器尚未初始化')
      if (frameCount === 0) throw new Error('没有采集到任何帧')
      encoder.finish()
      const bytes = encoder.bytes()
      const output = bytes.slice()
      encoder = null
      scope.postMessage(
        { type: 'done', bytes: output.buffer, frameCount },
        [output.buffer]
      )
    }
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

export {}
