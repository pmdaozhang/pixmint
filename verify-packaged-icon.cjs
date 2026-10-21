const { _electron: electron } = require('playwright-core')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const PROJECT = __dirname
const EXE = path.join(PROJECT, 'release', 'win-unpacked', 'Pixmint.exe')
const OUTPUT = path.join(PROJECT, 'verify-packaged-desktop.png')
const WINDOW_OUTPUT = path.join(PROJECT, 'verify-settings-window.png')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

;(async () => {
  const app = await electron.launch({
    executablePath: EXE,
    args: ['--e2e-settings'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.settings-root', { timeout: 15000 })
    await page.bringToFront()
    await page.screenshot({ path: WINDOW_OUTPUT, omitBackground: true })
    const windows = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        title: window.getTitle(),
        visible: window.isVisible(),
        focused: window.isFocused(),
        bounds: window.getBounds(),
        url: window.webContents.getURL()
      }))
    )
    console.log('PACKAGED_WINDOWS', JSON.stringify(windows))
    await sleep(1800)
    execFileSync('python', [
      '-c',
      `from PIL import ImageGrab; ImageGrab.grab().save(r'${OUTPUT.replace(/\\/g, '\\\\')}')`
    ])
    console.log('PACKAGED_SETTINGS_CAPTURED', OUTPUT, WINDOW_OUTPUT)
    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('PACKAGED_ICON_VERIFY_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
