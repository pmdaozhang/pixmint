const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function paintedHeight(overlay, top, bottom) {
  return overlay.evaluate(
    ({ top, bottom }) => {
      const canvas = document.querySelector('.anno-canvas')
      if (!canvas) return 0
      const ctx = canvas.getContext('2d')
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let minY = canvas.height
      let maxY = -1
      for (let y = top; y < bottom; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if (data[(y * canvas.width + x) * 4 + 3] > 0) {
            minY = Math.min(minY, y)
            maxY = Math.max(maxY, y)
          }
        }
      }
      return maxY >= minY ? maxY - minY + 1 : 0
    },
    { top, bottom }
  )
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
    const brush = overlay.locator('.mosaic-brush-range')

    await brush.focus()
    await brush.press('End')
    await sleep(120)
    await overlay.mouse.move(canvas.x + 80, canvas.y + 260)
    await overlay.mouse.down()
    await overlay.mouse.move(canvas.x + 380, canvas.y + 260, { steps: 16 })
    await overlay.mouse.up()
    await sleep(250)
    const large = await paintedHeight(overlay, 200, 320)

    await brush.focus()
    await brush.press('Home')
    await sleep(120)
    await overlay.mouse.move(canvas.x + 80, canvas.y + 400)
    await overlay.mouse.down()
    await overlay.mouse.move(canvas.x + 380, canvas.y + 400, { steps: 16 })
    await overlay.mouse.up()
    await sleep(250)
    const small = await paintedHeight(overlay, 350, 450)
    console.log('BRUSH_HEIGHTS', { large, small })
    if (large <= small + 10) throw new Error('brush size slider did not change stroke width')

    // 调整密度后再按住旧马赛克，不应该进入移动状态。
    await overlay.locator('.mosaic-range').focus()
    await overlay.locator('.mosaic-range').press('End')
    await overlay.mouse.move(canvas.x + 200, canvas.y + 260)
    await overlay.mouse.down()
    await overlay.mouse.move(canvas.x + 280, canvas.y + 320, { steps: 4 })
    await overlay.mouse.up()
    await sleep(200)
    const handles = await overlay.locator('.resize-handle').count()
    console.log('HANDLES_AFTER_DRAG_OLD_MOSAIC', handles)
    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('BRUSH_SIZE_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
