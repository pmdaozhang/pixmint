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
  await window.evaluate(async () => {
    await window.snapglass.settings.update({ translationProvider: 'free' })
    window.dispatchEvent(new Event('focus'))
  })
  await window.locator('#ocr-original').fill('Hello world')
  await window.locator('.ocr-compact-footer .secondary').click()
  await new Promise((resolve) => setTimeout(resolve, 6000))
  const result = await window.locator('.translate-result').textContent()
  const error = await window.locator('.ocr-error').textContent().catch(() => '')
  console.log('LIVE_TRANSLATION_RESULT', result)
  console.log('LIVE_TRANSLATION_ERROR', error)
  await app.close()
  process.exit(0)
})().catch((error) => {
  console.error('LIVE_TRANSLATION_E2E_FAIL', error)
  process.exit(1)
})
