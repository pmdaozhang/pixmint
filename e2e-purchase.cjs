const { _electron: electron } = require('playwright-core')
const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function signToken(deviceId) {
  const payload = {
    v: 1,
    kid: 'dev',
    plan: 'pro',
    lic: 'lic_e2e',
    dev: deviceId,
    iat: Math.floor(Date.now() / 1000),
    exp: null,
    upd: null,
    feat: ['pro']
  }
  const part = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = crypto.sign(null, Buffer.from(part, 'utf8'), privateKey).toString('base64url')
  return `${part}.${sig}`
}

const state = {
  deviceId: '',
  orderPolls: 0,
  emails: [],
  trialCode: ''
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const QR_DATA =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#fff"/><rect x="20" y="20" width="160" height="160" fill="#000"/><text x="100" y="110" fill="#fff" font-size="18" text-anchor="middle">DEMO QR</text></svg>'
  )

function manualOrder(input, status = 'pending_payment') {
  const amount = { lifetime: 5800 }[input.plan] || 5800
  return {
    orderId: 'PM-E2E-0001',
    orderToken: 'token_e2e',
    orderNumber: 'PM-E2E-0001',
    status,
    plan: input.plan || 'lifetime',
    channel: input.provider || 'alipay',
    amountCents: amount,
    email: input.email || 'user@example.com',
    expiresAt: Date.now() + 86400000,
    qrUrls: { alipay: QR_DATA, wechat: QR_DATA }
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    let input = {}
    try {
      input = body ? JSON.parse(body) : {}
    } catch {
      input = {}
    }
    if (req.method === 'POST' && url.pathname === '/manual/orders') {
      state.deviceId = input.deviceId || state.deviceId
      state.email = input.email || state.email
      return json(res, 200, manualOrder(input))
    }
    if (
      req.method === 'POST' &&
      url.pathname === '/manual/orders/PM-E2E-0001/submit'
    ) {
      return json(res, 200, manualOrder({ plan: 'lifetime' }, 'reviewing'))
    }
    if (req.method === 'GET' && url.pathname === '/manual/orders/PM-E2E-0001') {
      state.orderPolls += 1
      if (state.orderPolls < 2) {
        return json(res, 200, {
          status: 'reviewing',
          emailSent: false
        })
      }
      return json(res, 200, {
        status: 'paid',
        code: 'PIXMINT-E2E-CODE',
        token: signToken(state.deviceId),
        emailSent: true
      })
    }
    if (req.method === 'POST' && url.pathname === '/license/status') {
      return json(res, 200, { pro: false })
    }
    if (req.method === 'POST' && url.pathname === '/license/activate') {
      state.deviceId = input.deviceId || state.deviceId
      return json(res, 200, {
        token: signToken(state.deviceId),
        code: input.code || 'PIXMINT-E2E-CODE',
        plan: 'pro',
        expiresAt: null,
        devicesUsed: 1,
        devicesMax: 5
      })
    }
    if (req.method === 'POST' && url.pathname === '/license/trial') {
      state.deviceId = input.deviceId || state.deviceId
      state.trialCode = input.inviteCode || ''
      return json(res, 200, {
        token: signToken(state.deviceId),
        code: 'PIXMINT-TRIAL-CODE',
        plan: 'pro',
        expiresAt: Date.now() + 7 * 86400000,
        devicesUsed: 1,
        devicesMax: 1
      })
    }
    if (req.method === 'POST' && url.pathname === '/license/email') {
      state.emails.push(input.email)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/license/by-device') {
      return json(res, 404, { error: 'not found' })
    }
    return json(res, 404, { error: 'not found' })
  })
})

;(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-purchase-'))
  const day = new Date()
  const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(
    day.getDate()
  ).padStart(2, '0')}`
  fs.writeFileSync(
    path.join(userData, 'usage.json'),
    JSON.stringify({
      version: 1,
      day: dayKey,
      counts: { ocr: 20, translate: 10, gif: 3, video: 1 }
    })
  )

  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--e2e-purchase'],
    cwd: PROJECT,
    env: {
      ...process.env,
      PIXMINT_USER_DATA_DIR: userData,
      PIXMINT_LICENSE_URL: `http://127.0.0.1:${port}`,
      PIXMINT_LICENSE_PUBLIC_KEY: PUBLIC_PEM
    }
  })
  try {
    const page = await app.firstWindow()
    page.on('pageerror', (error) => console.log('PAGEERROR', error.message))
    await page.waitForSelector('.pc-card', { timeout: 15000 })
    await page.waitForTimeout(600)
    const headline = (await page.locator('.pc-body h1').innerText()).trim()
    console.log('PURCHASE_HEADLINE', headline)
    if (!headline.includes('用完啦')) throw new Error('exhausted headline missing')
    const prices = await page.locator('.pc-plan-price').allInnerTexts()
    console.log('PURCHASE_PRICES', JSON.stringify(prices))
    if (prices.length !== 1 || !prices[0].includes('58')) {
      throw new Error('lifetime plan card missing')
    }

    await page.locator('#pc-buy-email').fill('user@example.com')
    await page.locator('.pc-primary').click()
    await page.waitForSelector('.pc-qr img', { timeout: 10000 })
    const orderNumber = (await page.locator('.pc-order-no code').innerText()).trim()
    console.log('PURCHASE_MANUAL_ORDER', orderNumber)
    console.log('PURCHASE_QR_SHOWN', true)

    await page.locator('.pc-primary').click()
    await page.waitForFunction(
      () => (document.querySelector('.pc-body h1')?.textContent || '').includes('Pro 已激活'),
      undefined,
      { timeout: 25000 }
    )
    const code = (await page.locator('.pc-code code').innerText()).trim()
    console.log('PURCHASE_ACTIVATED', code)
    if (code !== 'PIXMINT-E2E-CODE') throw new Error('activation code mismatch')

    await page.waitForFunction(
      () => (document.querySelector('.pc-email')?.textContent || '').includes('激活码已发送至'),
      undefined,
      { timeout: 10000 }
    )
    console.log('PURCHASE_EMAIL_AUTO', true)
    await page.screenshot({ path: path.join(PROJECT, 'test-results', 'purchase-activated.png') })

    // 换电脑恢复：重新打开购买窗 → 已有激活码 → 激活
    await page.evaluate(() => window.snapglass.purchase.open())
    await page.waitForSelector('.pc-links button', { timeout: 10000 })
    await page.locator('.pc-links button').first().click()
    await page.locator('.pc-input').fill('PIXMINT-E2E-CODE')
    await page.locator('.pc-primary').click()
    await page.waitForFunction(
      () => (document.querySelector('.pc-body h1')?.textContent || '').includes('Pro 已激活'),
      undefined,
      { timeout: 10000 }
    )
    console.log('PURCHASE_ACTIVATE_E2E_OK')
    console.log('PURCHASE_E2E_OK')
  } finally {
    await app.close().catch(() => {})
    server.close()
  }
  process.exit(0)
})().catch((error) => {
  console.error('PURCHASE_E2E_FAIL', error)
  process.exit(1)
})
