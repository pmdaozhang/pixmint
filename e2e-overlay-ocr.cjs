const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay-ocr'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  const overlay = await app.firstWindow()
  await overlay.waitForSelector('.overlay-root', { timeout: 15000 })
  await overlay.mouse.move(400, 300)
  await overlay.mouse.down()
  await overlay.mouse.move(1500, 780, { steps: 8 })
  await overlay.mouse.up()
  await overlay.waitForSelector('.tooldock', { timeout: 5000 })

  const ocrWindowPromise = app.waitForEvent('window', { timeout: 15000 })
  await overlay.locator('.act').filter({ hasText: '识别' }).click()
  const ocrWindow = await ocrWindowPromise
  await ocrWindow.waitForSelector('.ocr-root', { timeout: 10000 })
  const text = await ocrWindow.locator('#ocr-original').inputValue()
  console.log('OVERLAY_OCR_TEXT', text)
  if (!text.includes('你好世界')) throw new Error('overlay OCR did not recognize the fixture')

  // 第二次截图必须先自动关闭上一次 OCR 弹框
  await app.evaluate(() => globalThis.__snapglassShowOverlay())
  await new Promise((resolve) => setTimeout(resolve, 700))
  console.log('FIRST_OCR_CLOSED', ocrWindow.isClosed())
  if (!ocrWindow.isClosed()) throw new Error('previous OCR popup was not closed')
  await overlay.waitForSelector('.overlay-root', { timeout: 5000 })
  await overlay.mouse.move(400, 300)
  await overlay.mouse.down()
  await overlay.mouse.move(1500, 780, { steps: 8 })
  await overlay.mouse.up()
  await overlay.waitForSelector('.tooldock', { timeout: 5000 })

  const secondOcrPromise = app.waitForEvent('window', { timeout: 15000 })
  await overlay.locator('.act').filter({ hasText: '识别' }).click()
  const secondOcr = await secondOcrPromise
  await secondOcr.waitForSelector('.ocr-root', { timeout: 10000 })
  const secondText = await secondOcr.locator('#ocr-original').inputValue()
  console.log('SECOND_OVERLAY_OCR_TEXT', secondText)
  if (!secondText.includes('你好世界')) throw new Error('second OCR failed')
  await secondOcr.locator('.ocr-icon-btn').click()
  await new Promise((resolve) => setTimeout(resolve, 400))
  console.log('OVERLAY_OCR_E2E_OK')
  await app.close()
  process.exit(0)
})().catch((error) => {
  console.error('OVERLAY_OCR_E2E_FAIL', error)
  process.exit(1)
})
