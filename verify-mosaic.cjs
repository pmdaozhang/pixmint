const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = process.argv[2] || __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForOverlay(app) {
  const started = Date.now()
  while (Date.now() - started < 20000) {
    for (const window of app.windows()) {
      try {
        if ((await window.locator('.overlay-root').count()) > 0) return window
      } catch {
        // window may be closing
      }
    }
    await sleep(200)
  }
  throw new Error('overlay timeout')
}

async function analyzeCanvas(overlay) {
  return overlay.evaluate(() => {
    const canvas = document.querySelector('.anno-canvas')
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    const { width, height } = canvas
    const data = ctx.getImageData(0, 0, width, height).data
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    let painted = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] > 0) {
          painted += 1
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (painted === 0) return { width, height, painted, runs: 0, maxGap: 0 }
    const rowY = Math.floor((minY + maxY) / 2)
    const runs = []
    let runStart = -1
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(rowY * width + x) * 4 + 3]
      if (alpha > 0 && runStart < 0) runStart = x
      if (alpha === 0 && runStart >= 0) {
        runs.push([runStart, x - 1])
        runStart = -1
      }
    }
    if (runStart >= 0) runs.push([runStart, width - 1])
    let maxGap = 0
    for (let i = 1; i < runs.length; i += 1) {
      maxGap = Math.max(maxGap, runs[i][0] - runs[i - 1][1] - 1)
    }
    return {
      width,
      height,
      painted,
      bounds: [minX, minY, maxX, maxY],
      runs: runs.length,
      maxGap,
      firstRuns: runs.slice(0, 8),
      dpr: window.devicePixelRatio
    }
  })
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
    const overlay = await waitForOverlay(app)
    await sleep(1600)
    await overlay.mouse.move(140, 120)
    await overlay.mouse.down()
    await overlay.mouse.move(740, 500, { steps: 8 })
    await overlay.mouse.up()
    await overlay.waitForSelector('.tooldock', { timeout: 8000 })
    await overlay.locator('.tb[title="马赛克"]').click()
    await overlay.waitForTimeout(200)

    const canvasBox = await overlay.locator('.anno-canvas').boundingBox()
    if (!canvasBox) throw new Error('canvas missing')
    const y = canvasBox.y + canvasBox.height / 2
    await overlay.mouse.move(canvasBox.x + 80, y)
    await overlay.mouse.down()
    await overlay.mouse.move(canvasBox.x + 420, y, { steps: 20 })
    await overlay.mouse.up()
    await overlay.waitForTimeout(250)
    console.log('MOSAIC_BRUSH_DEFAULT', JSON.stringify(await analyzeCanvas(overlay)))

    await overlay.locator('.mosaic-range').evaluate((element) => {
      element.value = '4'
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await overlay.waitForTimeout(150)
    await overlay.mouse.move(canvasBox.x + 80, y + 80)
    await overlay.mouse.down()
    await overlay.mouse.move(canvasBox.x + 420, y + 80, { steps: 20 })
    await overlay.mouse.up()
    await overlay.waitForTimeout(250)
    console.log('MOSAIC_BRUSH_SIZE4', JSON.stringify(await analyzeCanvas(overlay)))

    await overlay.locator('.mosaic-range').evaluate((element) => {
      element.value = '24'
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await overlay.waitForTimeout(150)
    await overlay.locator('[title="矩形马赛克"]').click()
    await overlay.mouse.move(canvasBox.x + 80, canvasBox.y + 40)
    await overlay.mouse.down()
    await overlay.mouse.move(canvasBox.x + 420, canvasBox.y + 160, { steps: 10 })
    await overlay.mouse.up()
    await overlay.waitForTimeout(300)
    console.log('MOSAIC_RECT_SIZE24', JSON.stringify(await analyzeCanvas(overlay)))

    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('MOSAIC_VERIFY_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
