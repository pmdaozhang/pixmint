const { _electron: electron } = require('playwright-core')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const FIXTURE = path.join(PROJECT, 'scripts', 'long-capture-fixture.cjs')
const SELECTION = { x: 100, y: 138, width: 700, height: 535 }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function intersects(a, b) {
  return !(
    a.x + a.width <= b.x ||
    a.x >= b.x + b.width ||
    a.y + a.height <= b.y ||
    a.y >= b.y + b.height
  )
}

function spawnFixture(extraEnv = {}) {
  const fixture = spawn(ELECTRON, [FIXTURE], {
    stdio: 'ignore',
    env: { ...process.env, ...extraEnv }
  })
  fixture.on('error', (error) => console.error('FIXTURE_ERROR', error.message))
  return fixture
}

async function waitForWindow(app, selector, timeout = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    for (const window of app.windows()) {
      try {
        if ((await window.locator(selector).count()) > 0) return window
      } catch {
        // window may be closing
      }
    }
    await sleep(200)
  }
  throw new Error(`timeout waiting for ${selector}`)
}

async function countWindowsByUrl(app, fragment) {
  return app.evaluate(
    ({ BrowserWindow }, target) =>
      BrowserWindow.getAllWindows().filter(
        (candidate) =>
          !candidate.isDestroyed() &&
          candidate.webContents.getURL().includes(target)
      ).length,
    fragment
  )
}

async function showOverlay(app) {
  const active = await app.evaluate(() => globalThis.__snapglassOverlayActive?.())
  if (!active) {
    await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
  }
  const overlay = await waitForWindow(app, '.overlay-root', 15000)
  await overlay.waitForSelector('.overlay-root', { timeout: 8000 })
  await overlay.waitForFunction(() => document.visibilityState === 'visible', undefined, {
    timeout: 10000
  })
  await overlay.bringToFront()
  await overlay.evaluate(() => window.focus())
  await sleep(800)
  return overlay
}

async function selectRegion(overlay) {
  await overlay.mouse.move(SELECTION.x, SELECTION.y)
  await overlay.mouse.down()
  await overlay.mouse.move(
    SELECTION.x + SELECTION.width,
    SELECTION.y + SELECTION.height,
    { steps: 8 }
  )
  await overlay.mouse.up()
  await overlay.waitForSelector('.tooldock', { timeout: 8000 })
  const selected = await overlay.locator('.selection').boundingBox()
  if (
    !selected ||
    Math.abs(selected.x - SELECTION.x) > 2 ||
    Math.abs(selected.y - SELECTION.y) > 2 ||
    Math.abs(selected.width - SELECTION.width) > 2 ||
    Math.abs(selected.height - SELECTION.height) > 2
  ) {
    throw new Error(`selection mismatch: ${JSON.stringify(selected)}`)
  }
}

async function startLongCapture(app) {
  const overlay = await showOverlay(app)
  await selectRegion(overlay)
  const longButton = overlay.locator('.tb[title="长截图"]')
  if ((await longButton.count()) !== 1) {
    throw new Error('long screenshot toolbar entry is missing')
  }
  await longButton.click()

  const hud = await waitForWindow(app, '.hud-card', 15000)
  await hud.waitForSelector('.hud-card', { timeout: 5000 })
  const hudBounds = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) =>
        !candidate.isDestroyed() &&
        candidate.webContents.getURL().includes('long-capture-hud')
    )
    return window ? window.getBounds() : null
  })
  console.log('LONG_CAPTURE_HUD', hudBounds)
  if (!hudBounds) throw new Error('HUD window bounds are missing')
  if (intersects(hudBounds, SELECTION)) {
    throw new Error('HUD overlaps the capture selection')
  }
  const overlayActive = await app.evaluate(() => globalThis.__snapglassOverlayActive?.())
  console.log('LONG_CAPTURE_OVERLAY_ACTIVE', overlayActive)
  if (overlayActive) throw new Error('overlay should be hidden after starting long capture')
  return { overlay, hud }
}

async function waitForHudPhase(hud, text) {
  await hud.waitForFunction(
    (expected) =>
      document.querySelector('.hud-pill')?.textContent?.trim() === expected,
    text,
    { timeout: 8000 }
  )
}

async function finishWithPreview(app, hud) {
  const actions = hud.locator('.hud-actions button')
  await actions.nth(0).click()
  await waitForHudPhase(hud, '已暂停')
  console.log('LONG_CAPTURE_PAUSED')
  console.log('LONG_CAPTURE_HUD_ACTIONS', await hud.locator('.hud-actions').innerText())
  console.log('LONG_CAPTURE_HUD_VISIBILITY', await hud.evaluate(() => document.visibilityState))
  await sleep(600)
  await actions.nth(0).click({ force: true })
  await hud.waitForFunction(
    () => document.querySelector('.hud-pill')?.textContent?.trim() !== '已暂停',
    undefined,
    { timeout: 8000 }
  )
  await sleep(1400)
  await actions.nth(1).click({ force: true })

  const preview = await waitForWindow(app, '.long-preview-root', 30000)
  await preview.waitForSelector('.long-preview-root', { timeout: 8000 })
  await preview.waitForFunction(
    () => {
      const image = document.querySelector('.long-preview-content img')
      return Boolean(image && image.complete && image.naturalWidth > 0)
    },
    undefined,
    { timeout: 15000 }
  )
  const footer = (await preview.locator('.long-preview-footer').innerText()).replace(
    /\s+/g,
    ' '
  )
  const image = await preview.locator('.long-preview-content img').evaluate((element) => ({
    width: element.naturalWidth,
    height: element.naturalHeight,
    src: element.src
  }))
  console.log('LONG_CAPTURE_PREVIEW', footer, image)
  if (image.width !== SELECTION.width || image.height < 500) {
    throw new Error('preview image size is invalid')
  }
  if (!image.src.startsWith('snapglass-media://')) {
    throw new Error('preview image is not loaded from snapglass-media')
  }
  if (!footer.includes(`${image.width} × ${image.height}`)) {
    throw new Error('preview footer does not match image size')
  }
  return { preview, image }
}

async function testPreviewActions(app, preview, image) {
  const zoom = preview.locator('.long-preview-zoom')
  const initialZoom = (await zoom.innerText()).trim()
  await preview.locator('[aria-label="放大"]').click()
  await sleep(150)
  const zoomed = (await zoom.innerText()).trim()
  console.log('LONG_CAPTURE_ZOOM', initialZoom, zoomed)
  if (zoomed === initialZoom) throw new Error('zoom in did not change the preview scale')
  await preview.locator('[aria-label="缩小"]').click()
  await sleep(150)
  if ((await zoom.innerText()).trim() !== initialZoom) {
    throw new Error('zoom out did not restore the preview scale')
  }

  await preview.getByRole('button', { name: '复制' }).click()
  await preview.waitForFunction(
    () => document.querySelector('.long-preview-footer')?.textContent?.includes('已复制'),
    undefined,
    { timeout: 5000 }
  )
  const clipboard = await app.evaluate(({ clipboard }) => {
    const value = clipboard.readImage()
    return { empty: value.isEmpty(), size: value.getSize() }
  })
  console.log('LONG_CAPTURE_CLIPBOARD', clipboard)
  if (
    clipboard.empty ||
    clipboard.size.width !== image.width ||
    clipboard.size.height !== image.height
  ) {
    throw new Error('clipboard image does not match the preview')
  }

  const savePath = path.join(os.tmpdir(), 'pixmint-long-e2e-save.png')
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
  }, savePath)
  await preview.locator('.long-preview-btn.primary').click()
  await preview.waitForFunction(
    () => document.querySelector('.long-preview-footer')?.textContent?.includes('已保存'),
    undefined,
    { timeout: 8000 }
  )
  const saved = await app.evaluate(({ nativeImage }, target) => {
    const value = nativeImage.createFromPath(target)
    return { empty: value.isEmpty(), size: value.getSize() }
  }, savePath)
  console.log('LONG_CAPTURE_SAVE', saved)
  if (
    saved.empty ||
    saved.size.width !== image.width ||
    saved.size.height !== image.height
  ) {
    throw new Error('saved PNG does not match the preview')
  }
  fs.unlinkSync(savePath)

  const info = await preview.evaluate(() => window.snapglass.longCapture.previewInfo())
  await preview.locator('.long-preview-close').click()
  await sleep(800)
  const previewCount = await countWindowsByUrl(app, 'long-capture-preview')
  if (previewCount !== 0) throw new Error('preview window did not close')
  if (!info?.filePath) throw new Error('preview temp file path is missing')
  if (fs.existsSync(info.filePath)) throw new Error('preview temp file was not cleaned up')
  console.log('LONG_CAPTURE_TEMP_CLEAN', info.filePath)
}

async function testCancel(app) {
  const { hud } = await startLongCapture(app)
  await hud.locator('.hud-actions button').nth(2).click({ force: true })
  await sleep(1200)
  const state = {
    preview: await countWindowsByUrl(app, 'long-capture-preview'),
    hud: await countWindowsByUrl(app, 'long-capture-hud'),
    overlay: await app.evaluate(() => globalThis.__snapglassOverlayActive?.())
  }
  console.log('LONG_CAPTURE_CANCEL', state)
  if (state.preview !== 0 || state.hud !== 0 || state.overlay) {
    throw new Error('cancel did not clean up HUD/preview/overlay')
  }
}

async function testUnscrollable(app, fixture) {
  fixture.kill()
  await sleep(800)
  fixture = spawnFixture({ PIXMINT_LONG_FIXTURE_UNSCROLLABLE: '1' })
  await sleep(2400)
  const { hud } = await startLongCapture(app)
  await hud.waitForSelector('.hud-card[data-tone="error"]', { timeout: 15000 })
  const message = await hud.locator('.hud-message').innerText()
  console.log('LONG_CAPTURE_UNSCROLLABLE', message.replace(/\s+/g, ' '))
  if (!message.includes('没有滚动')) {
    throw new Error('unscrollable window did not report a scroll error')
  }
  await hud.locator('.hud-actions button').nth(0).click({ force: true })
  await sleep(800)
  if ((await countWindowsByUrl(app, 'long-capture-hud')) !== 0) {
    throw new Error('unscrollable error HUD did not close')
  }
  fixture.kill()
  return fixture
}

;(async () => {
  let fixture = spawnFixture()
  let app = null
  try {
    await sleep(2400)
    app = await electron.launch({
      executablePath: ELECTRON,
      args: ['.', '--smoke-overlay'],
      cwd: PROJECT,
      env: { ...process.env }
    })
    app.process().stdout?.on('data', (data) => console.log('MAIN', String(data).trim()))
    app.process().stderr?.on('data', (data) => console.log('MAIN_ERR', String(data).trim()))

    const first = await app.firstWindow()
    first.on('pageerror', (error) => console.log('PAGEERROR', error.message))

    const { hud } = await startLongCapture(app)
    const { preview, image } = await finishWithPreview(app, hud)
    await testPreviewActions(app, preview, image)

    fixture.kill()
    await sleep(800)
    fixture = spawnFixture()
    await sleep(2400)
    await testCancel(app)

    fixture = await testUnscrollable(app, fixture)

    console.log('LONG_CAPTURE_E2E_OK')
    await app.close()
    fixture.kill()
    process.exit(0)
  } catch (error) {
    console.error('LONG_CAPTURE_E2E_FAIL', error)
    await app?.close().catch(() => {})
    fixture.kill()
    process.exit(1)
  }
})()
