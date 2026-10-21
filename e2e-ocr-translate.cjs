const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-ocr-translate'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  const window = await app.firstWindow()
  await window.waitForSelector('.ocr-root', { timeout: 15000 })
  await new Promise((resolve) => setTimeout(resolve, 500))
  const bounds = await app.evaluate(({ BrowserWindow }) => {
    const visible = BrowserWindow.getAllWindows().find((item) => item.isVisible())
    return visible ? visible.getBounds() : null
  })
  console.log('TRANSLATE_WINDOW_BOUNDS', bounds)
  if (!bounds || bounds.height > 340) throw new Error('translation window is not compact')

  const original = await window.locator('#ocr-original').inputValue()
  console.log('TRANSLATE_WINDOW_TEXT', original)
  if (!original.includes('你好世界')) throw new Error('translate window text missing')
  const footer = await window.locator('.ocr-compact-footer').count()
  console.log('TRANSLATE_WINDOW_FOOTER', footer)
  if (footer !== 0) throw new Error('translate window should not have footer actions')
  const readOnly = await window.locator('#ocr-original').evaluate((element) => element.readOnly)
  console.log('TRANSLATE_ORIGINAL_READONLY', readOnly)
  if (!readOnly) throw new Error('translate original should be read-only')
  const selectable = await window.evaluate(() => {
    const originalElement = document.querySelector('#ocr-original')
    const resultElement = document.querySelector('.translate-result')
    return {
      original: originalElement ? getComputedStyle(originalElement).userSelect : null,
      result: resultElement ? getComputedStyle(resultElement).userSelect : null
    }
  })
  console.log('TRANSLATE_SELECTABLE', JSON.stringify(selectable))
  if (selectable.original !== 'text' || selectable.result !== 'text') {
    throw new Error('translate text should be selectable')
  }

  await window.evaluate(async () => {
    await window.snapglass.settings.update({ translationProvider: 'free' })
    window.dispatchEvent(new Event('focus'))
  })
  await new Promise((resolve) => setTimeout(resolve, 300))
  const hint = await window.locator('.ocr-hint').count()
  console.log('TRANSLATE_WINDOW_FREE_HINT', hint)
  if (hint !== 0) throw new Error('free provider should not show configuration hint')

  await window.locator('.ocr-icon-btn').click()
  await new Promise((resolve) => setTimeout(resolve, 300))
  console.log('TRANSLATE_WINDOW_E2E_OK')
  await app.close()
  process.exit(0)
})().catch((error) => {
  console.error('TRANSLATE_WINDOW_E2E_FAIL', error)
  process.exit(1)
})
