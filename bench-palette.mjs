import fs from 'node:fs'
import pkg from 'gifenc'

const { GIFEncoder, quantize, applyPalette } = pkg
const width = 720
const height = 405
const rgba = new Uint8Array(fs.readFileSync('gif-frame-720.raw'))

function sample(source, w, h, step) {
  const sw = Math.max(1, Math.floor(w / step))
  const sh = Math.max(1, Math.floor(h / step))
  const out = new Uint8Array(sw * sh * 4)
  for (let y = 0; y < sh; y += 1) {
    const sy = Math.min(h - 1, y * step)
    for (let x = 0; x < sw; x += 1) {
      const sx = Math.min(w - 1, x * step)
      const si = (sy * w + sx) * 4
      const di = (y * sw + x) * 4
      out[di] = source[si]
      out[di + 1] = source[si + 1]
      out[di + 2] = source[si + 2]
      out[di + 3] = source[si + 3]
    }
  }
  return out
}

for (const step of [1, 2, 3, 4, 6]) {
  const source = step === 1 ? rgba : sample(rgba, width, height, step)
  let started = performance.now()
  const palette = quantize(source, 256, { format: 'rgb565' })
  const quantizeMs = performance.now() - started
  started = performance.now()
  applyPalette(rgba, palette, 'rgb565')
  const applyMs = performance.now() - started
  console.log(
    `step=${step}`,
    'samplePixels',
    source.length / 4,
    'quantize',
    quantizeMs.toFixed(1),
    'apply',
    applyMs.toFixed(1),
    'total',
    (quantizeMs + applyMs).toFixed(1)
  )
}

const palette = quantize(sample(rgba, width, height, 3), 256, { format: 'rgb565' })
const index = applyPalette(rgba, palette, 'rgb565')
const encoder = GIFEncoder({ auto: true })
let started = performance.now()
encoder.writeFrame(index, width, height, { palette, delay: 67, repeat: 0 })
const firstMs = performance.now() - started
started = performance.now()
encoder.writeFrame(index, width, height, { palette, delay: 67, repeat: 0 })
const secondMs = performance.now() - started
encoder.finish()
console.log('writeFrame first', firstMs.toFixed(1), 'second', secondMs.toFixed(1))
