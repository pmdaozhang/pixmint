const { _electron: electron } = require('playwright-core')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')

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
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`timeout waiting for ${selector}`)
}

async function selectRegion(window, x1, y1, x2, y2) {
  await window.mouse.move(x1, y1)
  await window.mouse.down()
  await window.mouse.move(x2, y2, { steps: 6 })
  await window.mouse.up()
  await window.waitForSelector('.tooldock', { timeout: 8000 })
}

async function boundsByHash(app, hash) {
  return app.evaluate(({ BrowserWindow }, target) => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes(target)
    )
    return window ? window.getBounds() : null
  }, hash)
}

async function recordOverlay(app, mode) {
  await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
  const overlay = await waitForWindow(app, '.overlay-root')
  await overlay.waitForSelector('.overlay-root', { timeout: 8000 })
  await selectRegion(overlay, 140, 120, 740, 500)
  const selectionBox = await overlay.locator('.selection').boundingBox()

  const entry = mode === 'gif' ? '[title="录制 GIF"]' : '[title="录制视频"]'
  await overlay.locator(entry).click()
  await overlay.waitForSelector('.rec-ctrl', { timeout: 4000 })
  await overlay.locator('.rec-start').click()

  const control = await waitForWindow(app, '.rec-control', 15000)
  await control.waitForSelector('.rec-control .cb.stop', { timeout: 15000 })
  const liveFrame = await overlay.locator('.recording-frame.recording').isVisible()
  const liveBadge = (await overlay.locator('.recording-badge.live').innerText()).replace(/\s+/g, ' ')
  console.log('RECORDING_FRAME_VISIBLE', liveFrame, 'BADGE', liveBadge)
  if (!liveFrame) throw new Error('recording frame disappeared after recording started')
  if (!liveBadge.includes('REC')) throw new Error('recording badge is not showing REC')
  const overlayBounds = await boundsByHash(app, 'overlay')
  const controlBounds = await boundsByHash(app, 'recorder-control')
  if (!selectionBox || !overlayBounds || !controlBounds) {
    throw new Error('missing bounds for recording bar centering check')
  }
  const expectedCenter = overlayBounds.x + selectionBox.x + selectionBox.width / 2
  const actualCenter = controlBounds.x + controlBounds.width / 2
  console.log('RECORD_BAR_CENTER', actualCenter, expectedCenter, controlBounds)
  if (Math.abs(actualCenter - expectedCenter) > 4) {
    throw new Error('recording bar is not horizontally centered on the selection')
  }
  console.log('CONTROL_TEXT', (await control.locator('.rec-control').innerText()).replace(/\s+/g, ' '))
  console.log('STOP_COUNT', await control.locator('.rec-control .cb.stop').count())
  const toastCount = await overlay.locator('.overlay-toast').count()
  console.log(
    'OVERLAY_TOAST',
    toastCount ? await overlay.locator('.overlay-toast').innerText() : ''
  )
  console.log('OVERLAY_SETUP_COUNT', await overlay.locator('.gif-setup').count())
  await new Promise((resolve) => setTimeout(resolve, 1600))
  await control.locator('.rec-control .cb.stop').click()

  const preview = await waitForWindow(app, '.preview-card', 30000)
  await preview.waitForSelector('.preview-card', { timeout: 5000 })
  const overlayActiveDuringPreview = await app.evaluate(
    () => globalThis.__snapglassOverlayActive?.()
  )
  console.log('OVERLAY_ACTIVE_DURING_PREVIEW', overlayActiveDuringPreview)
  if (overlayActiveDuringPreview) {
    throw new Error('overlay should be inactive when the result card is open')
  }
  const title = (await preview.locator('.preview-head strong').innerText()).trim()
  const fileName = await preview.locator('.preview-name').innerText()
  const meta = await preview.locator('.preview-meta').innerText()
  const sub = await preview.locator('.preview-sub').innerText()
  console.log('PREVIEW', mode, title, fileName)
  console.log('PREVIEW_META', meta.replace(/\s+/g, ' '))
  if (title !== '录制完成') throw new Error(`${mode} result title is wrong`)
  if (!fileName) throw new Error(`${mode} result file name is missing`)
  if (mode === 'gif') {
    const displaySrc = await preview.locator('.preview-thumb img').getAttribute('src')
    if (
      !displaySrc ||
      (!displaySrc.startsWith('snapglass-media://') && !displaySrc.startsWith('blob:'))
    ) {
      throw new Error('GIF result should play the animated media preview')
    }
    const thumb = await preview.evaluate(async () => {
      const info = await window.snapglass.recorderPreview.ready()
      return info?.thumbnailUrl ?? ''
    })
    if (!thumb.startsWith('data:image/png')) {
      throw new Error('GIF first-frame thumbnail is missing')
    }
    const edgeStats = await preview.evaluate(async (src) => {
      const image = new Image()
      image.src = src
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data
      const width = canvas.width
      const height = canvas.height
      const isRed = (r, g, b) => r > 220 && g < 110 && b < 100
      let total = 0
      let red = 0
      const sample = (x, y) => {
        const index = (y * width + x) * 4
        total += 1
        if (isRed(data[index], data[index + 1], data[index + 2])) red += 1
      }
      for (let x = 0; x < width; x += 1) {
        sample(x, 0)
        sample(x, 1)
        sample(x, height - 2)
        sample(x, height - 1)
      }
      for (let y = 2; y < height - 2; y += 1) {
        sample(0, y)
        sample(1, y)
        sample(width - 2, y)
        sample(width - 1, y)
      }
      return { total, red, ratio: red / total, width, height }
    }, thumb)
    console.log('GIF_EDGE_RED', edgeStats)
    if (edgeStats.ratio > 0.5) {
      throw new Error('recording frame leaked into GIF edge pixels')
    }
  } else {
    const thumbText = await preview.locator('.preview-thumb').innerText()
    if (!thumbText.includes('MP4') && !thumbText.includes('WEBM')) {
      throw new Error('video result thumbnail label is missing')
    }
  }

  const extension = sub.split('·')[0].trim().toLowerCase()
  const savePath = path.join(os.tmpdir(), `snapglass-e2e-${mode}.${extension}`)
  const sourcePath = await preview.evaluate(async () => {
    const info = await window.snapglass.recorderPreview.ready()
    return info?.filePath ?? ''
  })
  console.log('PREVIEW_SOURCE', sourcePath)
  if (mode === 'gif') {
    const gifInfo = await preview.evaluate(async () => {
      const info = await window.snapglass.recorderPreview.ready()
      return {
        note: info?.note,
        sizeBytes: info?.sizeBytes,
        fps: info?.fps,
        frameCount: info?.frameCount
      }
    })
    console.log('GIF_PREVIEW_INFO', gifInfo)
    if (!gifInfo.frameCount || gifInfo.frameCount <= 1) {
      throw new Error('GIF should contain more than one frame')
    }
  }
  try {
    fs.unlinkSync(savePath)
  } catch {
    // ignore
  }
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
  }, savePath)
  await preview.locator('.preview-actions .preview-btn').first().click()
  const started = Date.now()
  while (Date.now() - started < 8000 && !fs.existsSync(savePath)) {
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  const size = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0
  console.log('SAVED', mode, extension, size)
  if (!fs.existsSync(savePath) || size <= 0) {
    throw new Error(`${mode} save did not produce a file`)
  }
  if (sourcePath && fs.existsSync(sourcePath)) {
    throw new Error(`${mode} source file still exists after save`)
  }
  await preview.locator('.preview-close').click()
  await new Promise((resolve) => setTimeout(resolve, 500))
  if (!fs.existsSync(savePath) || fs.statSync(savePath).size <= 0) {
    throw new Error(`${mode} saved file was deleted when closing the result card`)
  }
  fs.unlinkSync(savePath)
}

async function testPrepareCancel(app) {
  await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
  const overlay = await waitForWindow(app, '.overlay-root')
  await overlay.waitForSelector('.overlay-root', { timeout: 8000 })
  await selectRegion(overlay, 160, 140, 560, 400)
  await overlay.locator('[title="录制 GIF"]').click()
  await overlay.waitForSelector('.rec-ctrl', { timeout: 4000 })
  await overlay.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    window.__restoreGetUserMedia = () => {
      navigator.mediaDevices.getUserMedia = original
    }
    navigator.mediaDevices.getUserMedia = () => new Promise(() => {})
  })
  await overlay.locator('.rec-start').click()
  const control = await waitForWindow(app, '.rec-control.preparing', 8000)
  await control.waitForSelector('.rec-control.preparing .cb', { timeout: 5000 })
  const frozenImageCount = await overlay.locator('.overlay-screen').count()
  const preparingFrameCount = await overlay.locator('.recording-frame').count()
  const preparingDimCount = await overlay.locator('.recording-dim').count()
  const frameOutline = await overlay
    .locator('.recording-frame')
    .evaluate((element) => getComputedStyle(element).outlineColor)
  console.log(
    'PREPARE_CHROME',
    frozenImageCount,
    preparingFrameCount,
    preparingDimCount,
    frameOutline
  )
  // 准备阶段保持冻结画面、红框和遮罩，避免开始录制时桌面闪一下。
  if (frozenImageCount !== 1 || preparingFrameCount !== 1 || preparingDimCount !== 4) {
    throw new Error('preparing state should keep frozen image, frame and dim mask')
  }
  if (frameOutline !== 'rgb(255, 69, 58)') {
    throw new Error(`preparing frame should use full red outline, got ${frameOutline}`)
  }
  await control.locator('.rec-control.preparing .cb').click()
  await overlay.waitForSelector('.tooldock', { timeout: 5000 })
  const cancelledFrameCount = await overlay.locator('.recording-frame').count()
  const restoredImageCount = await overlay.locator('.overlay-screen').count()
  console.log(
    'PREPARE_CANCEL_RESTORED',
    cancelledFrameCount === 0,
    restoredImageCount === 1
  )
  if (cancelledFrameCount !== 0 || restoredImageCount !== 1) {
    throw new Error('cancel did not restore the annotation view')
  }
  await overlay.evaluate(() => window.__restoreGetUserMedia?.())
}

async function recordFullScreenVideo(app) {
  await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
  const overlay = await waitForWindow(app, '.overlay-root')
  await overlay.waitForSelector('.overlay-root', { timeout: 8000 })
  const viewport = await overlay.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))
  await overlay.mouse.move(1, 1)
  await overlay.mouse.down()
  await overlay.mouse.move(viewport.width - 1, viewport.height - 1, { steps: 10 })
  await overlay.mouse.up()
  await overlay.waitForSelector('.tooldock', { timeout: 8000 })
  const selection = await overlay.locator('.selection').boundingBox()
  console.log('FULLSCREEN_SELECTION', viewport, selection)
  await overlay.locator('[title="录制视频"]').click()
  await overlay.waitForSelector('.rec-ctrl', { timeout: 4000 })
  await overlay.locator('.rec-start').click()

  const control = await waitForWindow(app, '.rec-control', 15000)
  await control.waitForSelector('.rec-control .cb.stop', { timeout: 15000 })
  console.log(
    'FULLSCREEN_CONTROL_VISIBLE',
    await control.locator('.rec-control.live').isVisible()
  )
  await new Promise((resolve) => setTimeout(resolve, 1600))
  await control.locator('.rec-control .cb.stop').click()

  const preview = await waitForWindow(app, '.preview-card', 30000)
  await preview.waitForSelector('.preview-card', { timeout: 5000 })
  const fileName = await preview.locator('.preview-name').innerText()
  console.log('FULLSCREEN_VIDEO_DONE', fileName)
  await preview.locator('.preview-close').click()
}

async function testF1AfterRecording(app) {
  await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
  const overlay = await waitForWindow(app, '.overlay-root')
  await overlay.waitForSelector('.overlay-root', { timeout: 8000 })
  await selectRegion(overlay, 180, 160, 620, 420)
  await overlay.locator('[title="录制 GIF"]').click()
  await overlay.waitForSelector('.rec-ctrl', { timeout: 4000 })
  await overlay.locator('.rec-start').click()
  const control = await waitForWindow(app, '.rec-control', 15000)
  await control.waitForSelector('.rec-control .cb.stop', { timeout: 15000 })
  await new Promise((resolve) => setTimeout(resolve, 1000))
  await control.locator('.rec-control .cb.stop').click()
  const preview = await waitForWindow(app, '.preview-card', 30000)
  await preview.waitForSelector('.preview-card', { timeout: 5000 })

  await app.evaluate(() => globalThis.__snapglassStartCapture?.())
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const overlayVisible = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (window) =>
        window.webContents.getURL().includes('overlay') && window.isVisible()
    )
  )
  const previewClosed = preview.isClosed()
  console.log('F1_AFTER_RECORDING', overlayVisible, previewClosed)
  if (!overlayVisible || !previewClosed) {
    throw new Error('first F1 after recording did not start a new capture')
  }
}

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  app.process().stdout?.on('data', (data) => console.log('MAIN', String(data).trim()))
  app.process().stderr?.on('data', (data) => console.log('MAIN_ERR', String(data).trim()))
  app.on('window', (window) => {
    window.on('pageerror', (error) => console.log('PAGEERROR', error.message))
    window.on('console', (message) => {
      console.log('CONSOLE', message.type(), message.text())
    })
  })
  for (const window of app.windows()) {
    window.on('pageerror', (error) => console.log('PAGEERROR', error.message))
    window.on('console', (message) => console.log('CONSOLE', message.type(), message.text()))
  }
  try {
    await waitForWindow(app, '.overlay-root')
    await recordOverlay(app, 'gif')
    await recordOverlay(app, 'video')
    await recordFullScreenVideo(app)
    await testF1AfterRecording(app)
    await testPrepareCancel(app)
    console.log('RECORDING_E2E_OK')
    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('RECORDING_E2E_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
