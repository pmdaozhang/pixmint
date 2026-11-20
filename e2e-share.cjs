const http = require('node:http')
const { mkdtempSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SHOTS = path.join(PROJECT, 'test-results', 'share')
const userData = mkdtempSync(path.join(tmpdir(), 'pixmint-share-'))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

// 假授权服务：模拟「已计 7 次」，同时验证 /referral/sync 请求体
const seen = []
const server = http.createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    seen.push({ url: request.url, method: request.method, body })
    console.log('FAKE_SERVER', request.method, request.url, Buffer.concat(chunks).toString('utf8'))
    if (String(request.url).includes('/referral/progress')) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ state: { count: 7, endedAt: null } }))
      return
    }
    if (String(request.url).includes('/referral/sync')) {
      response.end(JSON.stringify({ code: 'PM7K3QAZ', count: 7, ended: false }))
      return
    }
    if (String(request.url).includes('/referral/')) {
      response.end(JSON.stringify({ count: 7, active: true }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({}))
  })
})

function listen() {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}/api/v1`)
    })
  })
}

;(async () => {
  mkdirSync(SHOTS, { recursive: true })
  const apiBase = await listen()
  const errors = []
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--e2e-share', `--user-data-dir=${userData}`],
    cwd: PROJECT,
    env: { ...process.env, PIXMINT_LICENSE_URL: apiBase, ELECTRON_RENDERER_URL: '' }
  })
  try {
    const win = await app.firstWindow()
    // 无头自动化里系统焦点不落在弹框上，先置顶 400ms 再撤掉，跳过 blur 收起，避免测试中途窗口消失
    await app.evaluate(({ BrowserWindow }) => {
      const [w] = BrowserWindow.getAllWindows()
      if (w) w.setAlwaysOnTop(true, 'pop-up-menu')
    })
    await new Promise((r) => setTimeout(r, 450))
    await app.evaluate(({ BrowserWindow }) => {
      const [w] = BrowserWindow.getAllWindows()
      if (w) w.setAlwaysOnTop(false)
    })
    win.on('pageerror', (error) => errors.push(error.message))
    win.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await win.waitForSelector('.sh-card', { timeout: 15000 })
    await app.evaluate(({ BrowserWindow }) => {
      const [w] = BrowserWindow.getAllWindows()
      w.setAlwaysOnTop(false)
      w.setPosition(200, 200)
    })
    // 弹框先渲染本地缓存，1.2 秒后再拉一次服务端进度
    await win.waitForFunction(
      () => (document.querySelector('.sh-progress-row')?.textContent ?? '').includes('7 / 12'),
      undefined,
      { timeout: 8000 }
    )
    const text = await win.locator('.sh-card').innerText()
    console.log('SHARE_TEXT', JSON.stringify(text))
    assert(text.includes('累计 12 次免费升会员'), 'rule copy missing')
    assert(text.includes('活动截止时间以官方通知为准'), 'deadline notice missing')
    assert(/已分享 7 \/ 12 次/.test(text), 'progress missing')
    assert(text.includes('ref=PM'), 'share link missing ref')
    await win.screenshot({ path: path.join(SHOTS, 'share-dialog.png') })

    await win.locator('.sh-copy').click()
    await win.waitForSelector('.sh-copy.copied', { timeout: 3000 })
    const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
    console.log('SHARE_CLIPBOARD', clipboard)
    assert(/\/download\?ref=PM[A-Z0-9]{6}$/.test(clipboard), 'clipboard link wrong')
    await win.screenshot({ path: path.join(SHOTS, 'share-copied.png') })
    // 复制成功 0.6 秒后弹框自动关闭
    const start = Date.now()
    await app.evaluate(({ BrowserWindow }, ) => new Promise((resolve) => {
      const [w] = BrowserWindow.getAllWindows()
      if (!w || w.isDestroyed()) return resolve(true)
      w.once('closed', () => resolve(true))
      setTimeout(() => resolve(false), 3000)
    }))
    console.log('SHARE_AUTOCLOSE_MS', Date.now() - start)

    // 购买页验证见 e2e-purchase-share.cjs
  } finally {
    console.log('REFERRAL_REQUESTS', JSON.stringify(seen))
    console.log('PAGE_ERRORS', JSON.stringify(errors))
    await app.close()
    server.close()
  }
})().catch((error) => {
  console.error('SHARE_E2E_FAILED', error)
  process.exit(1)
})
