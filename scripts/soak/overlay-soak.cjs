const {
  launch,
  memorySnapshot,
  percentile,
  selectRegion,
  sleep,
  tempArtifacts,
  waitForInactive,
  waitForWindow,
  writeReport
} = require('./lib.cjs')

;(async () => {
  const cycles = Number(process.env.PIXMINT_SOAK_OVERLAY_CYCLES ?? 200)
  const app = await launch(['--smoke-overlay'])
  const failures = []
  const durations = []
  try {
    const initial = await waitForWindow(app, '.overlay-root', 30000)
    await initial.keyboard.press('Escape')
    await waitForInactive(app)
    const before = await memorySnapshot(app)
    for (let index = 0; index < cycles; index += 1) {
      const started = Date.now()
      try {
        await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
        const overlay = await waitForWindow(app, '.overlay-root', 8000)
        await overlay.waitForSelector('.overlay-root', { timeout: 8000 })
        await selectRegion(overlay, 120, 100, 620, 420)
        await overlay.keyboard.press('Escape')
        await waitForInactive(app)
      } catch (error) {
        failures.push({ iteration: index, error: String(error) })
      }
      durations.push(Date.now() - started)
      if ((index + 1) % 10 === 0) {
        console.log('OVERLAY_SOAK_PROGRESS', index + 1, cycles)
      }
      await sleep(50)
    }
    const after = await memorySnapshot(app)
    const artifacts = tempArtifacts()
    writeReport('overlay', {
      cycles,
      failures,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      maxMs: durations.length ? Math.max(...durations) : 0,
      before,
      after,
      tempArtifacts: artifacts
    })
    await app.close()
    process.exit(failures.length === 0 ? 0 : 1)
  } catch (error) {
    console.error('OVERLAY_SOAK_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
