const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const USER_DATA = 'C:\\Users\\Administrator\\pixmint-drag-multi-test'

fs.rmSync(USER_DATA, { recursive: true, force: true })
fs.mkdirSync(USER_DATA, { recursive: true })

const centroidScript = () => {
  const canvas = document.querySelector('.anno-canvas')
  if (!canvas) return null
  const ctx = canvas.getContext('2d')
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let sumX = 0
  let sumY = 0
  let count = 0
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3] > 0) {
        sumX += x
        sumY += y
        count += 1
      }
    }
  }
  return count ? { x: sumX / count, y: sumY / count, count } : { x: 0, y: 0, count: 0 }
}

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay'],
    cwd: PROJECT,
    env: { ...process.env, PIXMINT_USER_DATA_DIR: USER_DATA }
  })
  const window = await app.firstWindow()
  await window.waitForSelector('.overlay-root', { timeout: 15000 })
  await window.waitForTimeout(700)
  await window.waitForFunction(() => document.visibilityState === 'visible')
  await window.bringToFront()
  const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const x1 = 120
  const y1 = 100
  const x2 = Math.min(viewport.width - 120, 920)
  const y2 = Math.min(viewport.height - 140, 520)
  await window.mouse.move(x1, y1)
  await window.mouse.down()
  await window.mouse.move(x2, y2, { steps: 8 })
  await window.mouse.up()
  await window.waitForSelector('.tooldock', { timeout: 5000 })
  await window.waitForTimeout(250)
  await window.locator('.tb[title="文字"]').click()
  await window.waitForTimeout(150)

  const mx = x1 + 200
  const my = y1 + 80
  await window.mouse.click(mx, my)
  await window.waitForSelector('.text-draft', { timeout: 3000 })
  await window.locator('.text-draft').fill('第一行文字\n第二行文字')
  await window.locator('.text-draft').press('Control+Enter')
  await window.waitForTimeout(200)

  const before = await window.evaluate(centroidScript)
  const border = await window.locator('.anno-canvas').evaluate((el) => getComputedStyle(el).cursor)
  await window.mouse.move(mx, my)
  await window.waitForTimeout(40)
  const borderCursor = await window.locator('.anno-canvas').evaluate((el) => getComputedStyle(el).cursor)
  await window.mouse.move(mx + 20, my + 9)
  await window.waitForTimeout(40)
  const innerCursor = await window.locator('.anno-canvas').evaluate((el) => getComputedStyle(el).cursor)
  console.log('MULTI before', JSON.stringify(before), 'initialCursor', border)
  console.log('MULTI borderCursor', borderCursor, 'innerCursor', innerCursor)

  await window.mouse.move(mx, my)
  await window.mouse.down()
  await window.mouse.move(mx + 40, my + 30, { steps: 8 })
  await window.mouse.up()
  await window.waitForTimeout(200)
  const after = await window.evaluate(centroidScript)
  const dx = after.x - before.x
  const dy = after.y - before.y
  console.log('MULTI after', JSON.stringify(after), 'delta', dx.toFixed(1), dy.toFixed(1))
  const ok =
    borderCursor === 'move' &&
    innerCursor === 'text' &&
    Math.abs(dx - 40) < 4 &&
    Math.abs(dy - 30) < 4
  console.log('MULTI_OK', ok)
  console.log(ok ? 'DRAG_MULTI_E2E_OK' : 'DRAG_MULTI_E2E_FAIL')
  await app.close()
  fs.rmSync(USER_DATA, { recursive: true, force: true })
})().catch((error) => {
  console.error('DRAG_MULTI_E2E_ERROR', error)
  process.exit(1)
})
