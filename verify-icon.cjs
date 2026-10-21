const { _electron: electron } = require('playwright-core')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const PROJECT = process.argv[2] || __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUTPUT = path.join(__dirname, 'verify-settings-desktop.png')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--e2e-settings'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.settings-root', { timeout: 15000 })
    await sleep(1800)
    execFileSync('python', [
      '-c',
      `from PIL import ImageGrab; ImageGrab.grab().save(r'${OUTPUT.replace(/\\/g, '\\\\')}')`
    ])
    console.log('SETTINGS_DESKTOP_CAPTURED', OUTPUT)
    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('SETTINGS_ICON_VERIFY_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
