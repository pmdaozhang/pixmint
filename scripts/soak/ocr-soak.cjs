const { launch, writeReport } = require('./lib.cjs')

/**
 * OCR 已移入 utilityProcess，只看主进程 RSS 会漏掉子进程增长。
 * 这里优先用全进程工作集总和；旧版本没有 metrics 字段时回退到主进程 RSS。
 */
function totalWorkingSetMb(processes) {
  if (!Array.isArray(processes)) return null
  return processes.reduce((sum, item) => sum + (Number(item.workingSetKb) || 0), 0) / 1024
}

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
    const mainRssGrowthMb = Math.max(
      0,
      (result.memoryAfter.rss - result.memoryBefore.rss) / 1024 / 1024
    )
    const beforeTotalMb = totalWorkingSetMb(result.metricsBefore)
    const seasonedTotalMb = totalWorkingSetMb(result.metricsSeasoned)
    const afterTotalMb = totalWorkingSetMb(result.metricsAfter)
    const totalGrowthMb =
      beforeTotalMb !== null && afterTotalMb !== null
        ? Math.max(0, afterTotalMb - beforeTotalMb)
        : mainRssGrowthMb
    // 预算看稳态：扣掉 ONNX arena 的一次性扩张（seasoning 次之后），
    // 单纯比较"最终 - 预热完成"才能反映是否真的存在泄漏。
    const steadyGrowthMb =
      seasonedTotalMb !== null && afterTotalMb !== null
        ? Math.max(0, afterTotalMb - seasonedTotalMb)
        : totalGrowthMb
    const budgetOk = result.p95Ms <= maxP95Ms && steadyGrowthMb <= maxRssGrowthMb
    writeReport('ocr', {
      ...result,
      budgets: {
        maxP95Ms,
        maxRssGrowthMb,
        mainRssGrowthMb,
        totalGrowthMb,
        steadyGrowthMb,
        beforeTotalMb,
        seasonedTotalMb,
        afterTotalMb,
        ok: budgetOk
      }
    })
    process.exit(result.failures === 0 && exitCode === 0 && budgetOk ? 0 : 1)
  }
  await app.close().catch(() => {})
  process.exit(1)
})()
