const { _electron: electron } = require('playwright-core')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SERVER_DIR = path.join(PROJECT, 'server', 'license')
const PORT = 18000 + Math.floor(Math.random() * 1000)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitHealth(timeout = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/healthz`)
      if (response.ok) return
    } catch {
      // server starting
    }
    await sleep(250)
  }
  throw new Error('license server did not start')
}

;(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-license-live-'))
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const keyPath = path.join(tmp, 'ed25519.key')
  fs.writeFileSync(keyPath, privatePem, { mode: 0o600 })

  const server = spawn(
    'python',
    ['-c', `from app import app; app.run(port=${PORT}, threaded=True)`],
    {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PIXMINT_LICENSE_KEY: keyPath,
        PIXMINT_LICENSE_KID: 'dev',
        PIXMINT_LICENSE_DB: path.join(tmp, 'license.db'),
        PIXMINT_PAY_MOCK: '1',
        PIXMINT_PAY_MOCK_AUTO: '1',
        PIXMINT_BASE_URL: `http://127.0.0.1:${PORT}`,
        PIXMINT_ADMIN_TOKEN: 'e2e-admin'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  server.stdout.on('data', (data) => process.env.VERBOSE && console.log('SRV', String(data)))
  server.stderr.on('data', (data) => process.env.VERBOSE && console.log('SRV_ERR', String(data)))

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-license-user-'))
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

  let app = null
  try {
    await waitHealth()
    app = await electron.launch({
      executablePath: ELECTRON,
      args: ['.', '--e2e-purchase'],
      cwd: PROJECT,
      env: {
        ...process.env,
        PIXMINT_USER_DATA_DIR: userData,
        PIXMINT_LICENSE_URL: `http://127.0.0.1:${PORT}/v1`,
        PIXMINT_LICENSE_PUBLIC_KEY: publicPem
      }
    })
    const page = await app.firstWindow()
    page.on('pageerror', (error) => console.log('PAGEERROR', error.message))
    await page.waitForSelector('.pc-card', { timeout: 15000 })
    await page.locator('.pc-primary').click()
    await page.waitForSelector('.pc-qr img', { timeout: 10000 })
    await page.waitForFunction(
      () => (document.querySelector('.pc-body h1')?.textContent || '').includes('Pro 已激活'),
      undefined,
      { timeout: 20000 }
    )
    const code = (await page.locator('.pc-code code').innerText()).trim()
    console.log('LIVE_ACTIVATED', code.slice(0, 24) + '…')

    // 换机路径：同一服务端上重新输入激活码
    await page.evaluate(() => window.snapglass.purchase.open())
    await page.waitForSelector('.pc-links button', { timeout: 10000 })
    await page.locator('.pc-links button').first().click()
    await page.locator('.pc-input').fill(code)
    await page.locator('.pc-primary').click()
    await page.waitForFunction(
      () => (document.querySelector('.pc-body h1')?.textContent || '').includes('Pro 已激活'),
      undefined,
      { timeout: 10000 }
    )
    console.log('LIVE_REACTIVATED true')
    console.log('LIVE_E2E_OK')
  } finally {
    await app?.close().catch(() => {})
    server.kill()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  process.exit(0)
})().catch((error) => {
  console.error('LIVE_E2E_FAIL', error)
  process.exit(1)
})
