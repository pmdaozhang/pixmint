const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const REGION = { x: 120, y: 140, width: 640, height: 420 }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForWindow(app, selector, timeout = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    for (const window of app.windows()) {
      try {
        if ((await window.locator(selector).count()) > 0) return window
      } catch {
        // closing
      }
    }
    await sleep(200)
  }
  throw new Error(`timeout waiting for ${selector}`)
}

async function showOverlay(app) {
  await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
  const overlay = await waitForWindow(app, '.overlay-root', 15000)
  await overlay.waitForSelector('.overlay-root', { timeout: 8000 })
  await overlay.waitForFunction(() => document.visibilityState === 'visible', undefined, {
    timeout: 10000
  })
  await overlay.bringToFront()
  await overlay.evaluate(() => window.focus())
  await sleep(700)
  return overlay
}

async function measure(overlay) {
  const started = await overlay.evaluate(() => performance.now())
  await overlay.mouse.move(REGION.x, REGION.y)
  await overlay.mouse.down()
  await overlay.mouse.move(REGION.x + REGION.width, REGION.y + REGION.height, { steps: 6 })
  await overlay.mouse.up()
  await overlay.waitForFunction(
    () => getComputedStyle(document.querySelector('.toolbar-position')).opacity === '1',
    undefined,
    { timeout: 5000 }
  )
  const ended = await overlay.evaluate(() => performance.now())
  return Math.round((ended - started) * 10) / 10
}

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  try {
    const firstOverlay = await showOverlay(app)
    const first = await measure(firstOverlay)
    await firstOverlay.keyboard.press('Escape')
    await sleep(800)
    const secondOverlay = await showOverlay(app)
    const second = await measure(secondOverlay)
    console.log('TOOLBAR_LATENCY', JSON.stringify({ first, second }))
    await secondOverlay.keyboard.press('Escape').catch(() => {})
  } finally {
    await app.close().catch(() => {})
  }
})().catch((error) => {
  console.error('TOOLBAR_LATENCY_FAIL', error)
  process.exit(1)
})
