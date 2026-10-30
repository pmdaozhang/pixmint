const { readFileSync, mkdtempSync, rmSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const { arch, release, tmpdir } = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')
const { version } = require('./package.json')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const API_BASE = 'https://data.hugproducthub.top/api/v1'
const FEEDBACK_URL = `${API_BASE}/feedback`

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  })
}

async function postFile(url, file, requestId) {
  const form = new FormData()
  form.append('request_id', requestId)
  form.append('file', file, file.name)
  return fetch(url, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000)
  })
}

;(async () => {
  if (process.env.PIXMINT_FEEDBACK_LIVE !== '1') {
    throw new Error('Set PIXMINT_FEEDBACK_LIVE=1 to run against production')
  }

  const userData = mkdtempSync(path.join(tmpdir(), 'pixmint-feedback-live-'))
  const requestId = randomUUID()
  const content = `Pixmint 生产联调 ${new Date().toISOString()} request=${requestId}（可删除）`
  const pngBase64 = readFileSync(path.join(PROJECT, 'assets', 'icon-256.png')).toString('base64')
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--e2e-feedback', `--user-data-dir=${userData}`],
    cwd: PROJECT,
    env: { ...process.env }
  })

  try {
    const win = await app.firstWindow()
    await win.waitForSelector('.feedback-root', { timeout: 15000 })
    const jpegBase64 = await app.evaluate(
      ({ nativeImage }, imagePath) =>
        nativeImage.createFromPath(imagePath).toJPEG(86).toString('base64'),
      path.join(PROJECT, 'assets', 'icon-256.png')
    )

    const appResult = await win.evaluate(
      async ({ requestId: id, content: text, png, jpeg }) => {
        const decode = (base64) =>
          Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
        return window.snapglass.feedback.submit({
          content: text,
          requestId: id,
          attachments: [
            {
              name: 'production-png.png',
              mimeType: 'image/png',
              bytes: decode(png)
            },
            {
              name: 'production-jpeg.jpg',
              mimeType: 'image/jpeg',
              bytes: decode(jpeg)
            }
          ]
        })
      },
      { requestId, content, png: pngBase64, jpeg: jpegBase64 }
    )

    console.log('LIVE_APP_RESULT', JSON.stringify(appResult))
    assert(appResult.status === 'sent', 'app submission did not return sent')
    assert(typeof appResult.id === 'string' && appResult.id.length > 0, 'app did not return id')
    assert(appResult.attachments?.uploaded === 2, 'app did not upload two attachments')
    assert(appResult.attachments?.failed === 0, 'app reported attachment failures')

    const retryResponse = await postJson(FEEDBACK_URL, {
      tool: 'pixmint',
      type: 'other',
      content,
      version,
      request_id: requestId,
      platform: process.platform,
      os_version: release(),
      arch: arch()
    })
    const retryBody = await retryResponse.json()
    console.log('LIVE_IDEMPOTENT', retryResponse.status, JSON.stringify(retryBody))
    assert(retryResponse.status === 200, 'idempotent retry did not return 200')
    assert(retryBody.id === appResult.id, 'idempotent retry returned a different id')

    const missingId = randomUUID()
    const missingResponse = await postFile(
      `${FEEDBACK_URL}/${missingId}/attachments`,
      new File([Buffer.from(pngBase64, 'base64')], 'missing.png', { type: 'image/png' }),
      requestId
    )
    const missingBody = await missingResponse.text()
    console.log('LIVE_404', missingResponse.status, missingBody)
    assert(missingResponse.status === 404, 'missing feedback id did not return 404')

    const unsupportedResponse = await postFile(
      `${FEEDBACK_URL}/${appResult.id}/attachments`,
      new File(['not an image'], 'notes.txt', { type: 'text/plain' }),
      requestId
    )
    const unsupportedBody = await unsupportedResponse.text()
    console.log('LIVE_400', unsupportedResponse.status, unsupportedBody)
    assert(unsupportedResponse.status === 400, 'text/plain did not return 400')

    const oversizedResponse = await postFile(
      `${FEEDBACK_URL}/${appResult.id}/attachments`,
      new File([new Uint8Array(6 * 1024 * 1024)], 'too-large.png', {
        type: 'image/png'
      }),
      requestId
    )
    const oversizedBody = await oversizedResponse.text()
    console.log('LIVE_413', oversizedResponse.status, oversizedBody)
    assert(oversizedResponse.status === 413, '6MB attachment did not return 413')

    console.log('LIVE_FEEDBACK_ID', appResult.id)
    console.log('E2E_FEEDBACK_LIVE_OK')
  } finally {
    await app.close().catch(() => {})
    rmSync(userData, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error('E2E_FEEDBACK_LIVE_FAILED', error)
  process.exit(1)
})

