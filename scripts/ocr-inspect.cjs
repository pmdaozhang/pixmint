// 只读诊断：对指定 PNG 跑 PaddleOCR，打印行/块与包围盒，用于排查钉图文字层漏选。
const fs = require('node:fs')
const path = require('node:path')
const { decode } = require('fast-png')
const ort = require('onnxruntime-node')
const { PaddleOcrService } = require('paddleocr')

// 与 src/shared/ocr-layout.ts 的 lineBlockFromParts 等价（脚本不编译 TS）。
function lineBlockFromParts(parts, text) {
  const valid = parts.filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.width > 0 && p.height > 0
  )
  if (valid.length === 0) return null
  const lineText = String(text ?? valid.map((p) => p.text).join(' ')).trim()
  if (!lineText) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const part of valid) {
    left = Math.min(left, part.x)
    top = Math.min(top, part.y)
    right = Math.max(right, part.x + part.width)
    bottom = Math.max(bottom, part.y + part.height)
  }
  return { text: lineText, x: left, y: top, width: right - left, height: bottom - top }
}

const IMAGE = process.argv[2]
if (!IMAGE) {
  console.error('usage: node scripts/ocr-inspect.cjs <image.png>')
  process.exit(1)
}

const OCR_DIR = path.join(__dirname, '..', 'assets', 'ocr')

async function main() {
  const png = await decode(fs.readFileSync(IMAGE))
  console.log('IMAGE', path.basename(IMAGE), png.width + 'x' + png.height)
  const dict = fs
    .readFileSync(path.join(OCR_DIR, 'ppocrv5_dict.txt'), 'utf8')
    .split(/\r?\n/)
  if (dict[dict.length - 1] !== '') dict.push('')
  const service = await PaddleOcrService.createInstance({
    ort: ort,
    modelPreset: 'PP-OCRv5_mobile',
    detection: {
      modelBuffer: fs.readFileSync(path.join(OCR_DIR, 'PP-OCRv5_mobile_det_infer.onnx')),
      maxSideLimit: 1600
    },
    recognition: {
      modelBuffer: fs.readFileSync(path.join(OCR_DIR, 'PP-OCRv5_mobile_rec_infer.onnx')),
      charactersDictionary: dict
    }
  })
  const started = Date.now()
  const results = await service.recognize({
    width: png.width,
    height: png.height,
    data: png.data
  })
  const processed = service.processRecognition(results)
  console.log('MS', Date.now() - started, 'confidence', processed.confidence.toFixed(4))
  console.log('LINES', processed.lines.length)
  processed.lines.forEach((line, index) => {
    const text = line.map((item) => item.text).join(' ').trim()
    const block = lineBlockFromParts(
      line.map((item) => ({
        text: item.text,
        x: item.box.x,
        y: item.box.y,
        width: item.box.width,
        height: item.box.height
      })),
      text
    )
    console.log(
      `L${String(index).padStart(2, '0')} y=${block ? block.y.toFixed(0) : '-'} h=${block ? block.height.toFixed(0) : '-'} parts=${line.length} | ${text}`
    )
  })
  await service.destroy()
}

main().catch((error) => {
  console.error('OCR_INSPECT_ERROR', error)
  process.exit(1)
})
