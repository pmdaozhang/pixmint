import fs from 'node:fs'
import pkg from 'gifenc'

const { quantize, applyPalette } = pkg

function bench(file, width, height) {
  const data = new Uint8Array(fs.readFileSync(file))
  let started = performance.now()
  const palette = quantize(data, 256, { format: 'rgb565' })
  const quantizeMs = performance.now() - started
  started = performance.now()
  applyPalette(data, palette, 'rgb565')
  const applyMs = performance.now() - started
  console.log(
    file,
    `${width}x${height}`,
    'quantize',
    quantizeMs.toFixed(1),
    'apply',
    applyMs.toFixed(1),
    'total',
    (quantizeMs + applyMs).toFixed(1)
  )
}

bench('gif-frame-1919.raw', 1919, 1079)
bench('gif-frame-960.raw', 960, 540)
bench('gif-frame-720.raw', 720, 405)
