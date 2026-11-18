const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const USER_DATA = 'C:\\Users\\Administrator\\pixmint-editor-drag-test'
fs.rmSync(USER_DATA, { recursive: true, force: true })
fs.mkdirSync(USER_DATA, { recursive: true })

async function cursorOf(window, selector) {
  return window.locator(selector).evaluate((el) => getComputedStyle(el).cursor)
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
  await window.mouse.click(x1 + 120, y1 + 120)
  await window.waitForSelector('.text-draft', { timeout: 3000 })
  const draft = window.locator('.text-draft')
  await draft.fill('编辑拖动测试')
  await window.waitForTimeout(150)

  const boxBefore = await draft.boundingBox()
  const midX = boxBefore.x + boxBefore.width / 2
  await window.mouse.move(midX, boxBefore.y + 2)
  await window.waitForTimeout(40)
  const borderCursor = await cursorOf(window, '.text-draft')
  await window.mouse.move(midX, boxBefore.y + boxBefore.height / 2)
  await window.waitForTimeout(40)
  const innerCursor = await cursorOf(window, '.text-draft')
  console.log('EDITOR box', JSON.stringify(boxBefore))
  console.log('EDITOR borderCursor', borderCursor, 'innerCursor', innerCursor)

  await window.mouse.move(midX, boxBefore.y + 2)
  await window.mouse.down()
  await window.mouse.move(midX + 40, boxBefore.y + 32, { steps: 8 })
  await window.mouse.up()
  await window.waitForTimeout(150)
  const boxAfter = await draft.boundingBox()
  const value = await draft.inputValue()
  console.log(
    'EDITOR afterDrag',
    JSON.stringify(boxAfter),
    'delta',
    (boxAfter.x - boxBefore.x).toFixed(1),
    (boxAfter.y - boxBefore.y).toFixed(1),
    'value',
    value
  )

  const ok =
    borderCursor === 'move' &&
    innerCursor === 'text' &&
    Math.abs(boxAfter.x - boxBefore.x - 40) < 4 &&
    Math.abs(boxAfter.y - boxBefore.y - 30) < 4 &&
    value === '编辑拖动测试'
  console.log('EDITOR_OK', ok)
  console.log(ok ? 'EDITOR_DRAG_E2E_OK' : 'EDITOR_DRAG_E2E_FAIL')
  await app.close()
  fs.rmSync(USER_DATA, { recursive: true, force: true })
})().catch((error) => {
  console.error('EDITOR_DRAG_E2E_ERROR', error)
  process.exit(1)
})
