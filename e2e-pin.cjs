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
  console.log('PIN_IMAGE', Boolean(imageSrc && imageSrc.startsWith('data:image/png')))
  if (!imageSrc || !imageSrc.startsWith('data:image/png')) throw new Error('pin image missing')

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
