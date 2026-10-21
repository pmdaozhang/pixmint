declare module 'gifenc' {
  export type GifFormat = 'rgb565' | 'rgb444' | 'rgba4444'

  export interface GIFEncoderOptions {
    initialCapacity?: number
    auto?: boolean
  }

  export interface WriteFrameOptions {
    palette?: number[][]
    delay?: number
    repeat?: number
    first?: boolean
    transparent?: boolean
    transparentIndex?: number
    colorDepth?: number
    dispose?: number
  }

  export interface GIFEncoderInstance {
    reset(): void
    finish(): Uint8Array
    bytes(): Uint8Array
    bytesView(): Uint8Array
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: WriteFrameOptions
    ): void
  }

  export interface QuantizeOptions {
    format?: GifFormat
    clearAlpha?: boolean
    clearAlphaColor?: number
    clearAlphaThreshold?: number
    oneBitAlpha?: boolean | number
    useSqrt?: boolean
  }

  export function GIFEncoder(options?: GIFEncoderOptions): GIFEncoderInstance
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions
  ): number[][]
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: GifFormat
  ): Uint8Array
}
