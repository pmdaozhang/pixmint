const { _electron: electron } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const PROJECT = process.argv[2] || __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT_GIF = path.join(__dirname, 'verify-large-timing.gif')
const RECORD_MS = 3000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForWindow(app, selector, timeout = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    for (const window of app.windows()) {
      try {
        if ((await window.locator(selector).count()) > 0) return window
      } catch {
        // window may be closing
      }
    }
    await sleep(200)
  }
  throw new Error(`timeout waiting for ${selector}`)
}

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  app.process().stdout?.on('data', (data) => console.log('MAIN', String(data).trim()))
  app.process().stderr?.on('data', (data) => console.log('MAIN_ERR', String(data).trim()))
  try {
    const overlay = await waitForWindow(app, '.overlay-root')
    await overlay.waitForSelector('.overlay-root', { timeout: 8000 })
    await sleep(1600)
    const viewport = await overlay.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))
    await overlay.mouse.move(1, 1)
    await overlay.mouse.down()
    await overlay.mouse.move(viewport.width - 1, viewport.height - 1, { steps: 10 })
    await overlay.mouse.up()
    await overlay.waitForSelector('.tooldock', { timeout: 8000 })
    await overlay.locator('[title="录制 GIF"]').click()
    await overlay.waitForSelector('.rec-ctrl', { timeout: 5000 })
    await overlay.locator('.rec-start').click()

    const control = await waitForWindow(app, '.rec-control', 20000)
    await control.waitForSelector('.rec-control .cb.stop', { timeout: 20000 })
    await sleep(RECORD_MS)
    await control.locator('.rec-control .cb.stop').click()

    const preview = await waitForWindow(app, '.preview-card', 60000)
    await preview.waitForSelector('.preview-card', { timeout: 5000 })
    const info = await preview.evaluate(() => window.snapglass.recorderPreview.ready())
    if (!info || !info.filePath) throw new Error('GIF preview info missing')
    fs.copyFileSync(info.filePath, OUT_GIF)
    console.log(
      'GIF_TIMING_RESULT',
      JSON.stringify({
        fileName: info.fileName,
        width: info.width,
        height: info.height,
        frameCount: info.frameCount,
        recordedMs: info.durationMs,
        file: OUT_GIF
      })
    )
    await preview.locator('.preview-close').click()
    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('GIF_TIMING_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
