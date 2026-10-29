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

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  try {
    await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
    const overlay = await waitForWindow(app, '.overlay-root', 15000)
    await overlay.waitForSelector('.overlay-root', { timeout: 8000 })
    await overlay.waitForFunction(() => document.visibilityState === 'visible', undefined, {
      timeout: 10000
    })
    await overlay.bringToFront()
    await overlay.evaluate(() => window.focus())
    await sleep(600)
    await overlay.mouse.move(REGION.x, REGION.y)
    await overlay.mouse.down()
    await overlay.mouse.move(REGION.x + REGION.width, REGION.y + REGION.height, { steps: 6 })
    await overlay.mouse.up()
    await overlay.waitForSelector('.tooldock', { timeout: 8000 })

    const moveButton = overlay.locator('.tb[title="移动选区"]')
    if ((await moveButton.count()) !== 0) throw new Error('move button should be removed')

    const shape = overlay.locator('.tb[title="矩形 / 椭圆"]')
    await shape.click()
    await sleep(200)
    const first = await shape.evaluate((element) => ({
      on: element.classList.contains('on'),
      submenu: document.querySelectorAll('.row2').length
    }))
    if (!first.on || first.submenu === 0) throw new Error('first click should select the tool')

    await shape.click()
    await sleep(200)
    const second = await shape.evaluate((element) => ({
      on: element.classList.contains('on'),
      anyOn: document.querySelectorAll('.row1 .tb.on').length,
      submenu: document.querySelectorAll('.row2').length
    }))
    if (second.on || second.anyOn !== 0 || second.submenu !== 0) {
      throw new Error('second click should deselect and close the submenu')
    }
    console.log('TOOLBAR_TOGGLE', JSON.stringify({ first, second }))
    console.log('TOOLBAR_TOGGLE_OK')
    await overlay.keyboard.press('Escape').catch(() => {})
  } finally {
    await app.close().catch(() => {})
  }
})().catch((error) => {
  console.error('TOOLBAR_TOGGLE_FAIL', error)
  process.exit(1)
})
