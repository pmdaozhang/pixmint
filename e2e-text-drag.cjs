const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const USER_DATA = 'C:\\Users\\Administrator\\pixmint-drag-test'

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

async function centroid(window) {
  return window.evaluate(centroidScript)
}

async function cursorAt(window, x, y) {
  await window.mouse.move(x, y)
  await window.waitForTimeout(30)
  return window.locator('.anno-canvas').evaluate((el) => getComputedStyle(el).cursor)
}

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay'],
    cwd: PROJECT,
    env: { ...process.env, PIXMINT_USER_DATA_DIR: USER_DATA }
  })
  const window = await app.firstWindow()
  window.on('pageerror', (e) => console.log('PAGEERROR', e.message))
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

  // ---- 单行 ----
  const sx = x1 + 100
  const sy = y1 + 80
  await window.mouse.click(sx, sy)
  await window.waitForSelector('.text-draft', { timeout: 3000 })
  await window.locator('.text-draft').fill('测试拖动')
  await window.locator('.text-draft').press('Control+Enter')
  await window.waitForTimeout(200)
  const c1 = await centroid(window)
  const borderCursor = await cursorAt(window, sx, sy)
  const innerCursor = await cursorAt(window, sx + 20, sy + 9)
  console.log('SINGLE centroid', JSON.stringify(c1))
  console.log('SINGLE borderCursor', borderCursor, 'innerCursor', innerCursor)

  await window.mouse.move(sx, sy)
  await window.mouse.down()
  await window.mouse.move(sx + 40, sy + 30, { steps: 8 })
  await window.mouse.up()
  await window.waitForTimeout(200)
  const c2 = await centroid(window)
  console.log('SINGLE afterDrag', JSON.stringify(c2), 'delta', (c2.x - c1.x).toFixed(1), (c2.y - c1.y).toFixed(1))

  // 撤销单行
  await window.locator('.tb[title="撤销 Ctrl+Z"]').click()
  await window.waitForTimeout(150)

  // ---- 多行 ----
  const mx = x1 + 200
  const my = y1 + 80
  await window.mouse.click(mx, my)
  await window.waitForSelector('.text-draft', { timeout: 3000 })
  await window.locator('.text-draft').fill('第一行文字\n第二行文字')
  await window.locator('.text-draft').press('Control+Enter')
  await window.waitForTimeout(200)
  const m1 = await centroid(window)
  const mBorder = await cursorAt(window, mx, my)
  const mInner = await cursorAt(window, mx + 20, my + 9)
  console.log('MULTI centroid', JSON.stringify(m1))
  console.log('MULTI borderCursor', mBorder, 'innerCursor', mInner)

  await window.mouse.move(mx, my)
  await window.mouse.down()
  await window.mouse.move(mx + 40, my + 30, { steps: 8 })
  await window.mouse.up()
  await window.waitForTimeout(200)
  const m2 = await centroid(window)
  console.log('MULTI afterDrag', JSON.stringify(m2), 'delta', (m2.x - m1.x).toFixed(1), (m2.y - m1.y).toFixed(1))

  const singleOk =
    borderCursor === 'move' &&
    innerCursor === 'text' &&
    Math.abs(c2.x - c1.x - 40) < 4 &&
    Math.abs(c2.y - c1.y - 30) < 4
  const multiOk =
    mBorder === 'crosshair' &&
    mInner === 'text' &&
    Math.abs(m2.x - m1.x - 40) < 4 &&
    Math.abs(m2.y - m1.y - 30) < 4
  console.log('SINGLE_OK', singleOk, 'MULTI_OK', multiOk)
  console.log(singleOk && multiOk ? 'DRAG_E2E_OK' : 'DRAG_E2E_FAIL')
  await app.close()
  fs.rmSync(USER_DATA, { recursive: true, force: true })
})().catch((error) => {
  console.error('DRAG_E2E_ERROR', error)
  process.exit(1)
})
