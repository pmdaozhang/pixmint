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
  const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  await window.mouse.move(100, 90)
  await window.mouse.down()
  await window.mouse.move(Math.min(640, viewport.width - 100), 420, { steps: 6 })
  await window.mouse.up()
  await window.waitForSelector('.tooldock', { timeout: 5000 })
  await window.locator('.act').filter({ hasText: '钉图' }).click()

  const pin = await app.waitForEvent('window', { timeout: 8000 }).catch(() => null)
  const windows = app.windows()
  const pinWindow = pin ?? windows[windows.length - 1]
  await pinWindow.waitForSelector('.pin-root', { timeout: 8000 })
  const imageSrc = await pinWindow.locator('.pin-image').getAttribute('src')
  const imageLoaded = await pinWindow
    .locator('.pin-image')
    .evaluate((image) => image.complete && image.naturalWidth > 0)
  console.log('PIN_IMAGE', Boolean(imageSrc), 'LOADED', imageLoaded)
  if (!imageSrc || !imageLoaded) throw new Error('pin image missing')

  const before = await app.evaluate(({ BrowserWindow }) => {
    const visible = BrowserWindow.getAllWindows().find((window) => window.isVisible())
    return visible ? visible.getBounds() : null
  })
  console.log('PIN_BOUNDS', before)
  if (
    !before ||
    Math.abs(before.x + 20 - 100) > 6 ||
    Math.abs(before.y + 20 - 90) > 6
  ) {
    throw new Error('pin is not placed at the selection origin')
  }

  await pinWindow.mouse.move(60, 60)
  await pinWindow.mouse.down()
  await pinWindow.mouse.move(140, 110, { steps: 5 })
  await pinWindow.mouse.up()
  await new Promise((resolve) => setTimeout(resolve, 250))
  const after = await app.evaluate(({ BrowserWindow }) => {
    const visible = BrowserWindow.getAllWindows().find((window) => window.isVisible())
    return visible ? visible.getBounds() : null
  })
  console.log('PIN_DRAGGED', after)
  if (!after || after.x - before.x < 40 || after.y - before.y < 20) {
    throw new Error('pin drag did not move the window')
  }

  await pinWindow.locator('.pin-actions button[title="复制"]').click()
  await new Promise((resolve) => setTimeout(resolve, 400))
  const clipboardHasImage = await app.evaluate(({ clipboard }) => !clipboard.readImage().isEmpty())
  console.log('PIN_CLIPBOARD', clipboardHasImage)
  if (!clipboardHasImage) throw new Error('pin copy failed')

  const srcBeforeEdit = await pinWindow.locator('.pin-image').getAttribute('src')
  const normalBounds = await app.evaluate(({ BrowserWindow }) => {
    const visible = BrowserWindow.getAllWindows().find((window) => window.isVisible())
    return visible ? visible.getBounds() : null
  })
  await pinWindow.keyboard.press('Space')
  await pinWindow.waitForSelector('.pin-edit-toolbar .tooldock', { timeout: 8000 })
  await pinWindow.waitForSelector('.anno-canvas', { timeout: 8000 })
  const editBounds = await app.evaluate(({ BrowserWindow }) => {
    const visible = BrowserWindow.getAllWindows().find((window) => window.isVisible())
    return visible ? visible.getBounds() : null
  })
  const hasUndo = await pinWindow.locator('button[title="撤销 Ctrl+Z"]').count()
  const hasRedo = await pinWindow.locator('button[title="重做 Ctrl+Shift+Z"]').count()
  const checkText = (
    await pinWindow.locator('.pin-edit-toolbar .act').filter({ hasText: '完成' }).innerText()
  ).trim()
  console.log('PIN_EDIT_OPEN', editBounds, 'UNDO_REDO', hasUndo, hasRedo, 'CHECK', checkText)
  if (!normalBounds || !editBounds || editBounds.height <= normalBounds.height) {
    throw new Error('pin edit mode did not expand the window')
  }
  if (hasUndo !== 1 || hasRedo !== 1 || !checkText.includes('完成')) {
    throw new Error('pin edit toolbar is missing undo/redo/confirm')
  }
  await pinWindow.locator('.pin-edit-toolbar button[title="矩形 / 椭圆"]').click()
  await pinWindow.waitForSelector('.pin-edit-toolbar .row2', { timeout: 3000 })
  const submenuRows = await pinWindow.locator('.pin-edit-toolbar .row2').count()
  console.log('PIN_EDIT_SUBMENU', submenuRows)
  if (submenuRows !== 1) throw new Error('pin edit submenu did not open')
  await pinWindow.locator('.pin-edit-toolbar button[title="矩形 / 椭圆"]').click()
  await pinWindow.screenshot({ path: path.join(__dirname, 'test-results', 'pin-edit.png') })

  const annoBox = await pinWindow.locator('.anno-canvas').boundingBox()
  if (!annoBox) throw new Error('annotation canvas is missing')
  await pinWindow.mouse.move(annoBox.x + 30, annoBox.y + 24)
  await pinWindow.mouse.down()
  await pinWindow.mouse.move(annoBox.x + 130, annoBox.y + 96, { steps: 6 })
  await pinWindow.mouse.up()
  await new Promise((resolve) => setTimeout(resolve, 250))
  const undoDisabled = await pinWindow.locator('button[title="撤销 Ctrl+Z"]').isDisabled()
  console.log('PIN_EDIT_UNDO_ENABLED', !undoDisabled)
  if (undoDisabled) throw new Error('pin annotation did not enter history')

  await pinWindow.locator('.pin-edit-toolbar .act').filter({ hasText: '完成' }).click()
  await pinWindow.waitForSelector('.pin-edit-toolbar', { state: 'detached', timeout: 8000 })
  await pinWindow.waitForSelector('.pin-image', { timeout: 8000 })
  const restoredBounds = await app.evaluate(({ BrowserWindow }) => {
    const visible = BrowserWindow.getAllWindows().find((window) => window.isVisible())
    return visible ? visible.getBounds() : null
  })
  const srcAfterEdit = await pinWindow.locator('.pin-image').getAttribute('src')
  console.log('PIN_EDIT_SAVED', restoredBounds, Boolean(srcAfterEdit && srcAfterEdit !== srcBeforeEdit))
  if (
    !restoredBounds ||
    !normalBounds ||
    restoredBounds.width !== normalBounds.width ||
    restoredBounds.height !== normalBounds.height
  ) {
    throw new Error('pin window did not restore bounds after edit')
  }
  if (!srcAfterEdit || srcAfterEdit === srcBeforeEdit) {
    throw new Error('edited pin image was not written back')
  }

  await pinWindow.locator('.pin-actions button[title="关闭"]').click()
  await new Promise((resolve) => setTimeout(resolve, 400))
  const visibleWindows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length
  )
  console.log('PIN_CLOSED', visibleWindows === 0)
  console.log('PIN_E2E_OK')
  await app.close()
  process.exit(0)
})().catch((error) => {
  console.error('PIN_E2E_FAIL', error)
  process.exit(1)
})
