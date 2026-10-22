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
  const recordings = Number(process.env.PIXMINT_SOAK_RECORDINGS ?? 3)
  const seconds = Math.min(590, Math.max(1, Number(process.env.PIXMINT_SOAK_RECORD_SECONDS ?? 10)))
  const mode = process.env.PIXMINT_SOAK_RECORD_MODE === 'gif' ? 'gif' : 'video'
  const maxPrivateMb = Number(process.env.PIXMINT_SOAK_RECORD_MAX_PRIVATE_MB ?? 64)
  const app = await launch(['--smoke-overlay'])
  const failures = []
  const durations = []
  try {
    const initial = await waitForWindow(app, '.overlay-root', 30000)
    await initial.keyboard.press('Escape')
    await waitForInactive(app)
    const before = await memorySnapshot(app)
    for (let index = 0; index < recordings; index += 1) {
      const started = Date.now()
      try {
        await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
        const overlay = await waitForWindow(app, '.overlay-root', 8000)
        await overlay.waitForSelector('.overlay-root', { timeout: 8000 })
        await selectRegion(overlay, 160, 140, 760, 520)
        await overlay
          .locator(mode === 'gif' ? '[title="录制 GIF"]' : '[title="录制视频"]')
          .click()
        await overlay.waitForSelector('.rec-ctrl', { timeout: 5000 })
        await overlay.locator('.rec-start').click()
        const control = await waitForWindow(app, '.rec-control', 20000)
        await control.waitForSelector('.rec-control .cb.stop', { timeout: 20000 })
        await sleep(seconds * 1000)
        await control.locator('.rec-control .cb.stop').click()
        const preview = await waitForWindow(app, '.preview-card', 60000)
        await preview.waitForSelector('.preview-card', { timeout: 8000 })
        const fileName = (await preview.locator('.preview-name').innerText()).trim()
        if (!fileName) throw new Error('recording preview has no file name')
        // 点击关闭会立刻销毁预览窗口，不能等待 Playwright 的默认点击完成信号。
        await preview.locator('.preview-close').evaluate((element) => element.click())
        await sleep(300)
      } catch (error) {
        failures.push({ iteration: index, error: String(error) })
      }
      durations.push(Date.now() - started)
      console.log('RECORDING_SOAK_PROGRESS', index + 1, recordings, mode, seconds)
    }
    const after = await memorySnapshot(app)
    // 媒体管线释放有延迟；空闲 60 秒后再采样一次，区分缓冲与真泄漏。
    await sleep(60_000)
    const afterIdle = await memorySnapshot(app)
    const tabPrivateMb = (snapshot) =>
      snapshot.processes
        .filter((process) => process.type === 'Tab')
        .reduce((sum, process) => sum + (process.privateKb ?? 0), 0) / 1024
    const privateGrowthMb = Math.round((tabPrivateMb(afterIdle) - tabPrivateMb(before)) * 10) / 10
    const artifacts = tempArtifacts()
    writeReport('recording', {
      recordings,
      seconds,
      mode,
      failures,
      privateGrowthMb,
      maxPrivateMb,
      ok: failures.length === 0 && privateGrowthMb <= maxPrivateMb,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      before,
      after,
      afterIdle,
      tempArtifacts: artifacts
    })
    await app.close()
    const leaked = artifacts.filter((artifact) => artifact.size > 1024 * 1024)
    process.exit(
      failures.length === 0 && leaked.length === 0 && privateGrowthMb <= maxPrivateMb ? 0 : 1
    )
  } catch (error) {
    console.error('RECORDING_SOAK_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
