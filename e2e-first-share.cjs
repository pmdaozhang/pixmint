// 首次分享回归：全新 user-data（本机没有任何分享码）+ 离线，走托盘「分享」回调 → 弹框出现 → 复制 → 自动关闭。
// 这条路径覆盖曾经导致 0.8.26 点「分享」无反应的 bug。
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')
const PROJECT = process.cwd()
;(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'firstshare-'))
  const app = await electron.launch({
    executablePath: path.join(PROJECT, 'node_modules/electron/dist/electron.exe'),
    args: ['.', '--user-data-dir=' + userData, '--e2e-first-share'],
    cwd: PROJECT,
    // 服务不可达，模拟离线首次分享：不依赖任何服务端
    env: { ...process.env, PIXMINT_LICENSE_URL: 'http://127.0.0.1:1/api/v1', ELECTRON_RENDERER_URL: '' }
  })
  const out = {}
  try {
    const win = await app.firstWindow({ timeout: 20000 })
    await win.waitForSelector('.sh-card', { timeout: 15000 })
    await app.evaluate(({ BrowserWindow }) => { const [w] = BrowserWindow.getAllWindows(); if (w) w.setAlwaysOnTop(true, 'pop-up-menu') })
    await new Promise((r) => setTimeout(r, 500))
    out.card = await win.locator('.sh-card').innerText()
    out.link = await win.locator('.sh-link-row code').innerText()
    await win.locator('.sh-copy').click()
    await win.waitForSelector('.sh-copy.copied', { timeout: 4000 })
    out.clipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
    await new Promise((r) => setTimeout(r, 1200))
    out.windowsAfterCopy = (await app.windows()).length
    if (!/^pixmint\.hugproducthub\.top\/download\?ref=PM[A-Z0-9]{6}$/.test(out.link)) throw new Error('share link malformed')
    if (out.clipboard !== 'https://' + out.link) throw new Error('clipboard mismatch')
    if (out.windowsAfterCopy !== 0) throw new Error('dialog did not auto close')
    console.log('FIRST_SHARE_OK', out.link)
  } finally { await app.close() }
})().catch((e) => { console.error('FIRST_SHARE_FAIL', String(e).slice(0, 400)); process.exit(1) })
