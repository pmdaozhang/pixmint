const { launch, writeReport } = require('./lib.cjs')

;(async () => {
  const iterations = Number(process.env.PIXMINT_SOAK_OCR_ITERATIONS ?? 100)
  const app = await launch(['--soak-ocr'], {
    PIXMINT_SOAK_OCR_ITERATIONS: String(iterations)
  })
  const lines = []
  app.process().stdout?.on('data', (chunk) => {
    const text = String(chunk)
    lines.push(text)
    process.stdout.write(text)
  })
  app.process().stderr?.on('data', (chunk) => process.stderr.write(String(chunk)))
  const exitCode = await new Promise((resolve) => {
    app.process().once('exit', (code) => resolve(code ?? 1))
  })
  const resultLine = lines
    .join('')
    .split(/\r?\n/)
    .find((line) => line.startsWith('SOAK_OCR_RESULT '))
  if (resultLine) {
    writeReport('ocr', JSON.parse(resultLine.slice('SOAK_OCR_RESULT '.length)))
  }
  await app.close().catch(() => {})
  process.exit(resultLine && exitCode === 0 ? 0 : 1)
})()
