const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const USER_DATA = 'C:\\Users\\Administrator\\pixmint-font-size-test'
fs.rmSync(USER_DATA, { recursive: true, force: true })
fs.mkdirSync(USER_DATA, { recursive: true })

async function fontSize(window) {
  return window.locator('.text-draft').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
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
  const x1 = 160
  const y1 = 120
  const x2 = Math.min(viewport.width - 160, 1100)
  const y2 = Math.min(viewport.height - 180, 760)
  await window.mouse.move(x1, y1)
  await window.mouse.down()
  await window.mouse.move(x2, y2, { steps: 8 })
  await window.mouse.up()
  await window.waitForSelector('.tooldock', { timeout: 5000 })
  await window.waitForTimeout(250)
  await window.locator('.tb[title="文字"]').click()
  await window.waitForTimeout(150)

  // 输入内容前：hover 画布空白，滚轮调字号
  await window.mouse.move(x1 + 350, y1 + 350)
  for (let i = 0; i < 3; i += 1) await window.mouse.wheel(0, -120)
  await window.waitForTimeout(100)
  await window.mouse.click(x1 + 120, y1 + 120)
  await window.waitForSelector('.text-draft', { timeout: 3000 })
  await window.locator('.text-draft').fill('滚轮字号')
  await window.waitForTimeout(100)
  const before = await fontSize(window)
  console.log('EDITOR initialFontSize', before)

  // 编辑态：hover 输入框滚轮
  const box = await window.locator('.text-draft').boundingBox()
  const hx = box.x + box.width / 2
  const hy = box.y + box.height / 2
  await window.mouse.move(hx, hy)
  for (let i = 0; i < 2; i += 1) await window.mouse.wheel(0, -120)
  await window.waitForTimeout(100)
  const up2 = await fontSize(window)
  for (let i = 0; i < 12; i += 1) await window.mouse.wheel(0, 120)
  await window.waitForTimeout(100)
  const min = await fontSize(window)
  for (let i = 0; i < 40; i += 1) await window.mouse.wheel(0, -120)
  await window.waitForTimeout(100)
  const max = await fontSize(window)
  console.log('EDITOR afterWheelUp2', up2, 'minClamp', min, 'maxClamp', max)

  const ok = before === 21 && up2 === 25 && min === 14 && max === 60
  console.log('FONT_SIZE_OK', ok)
  console.log(ok ? 'FONT_SIZE_E2E_OK' : 'FONT_SIZE_E2E_FAIL')
  await app.close()
  fs.rmSync(USER_DATA, { recursive: true, force: true })
})().catch((error) => {
  console.error('FONT_SIZE_E2E_ERROR', error)
  process.exit(1)
})
