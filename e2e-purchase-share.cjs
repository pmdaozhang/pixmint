// 购买页分享卡验证：同一个应用实例内从托盘入口打开购买页，走真实 IPC 与缓存链路。
// 用法：先跑 e2e-share.cjs 产出缓存意义不大，这里自带假服务并直接打开购买窗。
const http = require('node:http')
const { mkdtempSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SHOTS = path.join(PROJECT, 'test-results', 'share')
const userData = mkdtempSync(path.join(tmpdir(), 'pixmint-purchase-share-'))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const server = http.createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => (body += chunk))
  request.on('end', () => {
    console.log('FAKE_SERVER', request.method, request.url, body)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    if (String(request.url).includes('/referral/quote')) {
      // 与真实服务端同口径：7 次 → 减 ¥35，应付 ¥23
      response.end(
        JSON.stringify({ count: 7, priceCents: 5800, creditCents: 3500, amountCents: 2300, free: false })
      )
      return
    }
    response.end(JSON.stringify(String(request.url).includes('/referral/') ? { count: 7, active: true } : {}))
  })
})

server.listen(0, '127.0.0.1', async () => {
  mkdirSync(SHOTS, { recursive: true })
  const apiBase = `http://127.0.0.1:${server.address().port}/api/v1`
  const errors = []
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--e2e-purchase-share', `--user-data-dir=${userData}`],
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
    // 主进程已完成一次同步后再打开购买窗，首帧缓存里就有 7 次
    await win.waitForSelector('.share-card', { timeout: 15000 })
    await win.waitForFunction(
      () => (document.querySelector('.share-card-row')?.textContent ?? '').includes('7 / 12'),
      undefined,
      { timeout: 8000 }
    )
    await app.evaluate(({ BrowserWindow }) => {
      const [w] = BrowserWindow.getAllWindows()
      w.setAlwaysOnTop(false)
      w.setPosition(200, 200)
    })
    const text = await win.locator('.pc-card').innerText()
    console.log('PURCHASE_TEXT', JSON.stringify(text))
    // 折后价只用服务端报价：划线原价 ¥58、实付 ¥23，下单按钮也带实付金额
    assert(/¥\s*58/.test(text), 'original price should stay visible')
    assert(/¥\s*23/.test(text), 'discounted price from server quote missing')
    assert(!text.includes('NaN'), 'NaN rendered in price area')
    assert(text.includes('已减 ¥35'), 'discount summary missing')
    assert(text.includes('生成订单并付款 ¥23'), 'pay button should carry discounted amount')
    assert(text.includes('已分享 7 / 12 次'), 'share progress on purchase page missing')
    assert(text.includes('活动截止时间以官方通知为准'), 'rule copy on purchase page missing')
    // 分享卡里要有分享链接 + 复制按钮，复制后剪贴板内容与显示的链接一致
    const linkText = await win.locator('.share-card-link code').innerText()
    console.log('PURCHASE_SHARE_LINK', linkText)
    assert(/^pixmint\.hugproducthub\.top\/download\?ref=PM[A-Z0-9]{6}$/.test(linkText), 'share link missing')
    await win.locator('.share-card-link button').click()
    await win.waitForSelector('.share-card-link button.copied', { timeout: 3000 })
    const shareClipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
    console.log('PURCHASE_SHARE_CLIPBOARD', shareClipboard)
    assert(/\/download\?ref=PM[A-Z0-9]{6}$/.test(shareClipboard), 'share link copy wrong')
    await win.screenshot({ path: path.join(SHOTS, 'purchase-share-card.png') })

    // 点「分享得会员」打开分享弹框：应以购买窗为父窗口，出现在屏幕中央
    await win.evaluate(() => window.snapglass.referral.openShare())
    await app.waitForEvent('window', { timeout: 8000 })
    await new Promise((r) => setTimeout(r, 600))
    const shareWindowInfo = await app.evaluate(({ BrowserWindow, screen }) => {
      const windows = BrowserWindow.getAllWindows()
      const share = windows.find(
        (w) => w.getTitle().includes('分享') || w.webContents.getURL().includes('#share')
      )
      if (!share) return null
      const [x, y] = share.getPosition()
      const [width, height] = share.getSize()
      const area = screen.getDisplayNearestPoint(share.getBounds()).workArea
      return {
        parented: Boolean(share.getParentWindow()),
        offsetX: Math.round(x - (area.x + (area.width - width) / 2)),
        offsetY: Math.round(y - (area.y + (area.height - height) / 2))
      }
    })
    console.log('PURCHASE_OPEN_SHARE', JSON.stringify(shareWindowInfo))
    assert(shareWindowInfo, 'share window not opened from purchase page')
    assert(shareWindowInfo.parented, 'share window should be parented by purchase window')
    const layout = await win.evaluate(() => {
      const card = document.querySelector('.pc-card')
      const body = document.querySelector('.pc-body')
      return {
        card: card ? card.scrollHeight : null,
        body: body ? body.scrollHeight : null,
        window: [innerWidth, innerHeight]
      }
    })
    console.log('PURCHASE_LAYOUT', JSON.stringify(layout))
    console.log('PAGE_ERRORS', JSON.stringify(errors))
    assert(errors.length === 0, 'renderer errors present')
    console.log('PURCHASE_SHARE_OK')
  } finally {
    await app.close()
    server.close()
  }
})
