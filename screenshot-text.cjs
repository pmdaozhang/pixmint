const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  const window = await app.firstWindow()
  await window.waitForSelector('.overlay-root', { timeout: 15000 })
  await window.waitForTimeout(700)
  await window.waitForFunction(() => document.visibilityState === 'visible')
  await window.bringToFront()
  const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const x1 = 260
  const y1 = 180
  const x2 = Math.min(viewport.width - 260, 1300)
  const y2 = Math.min(viewport.height - 200, 760)
  await window.mouse.move(x1, y1)
  await window.mouse.down()
  await window.mouse.move(x2, y2, { steps: 8 })
  await window.mouse.up()
  await window.waitForSelector('.tooldock', { timeout: 5000 })
  await window.waitForTimeout(250)
  await window.locator('.tb[title="文字"]').click()
  await window.waitForTimeout(150)
  await window.mouse.click(x1 + 80, y1 + 90)
  await window.waitForSelector('.text-draft', { timeout: 3000 })
  const draft = window.locator('.text-draft')
  await draft.fill('这是一段很长的文字，用来看输入框在截图选区内自动换行。\n第二行：字体选择器在下方工具栏。')
  await window.waitForTimeout(250)
  const out = path.join(PROJECT, 'test-results', 'text-features.png')
  await window.screenshot({ path: out })
  console.log('SCREENSHOT', out)
  await app.close()
})().catch((error) => {
  console.error('SCREENSHOT_FAIL', error)
  process.exit(1)
})
