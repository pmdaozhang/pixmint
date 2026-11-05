const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

async function launch(project, args) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-ui-'))
  const app = await electron.launch({
    executablePath: path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.', ...args],
    cwd: project,
    env: { ...process.env, PIXMINT_USER_DATA_DIR: userData }
  })
  return app
}

;(async () => {
  const project = path.resolve(__dirname, '..')

  // 1. 覆盖层：紧凑工具条 + 双击关闭
  const overlayApp = await launch(project, ['--smoke-overlay'])
  const overlay = await overlayApp.firstWindow()
  await overlay.waitForSelector('.overlay-root', { timeout: 20000 })
  await overlay.waitForTimeout(1800)
  await overlay.mouse.move(300, 220)
  await overlay.mouse.down()
  await overlay.mouse.move(1100, 720, { steps: 8 })
  await overlay.mouse.up()
  await overlay.waitForSelector('.tooldock', { timeout: 8000 })
  await overlay.waitForTimeout(300)
  await overlay.screenshot({ path: path.join(project, 'test-results', 'overlay-compact.png') })
  const dockBox = await overlay.locator('.tooldock').boundingBox()
  console.log('TOOLDOCK_HEIGHT', dockBox ? Math.round(dockBox.height) : null)

  await overlay.mouse.dblclick(700, 470)
  await overlay.waitForTimeout(700)
  const active = await overlayApp.evaluate(() => globalThis.__snapglassOverlayActive?.())
  const clipboardImage = await overlayApp.evaluate(({ clipboard }) =>
    !clipboard.readImage().isEmpty()
  )
  console.log('DOUBLE_CLICK_CLOSED', active === false)
  console.log('DOUBLE_CLICK_COPIED', clipboardImage)
  await overlayApp.close().catch(() => undefined)

  // 2. OCR 弹窗：四角透明
  const ocrApp = await launch(project, ['--smoke-ocr'])
  const ocr = await ocrApp.firstWindow()
  await ocr.waitForSelector('.ocr-root', { timeout: 20000 })
  await ocr.waitForTimeout(500)
  await ocr.screenshot({
    path: path.join(project, 'test-results', 'ocr-transparent.png'),
    omitBackground: true
  })
  console.log('OCR_SCREENSHOT_OK')
  await ocrApp.close().catch(() => undefined)
})().catch((error) => {
  console.error('UI_FIX_CHECK_FAILED', error)
  process.exit(1)
})
