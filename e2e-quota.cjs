const { _electron: electron } = require('playwright-core')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForPage(app, selector, timeout = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    for (const page of app.windows()) {
      try {
        if ((await page.locator(selector).count()) > 0) return page
      } catch {
        // window closing
      }
    }
    await sleep(200)
  }
  throw new Error(`timeout waiting for ${selector}`)
}

;(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-quota-'))
  const now = new Date()
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`
  fs.writeFileSync(
    path.join(userData, 'usage.json'),
    JSON.stringify({
      version: 1,
      day,
      counts: { ocr: 20, translate: 10, gif: 3, video: 1 }
    })
  )

  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay-ocr'],
    cwd: PROJECT,
    // 开发版默认不限制次数；额度测试必须显式强制启用限制。
    env: {
      ...process.env,
      PIXMINT_USER_DATA_DIR: userData,
      PIXMINT_ENFORCE_QUOTA: '1'
    }
  })
  try {
    const overlay = await waitForPage(app, '.overlay-root')
    await overlay.waitForSelector('.overlay-root', { timeout: 8000 })
    await overlay.mouse.move(400, 300)
    await overlay.mouse.down()
    await overlay.mouse.move(1500, 780, { steps: 8 })
    await overlay.mouse.up()
    await overlay.waitForSelector('.tooldock', { timeout: 8000 })
    await overlay.locator('.act[data-action="ocr"]').click()

    const purchase = await waitForPage(app, '.pc-card', 15000)
    const headline = (await purchase.locator('.pc-body h1').innerText()).trim()
    console.log('QUOTA_PURCHASE_HEADLINE', headline)
    if (!headline.includes('用完啦')) throw new Error('quota purchase window not shown')
    const ocrWindows = app
      .windows()
      .filter((page) => page.url().includes('#ocr'))
    console.log('QUOTA_OCR_WINDOWS', ocrWindows.length)
    if (ocrWindows.length > 0) throw new Error('OCR window opened despite exhausted quota')
    await purchase.screenshot({ path: path.join(PROJECT, 'test-results', 'quota-purchase.png') })
    console.log('QUOTA_E2E_OK')
  } finally {
    await app.close().catch(() => {})
  }
  process.exit(0)
})().catch((error) => {
  console.error('QUOTA_E2E_FAIL', error)
  process.exit(1)
})
