const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUTPUT = path.join(PROJECT, 'verify-mosaic-visual.png')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function setDensity(overlay, value) {
  const range = overlay.locator('.mosaic-range')
  await range.focus()
  await range.press(value >= 100 ? 'End' : 'Home')
  await sleep(120)
}

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay-ocr'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  try {
    const overlay = await app.firstWindow()
    await overlay.waitForSelector('.overlay-root', { timeout: 15000 })
    await sleep(1600)
    await overlay.mouse.move(600, 200)
    await overlay.mouse.down()
    await overlay.mouse.move(1400, 800, { steps: 8 })
    await overlay.mouse.up()
    await overlay.waitForSelector('.tooldock', { timeout: 8000 })
    await overlay.locator('.tb[title="马赛克"]').click()
    const canvas = await overlay.locator('.anno-canvas').boundingBox()
    if (!canvas) throw new Error('canvas missing')

    await setDensity(overlay, 100)
    await overlay.mouse.move(canvas.x + 60, canvas.y + 300)
    await overlay.mouse.down()
    await overlay.mouse.move(canvas.x + 460, canvas.y + 300, { steps: 24 })
    await overlay.mouse.up()
    await sleep(200)

    await setDensity(overlay, 1)
    await overlay.mouse.move(canvas.x + 60, canvas.y + 360)
    await overlay.mouse.down()
    await overlay.mouse.move(canvas.x + 460, canvas.y + 360, { steps: 24 })
    await overlay.mouse.up()
    await sleep(200)

    await overlay.locator('[title="矩形马赛克"]').click()
    await setDensity(overlay, 100)
    await overlay.mouse.move(canvas.x + 60, canvas.y + 400)
    await overlay.mouse.down()
    await overlay.mouse.move(canvas.x + 240, canvas.y + 520, { steps: 8 })
    await overlay.mouse.up()
    await sleep(200)

    await setDensity(overlay, 1)
    await overlay.mouse.move(canvas.x + 280, canvas.y + 400)
    await overlay.mouse.down()
    await overlay.mouse.move(canvas.x + 460, canvas.y + 520, { steps: 8 })
    await overlay.mouse.up()
    await sleep(300)

    await overlay.locator('[title="笔刷马赛克"]').click()
    await overlay.locator('.mosaic-brush-range').focus()
    await overlay.locator('.mosaic-brush-range').press('End')
    await overlay.mouse.move(canvas.x + 300, canvas.y + 250)
    await sleep(250)
    await overlay.screenshot({ path: OUTPUT })
    console.log('MOSAIC_VISUAL', OUTPUT)
    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('MOSAIC_VISUAL_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
