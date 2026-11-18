const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const USER_DATA = 'C:\\Users\\Administrator\\pixmint-cursor-test'
fs.rmSync(USER_DATA, { recursive: true, force: true })
fs.mkdirSync(USER_DATA, { recursive: true })

async function cursor(window) {
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

  // 矩形工具画一个矩形
  await window.locator('.tb[title="矩形 / 椭圆"]').click()
  await window.waitForTimeout(120)
  const ax = x1 + 120
  const ay = y1 + 120
  await window.mouse.move(ax, ay)
  await window.mouse.down()
  await window.mouse.move(ax + 180, ay + 90, { steps: 8 })
  await window.mouse.up()
  await window.waitForTimeout(200)

  await window.mouse.move(ax + 90, ay) // 上边中点（边框）
  await window.waitForTimeout(40)
  const border = await cursor(window)
  await window.mouse.move(ax + 90, ay + 45) // 内部
  await window.waitForTimeout(40)
  const inner = await cursor(window)
  console.log('RECT borderCursor', border, 'innerCursor', inner)

  // 拖动中光标
  await window.mouse.move(ax + 90, ay)
  await window.mouse.down()
  await window.mouse.move(ax + 130, ay + 40, { steps: 4 })
  await window.waitForTimeout(40)
  const dragging = await cursor(window)
  await window.mouse.up()
  await window.waitForTimeout(150)
  console.log('RECT draggingCursor', dragging)

  console.log('CURSOR_CHECK_DONE')
  await app.close()
  fs.rmSync(USER_DATA, { recursive: true, force: true })
})().catch((error) => {
  console.error('CURSOR_CHECK_ERROR', error)
  process.exit(1)
})
