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
    const result = JSON.parse(resultLine.slice('SOAK_OCR_RESULT '.length))
    const maxP95Ms = Number(process.env.PIXMINT_SOAK_OCR_MAX_P95_MS ?? 3000)
    const maxRssGrowthMb = Number(process.env.PIXMINT_SOAK_OCR_MAX_RSS_MB ?? 128)
    const rssGrowthMb = Math.max(
      0,
      (result.memoryAfter.rss - result.memoryBefore.rss) / 1024 / 1024
    )
    const budgetOk = result.p95Ms <= maxP95Ms && rssGrowthMb <= maxRssGrowthMb
    writeReport('ocr', {
      ...result,
      budgets: { maxP95Ms, maxRssGrowthMb, rssGrowthMb, ok: budgetOk }
    })
    process.exit(result.failures === 0 && exitCode === 0 && budgetOk ? 0 : 1)
  }
  await app.close().catch(() => {})
  process.exit(1)
})()
