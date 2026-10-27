const {
  launch,
  memorySnapshot,
  percentile,
  sleep,
  waitForInactive,
  writeReport
} = require('./lib.cjs')

async function waitForOverlayActive(app, timeout = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await app.evaluate(() => globalThis.__snapglassOverlayActive?.())) return
    await sleep(100)
  }
  throw new Error('overlay did not become active')
}

async function overlayWindow(app) {
  for (const window of app.windows()) {
    try {
      if ((await window.locator('.overlay-root').count()) > 0) return window
    } catch {
      // 窗口可能正在关闭
    }
  }
  return null
}

;(async () => {
  const cycles = Number(process.env.PIXMINT_REAL_OVERLAY_CYCLES ?? 100)
  const sampleEvery = Math.max(1, Number(process.env.PIXMINT_REAL_OVERLAY_SAMPLE ?? 20))
  const app = await launch(['--smoke-overlay'])
  const failures = []
  const durations = []
  const samples = []
  try {
    const first = await app.firstWindow()
    await first.waitForSelector('.overlay-root', { timeout: 30000 })
    // smoke 模式在 1.2 秒后才真正显示假覆盖层，先等它出现再关闭。
    await sleep(1500)
    await first.keyboard.press('Escape')
    await waitForInactive(app)
    const before = await memorySnapshot(app)

    for (let index = 0; index < cycles; index += 1) {
      const started = Date.now()
      try {
        await app.evaluate(() => globalThis.__snapglassStartCapture?.())
        await waitForOverlayActive(app)
        const overlay = await overlayWindow(app)
        if (!overlay) throw new Error('overlay window not found')
        await overlay.keyboard.press('Escape')
        await waitForInactive(app, 10000)
      } catch (error) {
        failures.push({ iteration: index, error: String(error) })
      }
      durations.push(Date.now() - started)
      if ((index + 1) % sampleEvery === 0) {
        samples.push({ cycle: index + 1, ...(await memorySnapshot(app)) })
      }
      if ((index + 1) % 10 === 0) {
        console.log('REAL_OVERLAY_PROGRESS', index + 1, cycles)
      }
    }

    const after = await memorySnapshot(app)
    writeReport('real-overlay', {
      cycles,
      failures,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      before,
      samples,
      after
    })
    await app.close()
    process.exit(failures.length === 0 ? 0 : 1)
  } catch (error) {
    console.error('REAL_OVERLAY_SOAK_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
