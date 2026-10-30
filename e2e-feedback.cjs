const http = require('node:http')
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SHOTS = path.join(PROJECT, 'test-results', 'feedback')
const userData = mkdtempSync(path.join(tmpdir(), 'pixmint-feedback-'))
const queueRequestId = randomUUID()
const rejectedRequestId = randomUUID()
const TEST_IMAGE = path.join(PROJECT, 'assets', 'icon-256.png')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const requests = {
  feedback: [],
  attachments: []
}

const server = http.createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const body = Buffer.concat(chunks)
    if (request.method === 'POST' && request.url === '/api/v1/feedback') {
      const payload = JSON.parse(body.toString('utf8'))
      requests.feedback.push(payload)
      const queueAttempts = requests.feedback.filter(
        (item) => item.request_id === queueRequestId
      ).length
      if (payload.request_id === rejectedRequestId) {
        response.writeHead(400, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: 'content_too_short' }))
        return
      }
      if (payload.request_id === queueRequestId && queueAttempts === 1) {
        response.writeHead(503, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: 'maintenance' }))
        return
      }
      const id = `fb_${requests.feedback.length}`
      response.writeHead(201, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ id, request_id: payload.request_id }))
      return
    }

    if (
      request.method === 'POST' &&
      /^\/api\/v1\/feedback\/[^/]+\/attachments$/.test(request.url || '')
    ) {
      requests.attachments.push(body)
      response.writeHead(201, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
      return
    }

    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'not_found' }))
  })
})

function listen() {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(`http://127.0.0.1:${address.port}/api/v1/feedback`)
    })
  })
}

;(async () => {
  mkdirSync(SHOTS, { recursive: true })
  const endpoint = await listen()
  const errors = []
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--e2e-feedback', `--user-data-dir=${userData}`],
    cwd: PROJECT,
    env: {
      ...process.env,
      PIXMINT_FEEDBACK_ENDPOINT: endpoint
    }
  })

  try {
    const win = await app.firstWindow()
    win.on('pageerror', (error) => errors.push(error.message))
    win.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await win.waitForSelector('.feedback-root', { timeout: 15000 })
    assert((await win.locator('input[type=file]').count()) === 0, 'local file input must not exist')
    assert(await win.locator('#feedback-content').isVisible(), 'feedback editor missing')
    assert(await win.locator('button.button-primary').isDisabled(), 'empty content can submit')

    await app.evaluate(
      ({ clipboard, nativeImage }, imagePath) => {
        const image = nativeImage.createFromPath(imagePath)
        if (image.isEmpty()) throw new Error('E2E clipboard image is empty')
        clipboard.writeImage(image)
      },
      TEST_IMAGE
    )
    await win.locator('#feedback-content').focus()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.paste()
    })
    await win.waitForSelector('.thumbnail', { timeout: 5000 })
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.paste()
    })
    await win.waitForFunction(() => document.querySelectorAll('.thumbnail').length === 2)
    console.log('FEEDBACK_PASTED', await win.locator('.thumbnail').count())

    await win.locator('.thumb-remove').first().click()
    assert(
      (await win.locator('.thumbnail').count()) === 1,
      'removing one screenshot changed the wrong count'
    )
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.paste()
    })
    await win.waitForFunction(() => document.querySelectorAll('.thumbnail').length === 2)

    await win
      .locator('#feedback-content')
      .fill('E2E 反馈：托盘菜单、截图粘贴和提交链路。')
    await win.screenshot({ path: path.join(SHOTS, 'feedback-window.png') })
    assert(!(await win.locator('button.button-primary').isDisabled()), 'submit stayed disabled')
    await win.locator('button.button-primary').click()
    await win.waitForSelector('.feedback-result', { timeout: 15000 })
    await win.waitForFunction(
      () => document.querySelectorAll('.result-chip').length > 0,
      { timeout: 15000 }
    )
    await win.screenshot({ path: path.join(SHOTS, 'feedback-success.png') })

    assert(requests.feedback.length >= 1, 'text request was not received')
    const first = requests.feedback[0]
    console.log('FEEDBACK_PAYLOAD', JSON.stringify(first))
    assert(first.tool === 'pixmint', 'tool mismatch')
    assert(first.type === 'other', 'type mismatch')
    assert(first.content.includes('E2E 反馈'), 'content mismatch')
    assert(typeof first.version === 'string' && first.version.length > 0, 'version missing')
    assert(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        first.request_id
      ),
      'request_id is not a UUID'
    )
    assert(typeof first.platform === 'string', 'platform missing')
    assert(typeof first.os_version === 'string', 'os_version missing')
    assert(typeof first.arch === 'string', 'arch missing')
    assert(requests.attachments.length === 2, 'expected two attachment requests')
    for (const body of requests.attachments) {
      assert(body.includes(Buffer.from('name="file"')), 'attachment field name mismatch')
    }

    const queueResult = await win.evaluate(
      async (requestId) =>
        window.snapglass.feedback.submit({
          content: 'E2E 离线队列重试',
          requestId,
          attachments: []
        }),
      queueRequestId
    )
    console.log('FEEDBACK_QUEUE_FIRST', JSON.stringify(queueResult))
    assert(queueResult.status === 'queued', '503 response did not enter queue')
    const queueFile = path.join(userData, 'feedback-queue.json')
    assert(existsSync(queueFile), 'offline queue file was not written')
    const queuedFile = JSON.parse(readFileSync(queueFile, 'utf8'))
    assert(
      queuedFile.items.some((item) => item.requestId === queueRequestId),
      'queued request id missing from queue file'
    )
    await new Promise((resolve) => setTimeout(resolve, 3200))
    const queueAttempts = requests.feedback.filter(
      (item) => item.request_id === queueRequestId
    )
    console.log('FEEDBACK_QUEUE_ATTEMPTS', queueAttempts.length)
    assert(queueAttempts.length === 2, 'queued feedback was not retried after two seconds')
    const clearedQueue = JSON.parse(readFileSync(queueFile, 'utf8'))
    assert(clearedQueue.items.length === 0, 'successful queued feedback was not removed')

    const beforeRejected = requests.feedback.length
    const rejected = await win.evaluate(
      async (requestId) =>
        window.snapglass.feedback.submit({
          content: 'E2E 400 不重试',
          requestId,
          attachments: []
        }),
      rejectedRequestId
    )
    console.log('FEEDBACK_REJECTED', JSON.stringify(rejected))
    assert(rejected.status === 'rejected', '400 response was not rejected')
    await new Promise((resolve) => setTimeout(resolve, 2400))
    assert(
      requests.feedback.length === beforeRejected + 1,
      '400 response was retried unexpectedly'
    )

    await win.locator('.result-actions .button-secondary').click()
    await win.waitForSelector('.feedback-form')
    await win.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 16
      const context = canvas.getContext('2d')
      context.fillStyle = '#0285ff'
      context.fillRect(0, 0, 16, 16)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      const transfer = new DataTransfer()
      for (let index = 0; index < 12; index += 1) {
        transfer.items.add(
          new File([blob], `small-${index + 1}.png`, { type: 'image/png' })
        )
      }
      document.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true
        })
      )
    })
    await win.waitForFunction(() => document.querySelectorAll('.thumbnail').length === 10)
    console.log('FEEDBACK_CAP', await win.locator('.thumbnail').count())
    assert(
      (await win.locator('.thumbnail').count()) === 10,
      'pasting twelve screenshots did not cap at ten'
    )

    await win.reload()
    await win.waitForSelector('.feedback-root')
    const largeSize = await win.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 1800
      canvas.height = 1800
      const context = canvas.getContext('2d')
      const pixels = context.createImageData(canvas.width, canvas.height)
      for (let index = 0; index < pixels.data.length; index += 4) {
        pixels.data[index] = Math.floor(Math.random() * 256)
        pixels.data[index + 1] = Math.floor(Math.random() * 256)
        pixels.data[index + 2] = Math.floor(Math.random() * 256)
        pixels.data[index + 3] = 255
      }
      context.putImageData(pixels, 0, 0)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      const transfer = new DataTransfer()
      transfer.items.add(new File([blob], 'large.png', { type: 'image/png' }))
      document.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true
        })
      )
      return blob.size
    })
    console.log('FEEDBACK_LARGE_INPUT', largeSize)
    assert(largeSize > 5 * 1024 * 1024, 'large-image fixture did not exceed five megabytes')
    await win.locator('#feedback-content').fill('E2E 大图自动压缩')
    await win.locator('button.button-primary').click()
    await win.waitForSelector('.feedback-result', { timeout: 20000 })
    assert(requests.attachments.length === 3, 'compressed screenshot was not uploaded')
    const compressedBody = requests.attachments[2]
    console.log('FEEDBACK_LARGE_UPLOAD_BYTES', compressedBody.length)
    assert(
      compressedBody.length < 5 * 1024 * 1024 + 32 * 1024,
      'compressed attachment still exceeds five megabytes'
    )

    assert(errors.length === 0, `renderer errors: ${JSON.stringify(errors)}`)
    console.log('E2E_FEEDBACK_OK')
  } finally {
    await app.close().catch(() => {})
    server.close()
    rmSync(userData, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error('E2E_FEEDBACK_FAILED', error)
  server.close()
  process.exit(1)
})

