const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')

const windowStates = (app) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      url: window.webContents.getURL(),
      bounds: window.getBounds(),
      visible: window.isVisible(),
      opacity: window.getOpacity()
    }))
  )

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-prepare'],
    cwd: PROJECT,
    env: { ...process.env }
  })

  await new Promise((resolve) => setTimeout(resolve, 1500))
  const during = await windowStates(app)
  console.log('PREPARE_WINDOWS_DURING', JSON.stringify(during))
  const overlayDuring = during.find((state) => state.url.includes('#overlay'))
  if (!overlayDuring) throw new Error('overlay window missing')
  if (overlayDuring.visible) {
    throw new Error('overlay must stay hidden while the screen capture is in progress')
  }
  console.log('PREPARE_OVERLAY_HIDDEN true')

  const page = app.windows().find((window) => window.url().includes('#overlay'))
  if (!page) throw new Error('overlay page missing')
  await page.waitForSelector('.overlay-root', { state: 'attached', timeout: 15000 })
  await new Promise((resolve) => setTimeout(resolve, 500))

  const after = await windowStates(app)
  console.log('PREPARE_WINDOWS_AFTER', JSON.stringify(after))
  const overlayAfter = after.find((state) => state.url.includes('#overlay'))
  if (!overlayAfter?.visible) throw new Error('overlay should be visible after capture')
  if (overlayAfter.opacity < 1) throw new Error('overlay should be fully opaque after capture')
  if ((await page.locator('.overlay-preparing').count()) > 0) {
    throw new Error('legacy preparing state should not render')
  }
  console.log('IMAGE_VISIBLE true')
  await page.keyboard.press('Escape')
  await new Promise((resolve) => setTimeout(resolve, 300))
  console.log('PREPARE_E2E_OK')
  await app.close()
  process.exit(0)
})().catch((error) => {
  console.error('PREPARE_E2E_FAIL', error)
  process.exit(1)
})
