const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const USER_DATA = 'C:\\Users\\Administrator\\pixmint-font-picker-test'
fs.rmSync(USER_DATA, { recursive: true, force: true })
fs.mkdirSync(USER_DATA, { recursive: true })

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
  const x1 = 200
  const y1 = 150
  const x2 = Math.min(viewport.width - 200, 1250)
  const y2 = Math.min(viewport.height - 200, 800)
  await window.mouse.move(x1, y1)
  await window.mouse.down()
  await window.mouse.move(x2, y2, { steps: 8 })
  await window.mouse.up()
  await window.waitForSelector('.tooldock', { timeout: 5000 })
  await window.waitForTimeout(250)
  await window.locator('.tb[title="文字"]').click()
  await window.waitForTimeout(150)

  await window.locator('.font-select').click()
  await window.waitForSelector('.font-pop', { timeout: 3000 })
  const items = await window.locator('.font-item').evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent.trim(),
      family: getComputedStyle(node).fontFamily
    }))
  )
  console.log('FONT_ITEMS', items.length)
  for (const item of items) console.log('  ', item.family, '|', item.text)

  const out = path.join(PROJECT, 'test-results', 'font-picker.png')
  await window.screenshot({ path: out })
  console.log('SCREENSHOT', out)

  // 免费态：会员项应带 👑，点击打开购买窗
  const crowns = items.filter((item) => item.text.includes('👑')).length
  console.log('CROWN_COUNT', crowns)
  await window.locator('.font-item').nth(1).click()
  await window.waitForTimeout(1200)
  const windows = app.windows().length
  console.log('PURCHASE_WINDOWS', windows)
  console.log(crowns > 0 && windows > 1 ? 'FONT_PICKER_E2E_OK' : 'FONT_PICKER_E2E_FAIL')

  await app.close()
  fs.rmSync(USER_DATA, { recursive: true, force: true })
})().catch((error) => {
  console.error('FONT_PICKER_E2E_ERROR', error)
  process.exit(1)
})
