const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
// 钉图窗口在图片上方预留的操作条高度，与 src/main/windows/pin.ts 保持一致
const ACTION_BAR_HEIGHT = 34
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function selectRegion(overlay, start, end) {
  await overlay.waitForSelector('.overlay-root', { timeout: 10000 })
  await overlay.bringToFront()
  await overlay.evaluate(() => window.focus())
  await overlay.mouse.move(start.x, start.y)
  await overlay.mouse.down()
  await overlay.mouse.move(end.x, end.y, { steps: 8 })
  await overlay.mouse.up()
  await overlay.waitForSelector('.tooldock', { timeout: 8000 })
}

async function pinSelection(app, overlay) {
  const pinPromise = app.waitForEvent('window', { timeout: 10000 }).catch(() => null)
  await overlay.locator('.act[data-action="pin"]').click()
  const eventWindow = await pinPromise
  const windows = app.windows()
  const pinWindow = eventWindow ?? windows[windows.length - 1]
  await pinWindow.waitForSelector('.pin-root', { timeout: 8000 })
  await pinWindow.waitForSelector('.pin-image', { timeout: 8000 })
  return pinWindow
}

/** 钉图改为手动 OCR：先点右上角"识别文字"，再等文字层。 */
async function triggerPinOcr(pinWindow) {
  await pinWindow.locator('.pin-actions button[title="识别文字"]').click()
}

async function runTextSelection(app, overlay) {
  await selectRegion(overlay, { x: 400, y: 300 }, { x: 1500, y: 780 })
  const pinWindow = await pinSelection(app, overlay)
  try {
    await triggerPinOcr(pinWindow)
    await pinWindow.waitForSelector('.pin-text-line', { timeout: 20000 })
  } catch (error) {
    const state = await pinWindow
      .locator('.pin-root')
      .getAttribute('data-pin-text-state')
      .catch(() => null)
    const status = await pinWindow
      .locator('.pin-text-status')
      .innerText()
      .catch(() => '')
    await pinWindow.screenshot({
      path: path.join(PROJECT, 'test-results', 'pin-text-timeout.png')
    })
    console.error('PIN_TEXT_TIMEOUT_STATE', state, status)
    throw error
  }
  const layerText = (await pinWindow.locator('.pin-text-layer').innerText()).replace(/\s+/g, '')
  console.log('PIN_TEXT_LAYER', layerText)
  if (!layerText.includes('你好世界')) {
    throw new Error('pin text layer did not contain the OCR fixture text')
  }

  const lineBox = await pinWindow.locator('.pin-text-line').first().boundingBox()
  if (!lineBox) throw new Error('pin text line has no bounding box')
  await pinWindow.mouse.move(lineBox.x + 2, lineBox.y + lineBox.height / 2)
  await pinWindow.mouse.down()
  await pinWindow.mouse.move(
    lineBox.x + Math.max(4, lineBox.width - 2),
    lineBox.y + lineBox.height / 2,
    { steps: 8 }
  )
  await pinWindow.mouse.up()
  await sleep(120)
  const mouseSelected = await pinWindow.evaluate(
    () => window.getSelection()?.toString() ?? ''
  )
  console.log('PIN_TEXT_MOUSE_SELECTION', mouseSelected)
  if (!mouseSelected.trim()) throw new Error('mouse drag did not select pin text')
  await pinWindow.screenshot({
    path: path.join(PROJECT, 'test-results', 'pin-text-selection.png')
  })
  await pinWindow.mouse.dblclick(
    lineBox.x + lineBox.width / 2,
    lineBox.y + lineBox.height / 2
  )
  await sleep(120)
  const doubleClickSelected = await pinWindow.evaluate(
    () => window.getSelection()?.toString() ?? ''
  )
  console.log('PIN_TEXT_DOUBLE_CLICK', doubleClickSelected)
  if (!doubleClickSelected.trim()) throw new Error('double click did not select pin text')

  await pinWindow.keyboard.press('Control+A')
  await sleep(120)
  const selectedAll = await pinWindow.evaluate(
    () => window.getSelection()?.toString() ?? ''
  )
  console.log('PIN_TEXT_SELECT_ALL', selectedAll)
  if (!selectedAll.replace(/\s+/g, '').includes('你好世界')) {
    throw new Error('Ctrl+A did not select all pin text')
  }

  await pinWindow.keyboard.press('Control+C')
  await sleep(250)
  const clipboardText = await app.evaluate(({ clipboard }) => clipboard.readText())
  console.log('PIN_TEXT_CLIPBOARD', clipboardText)
  if (clipboardText.replace(/\s+/g, '') !== selectedAll.replace(/\s+/g, '')) {
    throw new Error('Ctrl+C did not copy the selected pin text')
  }

  await pinWindow.keyboard.press('Space')
  await pinWindow.waitForSelector('.pin-edit-toolbar .tooldock', { timeout: 8000 })
  await pinWindow.locator('.pin-edit-toolbar .act[data-action="confirm"]').click()
  await pinWindow.waitForSelector('.pin-edit-toolbar', { state: 'detached', timeout: 8000 })
  // 编辑后文字层会清空，需要再次手动识别
  await triggerPinOcr(pinWindow)
  await pinWindow.waitForSelector('.pin-text-line', { timeout: 12000 })
  const textAfterEdit = (await pinWindow.locator('.pin-text-layer').innerText()).replace(
    /\s+/g,
    ''
  )
  console.log('PIN_TEXT_AFTER_EDIT', textAfterEdit)
  if (!textAfterEdit.includes('你好世界')) {
    throw new Error('pin text layer was not rebuilt after editing')
  }

  const imageBeforeZoom = await pinWindow.locator('.pin-image').boundingBox()
  const lineBeforeZoom = await pinWindow.locator('.pin-text-line').first().boundingBox()
  if (!imageBeforeZoom || !lineBeforeZoom) throw new Error('zoom test boxes are missing')
  await pinWindow.mouse.move(
    imageBeforeZoom.x + imageBeforeZoom.width / 2,
    imageBeforeZoom.y + imageBeforeZoom.height / 2
  )
  await pinWindow.mouse.wheel(0, -120)
  await sleep(500)
  const imageAfterZoom = await pinWindow.locator('.pin-image').boundingBox()
  const lineAfterZoom = await pinWindow.locator('.pin-text-line').first().boundingBox()
  if (!imageAfterZoom || !lineAfterZoom) throw new Error('zoom result boxes are missing')
  const relativeLine = (image, line) => ({
    x: (line.x - image.x) / image.width,
    y: (line.y - image.y) / image.height
  })
  const beforeRelative = relativeLine(imageBeforeZoom, lineBeforeZoom)
  const afterRelative = relativeLine(imageAfterZoom, lineAfterZoom)
  console.log('PIN_TEXT_ZOOM', {
    imageBeforeZoom,
    imageAfterZoom,
    beforeRelative,
    afterRelative
  })
  if (
    Math.abs(beforeRelative.x - afterRelative.x) > 0.03 ||
    Math.abs(beforeRelative.y - afterRelative.y) > 0.03
  ) {
    throw new Error('pin text layer drifted after zoom')
  }

  await pinWindow.locator('.pin-actions button[title="关闭"]').click()
  await sleep(400)
}

async function runShortSelection(app, overlay) {
  await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
  await sleep(700)
  await selectRegion(overlay, { x: 400, y: 300 }, { x: 700, y: 314 })
  const pinWindow = await pinSelection(app, overlay)
  const imageBox = await pinWindow.locator('.pin-image').boundingBox()
  const natural = await pinWindow.locator('.pin-image').evaluate((image) => ({
    width: image.naturalWidth,
    height: image.naturalHeight
  }))
  const objectFit = await pinWindow
    .locator('.pin-image')
    .evaluate((image) => getComputedStyle(image).objectFit)
  const bounds = await app.evaluate(({ BrowserWindow }) => {
    const candidate = BrowserWindow.getAllWindows().find(
      (window) => window.isVisible() && window.webContents.getURL().includes('pin')
    )
    return candidate ? candidate.getBounds() : null
  })
  console.log('PIN_TEXT_SHORT', { imageBox, natural, objectFit, bounds })
  if (!imageBox || !bounds) throw new Error('short pin window is missing')
  if (objectFit !== 'contain') throw new Error('pin image must use object-fit: contain')
  if (bounds.height >= 80 + ACTION_BAR_HEIGHT) {
    throw new Error('short pin window is still stretched')
  }
  const displayedRatio = imageBox.width / imageBox.height
  const naturalRatio = natural.width / natural.height
  if (Math.abs(displayedRatio - naturalRatio) > 0.05) {
    throw new Error('short pin image ratio does not match the source image')
  }
  await pinWindow.screenshot({
    path: path.join(PROJECT, 'test-results', 'pin-short-selection.png')
  })
  await pinWindow.locator('.pin-actions button[title="关闭"]').click()
}

async function runPinStress(app, overlay) {
  const memoryKb = () =>
    app.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .reduce((total, metric) => total + (metric.memory.privateBytes ?? 0), 0)
    )
  const beforeKb = await memoryKb()
  for (let index = 0; index < 30; index += 1) {
    await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
    await sleep(350)
    const startX = 400 + (index % 8) * 8
    const startY = 430 + (index % 5) * 6
    await selectRegion(
      overlay,
      { x: startX, y: startY },
      { x: startX + 360 + index, y: startY + 100 + index }
    )
    const pinWindow = await pinSelection(app, overlay)
    await triggerPinOcr(pinWindow).catch(() => undefined)
    await pinWindow
      .waitForSelector('.pin-text-line', { timeout: 4000 })
      .catch(() => undefined)
    await app.evaluate(({ BrowserWindow }) => {
      const pin = BrowserWindow.getAllWindows().find(
        (window) => window.isVisible() && window.webContents.getURL().includes('pin')
      )
      pin?.close()
    })
    console.log('PIN_TEXT_STRESS_ITERATION', index + 1)
    await sleep(200)
  }
  await sleep(1000)
  const afterKb = await memoryKb()
  const growthMB = (afterKb - beforeKb) / 1024
  console.log('PIN_TEXT_STRESS', { iterations: 30, beforeKb, afterKb, growthMB })
  if (growthMB > 32) {
    throw new Error(`pin stress private memory grew ${growthMB.toFixed(1)}MB`)
  }
}

async function runOcrFailure(app, overlay) {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('pin:recognize-text')
    ipcMain.handle('pin:recognize-text', () => {
      throw new Error('mock pin OCR failure')
    })
  })
  await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
  await sleep(350)
  await selectRegion(overlay, { x: 420, y: 440 }, { x: 900, y: 560 })
  const pinWindow = await pinSelection(app, overlay)
  await triggerPinOcr(pinWindow)
  await pinWindow.waitForSelector('.pin-text-status', { timeout: 8000 })
  const status = await pinWindow.locator('.pin-text-status').innerText()
  console.log('PIN_TEXT_FAILURE_STATUS', status)
  if (!status.includes('文字识别不可用')) {
    throw new Error('pin OCR failure did not show the fallback status')
  }
  await pinWindow.locator('.pin-actions button[title="复制"]').click()
  await sleep(300)
  const clipboardHasImage = await app.evaluate(({ clipboard }) => !clipboard.readImage().isEmpty())
  console.log('PIN_TEXT_FAILURE_COPY_IMAGE', clipboardHasImage)
  if (!clipboardHasImage) throw new Error('pin image copy failed after OCR error')
  await app.evaluate(({ BrowserWindow }) => {
    const pin = BrowserWindow.getAllWindows().find(
      (window) => window.isVisible() && window.webContents.getURL().includes('pin')
    )
    pin?.close()
  })
}

;(async () => {
  // 从 electron-as-node 启动时，子进程不能继承这个变量，否则会变成 node 而不是应用
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay-ocr'],
    cwd: PROJECT,
    env: childEnv
  })
  try {
    const overlay = await app.firstWindow()
    await overlay.waitForSelector('.overlay-root', { timeout: 15000 })
    await runTextSelection(app, overlay)
    await runShortSelection(app, overlay)
    await runPinStress(app, overlay)
    await runOcrFailure(app, overlay)
    console.log('PIN_TEXT_E2E_OK')
    await app.close()
    process.exit(0)
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
})().catch((error) => {
  console.error('PIN_TEXT_E2E_FAIL', error)
  process.exit(1)
})
