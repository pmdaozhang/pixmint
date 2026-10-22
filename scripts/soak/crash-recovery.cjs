const path = require('node:path')
const { _electron: electron } = require('playwright-core')

const PROJECT = path.resolve(__dirname, '..', '..')
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  try {
    const overlay = await app.firstWindow()
    await overlay.waitForSelector('.overlay-root', { timeout: 15000 })
    await overlay.waitForTimeout(1500)
    await overlay.keyboard.press('Escape')
    for (let index = 0; index < 50; index += 1) {
      if (!(await app.evaluate(() => globalThis.__snapglassOverlayActive?.()))) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await app.evaluate(() => globalThis.__snapglassStartCapture?.())
    for (let index = 0; index < 100; index += 1) {
      if (await app.evaluate(() => globalThis.__snapglassOverlayActive?.())) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await overlay.waitForTimeout(300)
    await overlay.mouse.move(400, 260)
    await overlay.mouse.down()
    await overlay.mouse.move(900, 600, { steps: 6 })
    await overlay.mouse.up()
    await overlay.waitForSelector('.tooldock', { timeout: 8000 })
    await overlay.locator('[title="录制视频"]').click()
    await overlay.waitForSelector('.rec-ctrl', { timeout: 4000 })
    await overlay.locator('.rec-start').click()
    for (let index = 0; index < 100; index += 1) {
      if (await app.evaluate(() => globalThis.__snapglassOverlayActive?.())) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    await app.evaluate(({ BrowserWindow }) => {
      const overlay = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('overlay')
      )
      overlay?.webContents.forcefullyCrashRenderer()
    })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const state = await app.evaluate(({ BrowserWindow }) => {
      const visible = BrowserWindow.getAllWindows().filter((window) => window.isVisible())
      const overlayVisible = visible.some((window) =>
        window.webContents.getURL().includes('overlay')
      )
      return {
        active: globalThis.__snapglassOverlayActive?.() === true,
        overlayVisible,
        visibleWindows: visible.length
      }
    })
    console.log('CRASH_RECOVERY_STATE', state)
    if (state.active || state.overlayVisible) {
      throw new Error('overlay still active/visible after renderer crash')
    }
    console.log('CRASH_RECOVERY_OK')
  } finally {
    await app.close().catch(() => {})
  }
})().catch((error) => {
  console.error('CRASH_RECOVERY_FAIL', error)
  process.exit(1)
})

