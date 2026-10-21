const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-ocr'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  const window = await app.firstWindow()
  await window.waitForSelector('.ocr-root', { timeout: 15000 })

  const original = await window.locator('#ocr-original').inputValue()
  console.log('OCR_TEXT', original)
  if (!original.includes('你好世界')) throw new Error('OCR text missing Chinese fixture')
  await new Promise((resolve) => setTimeout(resolve, 350))
  const windowBounds = await app.evaluate(({ BrowserWindow }) => {
    const visible = BrowserWindow.getAllWindows().find((item) => item.isVisible())
    return visible ? visible.getBounds() : null
  })
  console.log('OCR_WINDOW_BOUNDS', windowBounds)
  if (!windowBounds || windowBounds.height > 280) {
    throw new Error('compact OCR window is too tall')
  }
  const wordCards = await window.locator('.ocr-word').count()
  console.log('OCR_WORD_CARD', wordCards)
  if (wordCards !== 0) throw new Error('OCR mode should not show word card')

  const actionButtons = await window.locator('.ocr-compact-footer button').count()
  console.log('OCR_ACTION_BUTTONS', actionButtons)
  if (actionButtons !== 1) throw new Error('OCR mode should only expose one action button')

  await window.locator('.ocr-copy').click()
  await new Promise((resolve) => setTimeout(resolve, 300))
  const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
  console.log('OCR_CLIPBOARD', clipboard)
  if (!clipboard.includes('你好世界')) throw new Error('copy failed')

  await new Promise((resolve) => setTimeout(resolve, 400))
  const visible = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter((item) => item.isVisible()).length
  )
  console.log('OCR_CLOSED', visible === 0)
  if (visible !== 0) throw new Error('OCR window should close after copy')
  console.log('OCR_E2E_OK')
  await app.close()
  process.exit(0)
})().catch((error) => {
  console.error('OCR_E2E_FAIL', error)
  process.exit(1)
})
