const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.overlay-root', { timeout: 15000 })
    await sleep(1600)
    const before = await page.evaluate(() => {
      const el = document.elementFromPoint(120, 100)
      return { tag: el?.tagName, cls: el?.className, html: document.querySelector('.tooldock')?.parentElement?.getAttribute('style') }
    })
    console.log('BEFORE', before)
    await page.mouse.move(120, 100)
    await page.mouse.down()
    await page.mouse.move(760, 520, { steps: 8 })
    const upAt = Date.now()
    await page.mouse.up()
    await page.waitForSelector('.tooldock', { state: 'visible', timeout: 5000 })
    console.log('TOOLBAR_VISIBLE_MS', Date.now() - upAt)
    await sleep(800)
    const after = await page.evaluate(() => {
      const dock = document.querySelector('.tooldock')
      const wrap = dock?.parentElement
      const selection = document.querySelector('.selection')
      return {
        selection: selection
          ? {
              left: selection.getAttribute('style'),
              box: selection.getBoundingClientRect().toJSON()
            }
          : null,
        handles: document.querySelectorAll('.resize-handle').length,
        wrapStyle: wrap?.getAttribute('style'),
        dockVisibility: dock ? getComputedStyle(dock).visibility : null,
        dockDisplay: dock ? getComputedStyle(dock).display : null,
        atStart: (() => {
          const el = document.elementFromPoint(120, 100)
          return { tag: el?.tagName, cls: el?.className }
        })()
      }
    })
    console.log('AFTER', after)
    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('DEBUG_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
