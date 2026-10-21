const { _electron: electron } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const PROJECT = process.argv[2] || __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT_GIF = path.join(__dirname, 'verify-new.gif')
const OUT_VIDEO = path.join(__dirname, 'verify-fullscreen.mp4')

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

async function selectRegion(overlay, x1, y1, x2, y2) {
  await overlay.mouse.move(x1, y1)
  await overlay.mouse.down()
  await overlay.mouse.move(x2, y2, { steps: 10 })
  await overlay.mouse.up()
  await overlay.waitForSelector('.tooldock', { timeout: 8000 })
}

async function recordAndCopy(app, overlay, mode, dest) {
  const entry = mode === 'gif' ? '[title="录制 GIF"]' : '[title="录制视频"]'
  await overlay.locator(entry).click()
  await overlay.waitForSelector('.rec-ctrl', { timeout: 5000 })
  await overlay.locator('.rec-start').click()
  const control = await waitForWindow(app, '.rec-control', 20000)
  await control.waitForSelector('.rec-control .cb.stop', { timeout: 20000 })
  console.log('CONTROL_VISIBLE', mode, await control.locator('.rec-control.live').isVisible())
  await sleep(1600)
  await control.locator('.rec-control .cb.stop').click()
  const preview = await waitForWindow(app, '.preview-card', 30000)
  await preview.waitForSelector('.preview-card', { timeout: 5000 })
  const info = await preview.evaluate(() => window.snapglass.recorderPreview.ready())
  if (!info || !info.filePath) throw new Error(`${mode} preview info missing`)
  fs.copyFileSync(info.filePath, dest)
  console.log('RECORDED', mode, info.fileName, info.width, info.height, info.durationMs, dest)
  await preview.locator('.preview-close').click()
  await sleep(600)
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
    // 等 runOverlaySmoke 自己的首次显示完成，避免二次 start 把选区重置。
    await sleep(1600)

    await selectRegion(overlay, 140, 120, 740, 500)
    await recordAndCopy(app, overlay, 'gif', OUT_GIF)

    await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
    await sleep(500)
    const viewport = await overlay.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))
    await selectRegion(overlay, 1, 1, viewport.width - 1, viewport.height - 1)
    await recordAndCopy(app, overlay, 'video', OUT_VIDEO)

    console.log('VERIFY_RECORDING_OK')
    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('VERIFY_RECORDING_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
