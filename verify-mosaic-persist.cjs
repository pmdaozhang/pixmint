const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function painted(overlay) {
  return overlay.evaluate(() => {
    const canvas = document.querySelector('.anno-canvas')
    if (!canvas) return 0
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1
    return count
  })
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
    await overlay.mouse.move(canvas.x + 100, canvas.y + 260)
    await overlay.mouse.down()
    await overlay.mouse.move(canvas.x + 500, canvas.y + 260, { steps: 20 })
    await overlay.mouse.up()
    await sleep(300)
    const before = await painted(overlay)
    await overlay.locator('.tb[title="矩形 / 椭圆"]').click()
    await sleep(300)
    const after = await painted(overlay)
    console.log('MOSAIC_PERSIST', { before, after })
    if (after < before * 0.9) throw new Error('mosaic disappeared after switching tools')
    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('MOSAIC_PERSIST_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
