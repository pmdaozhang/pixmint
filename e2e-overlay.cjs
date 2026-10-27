const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  app.process().stdout?.on('data', (data) => console.log('MAIN', String(data).trim()))
  app.process().stderr?.on('data', (data) => console.log('MAIN_ERR', String(data).trim()))
  const window = await app.firstWindow()
  await app.evaluate(({ clipboard }) => clipboard.clear())
  window.on('pageerror', (error) => console.log('PAGEERROR', error.message))
  window.on('console', (message) => {
    if (message.type() === 'error') console.log('CONSOLE_ERROR', message.text())
  })
  await window.waitForSelector('.overlay-root', { timeout: 15000 })
  // 预热窗口的 DOM 会先存在；等覆盖层真正显示后再开始拖选。
  await window.waitForTimeout(700)
  await window.waitForFunction(() => document.visibilityState === 'visible')
  await window.bringToFront()
  await window.evaluate(() => window.focus())
  const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  console.log(
    'VIEWPORT',
    viewport,
    'WINDOWS',
    app.windows().length,
    'DPR',
    await window.evaluate(() => devicePixelRatio)
  )

  let x1 = 120
  let y1 = 100
  // 选区宽度需大于工具栏宽度，才能验证“右边缘对齐”而不是触发左侧夹取。
  const x2 = Math.min(viewport.width - 120, 920)
  const y2 = Math.min(viewport.height - 140, 520)
  await window.mouse.move(x1, y1)
  await window.mouse.down()
  await window.mouse.move(x2, y2, { steps: 8 })
  await window.mouse.up()
  await window.waitForSelector('.tooldock', { timeout: 5000 })
  let selectedBox = await window.locator('.selection').boundingBox()
  console.log('SELECTED', selectedBox)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const toolbarBox = await window.locator('.tooldock').boundingBox()
  console.log('TOOLBAR_ALIGN', selectedBox, toolbarBox)
  if (
    !selectedBox ||
    !toolbarBox ||
    Math.abs(
      toolbarBox.x + toolbarBox.width - (selectedBox.x + selectedBox.width)
    ) > 4
  ) {
    throw new Error('toolbar is not right-aligned with the selection')
  }

  const moveToolClass = await window
    .locator('.tb[title="移动选区"]')
    .getAttribute('class')
  const shapeToolClass = await window
    .locator('.tb[title="矩形 / 椭圆"]')
    .getAttribute('class')
  const moveCursor = await window
    .locator('.anno-canvas')
    .evaluate((element) => getComputedStyle(element).cursor)
  const rootCursor = await window
    .locator('.overlay-root')
    .evaluate((element) => getComputedStyle(element).cursor)
  console.log(
    'DEFAULT_TOOL',
    moveToolClass,
    shapeToolClass,
    'CURSOR',
    moveCursor,
    'ROOT_CURSOR',
    rootCursor
  )
  if (!moveToolClass?.includes('on') || shapeToolClass?.includes('on')) {
    throw new Error('overlay should default to the move tool')
  }
  if (moveCursor !== 'grab') {
    throw new Error('move tool should use the grab cursor')
  }
  if (rootCursor !== 'default') {
    throw new Error('overlay outside the selection should not use the crosshair cursor')
  }

  const centerX = selectedBox.x + selectedBox.width / 2
  const centerY = selectedBox.y + selectedBox.height / 2
  await window.mouse.move(centerX, centerY)
  await window.mouse.down()
  await window.waitForTimeout(120)
  const draggingCursor = await window
    .locator('.anno-canvas')
    .evaluate((element) => getComputedStyle(element).cursor)
  const draggingRoot = await window.locator('.overlay-root').evaluate((element) => ({
    className: element.className,
    cursor: getComputedStyle(element).cursor
  }))
  console.log('DRAGGING_CURSOR', draggingCursor, 'DRAGGING_ROOT', draggingRoot)
  if (draggingCursor !== 'grabbing') {
    throw new Error('dragging the selection should use the grabbing cursor')
  }
  if (
    !draggingRoot.className.includes('dragging-selection') ||
    draggingRoot.cursor !== 'grabbing'
  ) {
    throw new Error('selection drag should keep the grabbing cursor on the overlay root')
  }
  await window.mouse.move(centerX + 40, centerY + 30, { steps: 6 })
  const movedCursor = await window.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x, y)
      return element ? getComputedStyle(element).cursor : null
    },
    [centerX + 40, centerY + 30]
  )
  console.log('MOVED_CURSOR', movedCursor)
  if (movedCursor !== 'grabbing') {
    throw new Error('moving the selection should not fall back to the arrow cursor')
  }
  await window.mouse.up()
  await window.waitForTimeout(120)
  const releasedCursor = await window
    .locator('.anno-canvas')
    .evaluate((element) => getComputedStyle(element).cursor)
  console.log('RELEASED_CURSOR', releasedCursor)
  if (releasedCursor !== 'grab') {
    throw new Error('releasing the selection should restore the grab cursor')
  }
  const movedBox = await window.locator('.selection').boundingBox()
  console.log('MOVE_SELECTION', selectedBox, movedBox)
  if (
    !movedBox ||
    Math.abs(movedBox.width - selectedBox.width) > 1 ||
    Math.abs(movedBox.height - selectedBox.height) > 1 ||
    Math.abs(movedBox.x - selectedBox.x - 40) > 2 ||
    Math.abs(movedBox.y - selectedBox.y - 30) > 2
  ) {
    throw new Error('move tool did not drag the selection without resizing it')
  }
  selectedBox = movedBox
  x1 = movedBox.x
  y1 = movedBox.y

  await window.locator('.tb[title="录制 GIF"]').click()
  await window.waitForSelector('.rec-ctrl', { timeout: 3000 })
  const toolbarWhileGif = await window.locator('.tooldock').count()
  const recBarBox = await window.locator('.rec-ctrl').boundingBox()
  console.log('GIF_TOOLBAR_HIDDEN', toolbarWhileGif === 0, 'REC_BAR', recBarBox)
  if (toolbarWhileGif !== 0) throw new Error('primary toolbar should hide when GIF setup opens')
  if (
    !recBarBox ||
    Math.abs(
      recBarBox.x + recBarBox.width / 2 - (selectedBox.x + selectedBox.width / 2)
    ) > 4
  ) {
    throw new Error('recording bar is not centered on the selection X axis')
  }
  const standbyBadge = await window.locator('.recording-badge').innerText()
  console.log('GIF_STANDBY_BADGE', standbyBadge.replace(/\s+/g, ' '))
  const startText = (await window.locator('.rec-start').innerText()).trim()
  const fpsSelectCount = await window.locator('.rec-select').count()
  console.log('REC_START_TEXT', JSON.stringify(startText), 'FPS_SELECT', fpsSelectCount)
  if (!standbyBadge.includes('待机') || !standbyBadge.includes('GIF')) {
    throw new Error('GIF standby badge is wrong')
  }
  if (!startText.includes('开始')) throw new Error('start button should contain 开始')
  if (fpsSelectCount !== 0) throw new Error('GIF fps selector should be removed')
  const standbyFrame = await window.locator('.recording-frame.standby').count()
  if (standbyFrame !== 1) throw new Error('standby recording frame is missing')
  await window.locator('.rec-ctrl .cb').click()
  await window.waitForSelector('.tooldock', { timeout: 3000 })

  await new Promise((resolve) => setTimeout(resolve, 500))
  const autoCopied = await app.evaluate(({ clipboard }) => !clipboard.readImage().isEmpty())
  console.log('AUTO_COPY', autoCopied)
  if (!autoCopied) throw new Error('selection was not copied automatically')
  const actionTexts = await window.locator('.row1 .act').allTextContents()
  const actionOrder = actionTexts.map((text) => text.trim()).slice(-4)
  console.log('ACTION_ORDER', actionOrder)
  if (actionOrder.join(',') !== '关闭,钉图,保存,复制') {
    throw new Error('toolbar action order is wrong')
  }
  console.log('ROW2_DEFAULT', await window.locator('.row2').count())

  await window.locator('.tb[title="线条 / 箭头"]').click()
  await window.waitForTimeout(150)
  console.log('ROW2_OPEN', await window.locator('.row2').count())
  console.log('DIVIDER_OPEN', await window.locator('.submenu-divider').count())
  await window.locator('.tb[title="线条 / 箭头"]').click()
  await window.waitForTimeout(150)
  console.log('ROW2_CLOSED', await window.locator('.row2').count())
  console.log('DIVIDER_CLOSED', await window.locator('.submenu-divider').count())
  await window.locator('.tb[title="线条 / 箭头"]').click()
  await window.waitForTimeout(150)
  const dividerWidth = await window.locator('.submenu-divider').evaluate((element) => {
    return element.getBoundingClientRect().width
  })
  const row1Width = await window.locator('.row1').evaluate((element) => {
    return element.getBoundingClientRect().width
  })
  const row2Width = await window.locator('.row2').evaluate((element) => {
    return element.getBoundingClientRect().width
  })
  console.log('DIVIDER_WIDTH', dividerWidth, row1Width, row2Width)
  if (dividerWidth < Math.max(row1Width, row2Width) - 2) {
    throw new Error('submenu divider does not span the full menu width')
  }

  const arrowModeDefault = await window.locator('.arrow-mode-trigger').getAttribute('title')
  console.log('ARROW_MODE_DEFAULT', arrowModeDefault)
  if (!arrowModeDefault?.includes('带箭头')) {
    throw new Error('arrow mode should default to single arrow')
  }
  await window.locator('.arrow-mode-trigger').click()
  const arrowModes = await window
    .locator('.arrow-mode-pop [role="menuitemradio"]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('title')))
  console.log('ARROW_MODES', arrowModes)
  if (arrowModes.join(',') !== '带箭头,纯线条,双箭头') {
    throw new Error('arrow mode options or order is wrong')
  }
  await window.locator('.arrow-mode-pop .ss-cell[title="双箭头"]').click()
  const arrowModeSelected = await window.locator('.arrow-mode-trigger').getAttribute('title')
  if (!arrowModeSelected?.includes('双箭头')) {
    throw new Error('arrow mode did not switch to double arrow')
  }

  await window.locator('.ss-drop[title="线条样式"]').click()
  const lineStyles = await window
    .locator('.line-style-pop .ss-cell')
    .evaluateAll((items) => items.map((item) => item.getAttribute('title')))
  console.log('LINE_STYLES', lineStyles)
  if (lineStyles.join(',') !== '实线,细线,点线') {
    throw new Error('line styles or order is wrong')
  }
  const arrowPreviewCount = await window.locator('.line-style-pop canvas').count()
  if (arrowPreviewCount !== 3) {
    throw new Error('every line style preview should render a canvas')
  }
  await window.locator('.line-style-pop .ss-cell[title="细线"]').click()

  const paintedBounds = () =>
    window.evaluate(() => {
      const canvas = document.querySelector('.anno-canvas')
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let minX = canvas.width
      let minY = canvas.height
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if (data[(y * canvas.width + x) * 4 + 3] <= 12) continue
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
      if (maxX < 0) return null
      const scaleX = rect.width / canvas.width
      const scaleY = rect.height / canvas.height
      return {
        x: minX * scaleX,
        y: minY * scaleY,
        width: (maxX - minX + 1) * scaleX,
        height: (maxY - minY + 1) * scaleY
      }
    })

  await window.locator('.tb[title="矩形 / 椭圆"]').click()
  await window.waitForTimeout(120)
  await window.mouse.move(x1 + 30, y1 + 35)
  await window.mouse.down()
  await window.mouse.move(x1 + 170, y1 + 125, { steps: 8 })
  await window.mouse.up()
  await window.waitForTimeout(200)
  const shapeBefore = await paintedBounds()
  await window.locator('.tb[title="线条 / 箭头"]').click()
  await window.locator('.tb[title="矩形 / 椭圆"]').click()
  await window.waitForTimeout(120)
  await window.mouse.move(x1 + 30, y1 + 80)
  const shapeCursor = await window
    .locator('.anno-canvas')
    .evaluate((canvas) => getComputedStyle(canvas).cursor)
  if (shapeCursor !== 'move') {
    throw new Error(`shape border cursor should be move, got ${shapeCursor}`)
  }
  await window.mouse.down()
  await window.mouse.move(x1 + 70, y1 + 110, { steps: 8 })
  await window.mouse.up()
  await window.waitForTimeout(200)
  const shapeAfter = await paintedBounds()
  console.log('SHAPE_MOVE', shapeBefore, shapeAfter, shapeCursor)
  if (
    !shapeBefore ||
    !shapeAfter ||
    Math.abs(shapeAfter.x - shapeBefore.x - 40) > 4 ||
    Math.abs(shapeAfter.y - shapeBefore.y - 30) > 4
  ) {
    throw new Error('shape did not move after switching tools and back')
  }

  const cx1 = x1 + 60
  const cy1 = y1 + 90
  const cx2 = x1 + 280
  const cy2 = y1 + 210
  await window.mouse.move(cx1, cy1)
  await window.mouse.down()
  for (let i = 1; i <= 12; i += 1) {
    await window.mouse.move(cx1 + ((cx2 - cx1) * i) / 12, cy1 + ((cy2 - cy1) * i) / 12, {
      steps: 2
    })
  }
  await window.mouse.up()
  await window.waitForTimeout(200)

  const painted = await window.evaluate(() => {
    const canvas = document.querySelector('.anno-canvas')
    if (!canvas) return 0
    const context = canvas.getContext('2d')
    if (!context) return 0
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) count += 1
    }
    return count
  })
  console.log('PIXELS', painted)
  if (painted < 10) throw new Error('annotation canvas is empty')

  await window.locator('.tb[title="文字"]').click()
  await window.waitForTimeout(120)
  await window.mouse.click(x1 + 90, y1 + 70)
  await window.waitForSelector('.text-draft', { timeout: 3000 })
  await window.locator('.text-draft').fill('你好世界')
  await window.locator('.text-draft').press('Enter')
  await window.waitForTimeout(250)
  console.log('TEXT_INPUT_GONE', (await window.locator('.text-draft').count()) === 0)
  const textPainted = await window.evaluate(() => {
    const canvas = document.querySelector('.anno-canvas')
    if (!canvas) return 0
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1
    return count
  })
  console.log('TEXT_PIXELS', textPainted)
  if (textPainted <= painted) throw new Error('text annotation did not paint')

  await window.mouse.click(x1 + 132, y1 + 78)
  await window.waitForSelector('.text-draft', { timeout: 3000 })
  const firstEditValue = await window.locator('.text-draft').inputValue()
  console.log('TEXT_EDIT_VALUE', firstEditValue)
  if (firstEditValue !== '你好世界') throw new Error('text edit did not load existing value')
  const editingCanvasPixels = await window.evaluate(() => {
    const canvas = document.querySelector('.anno-canvas')
    if (!canvas) return 0
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1
    return count
  })
  console.log('TEXT_EDIT_CANVAS_PIXELS', editingCanvasPixels)
  if (editingCanvasPixels >= textPainted) {
    throw new Error('old text is still painted behind the editor')
  }
  await window.locator('.ss-cell[title="加粗"]').click()
  await window.locator('.ss-cell[title="斜体"]').click()
  await window.locator('.ss-cell[title="下划线"]').click()
  await window.waitForTimeout(120)
  const liveStyle = await window.locator('.text-draft').evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      focused: document.activeElement === element,
      weight: style.fontWeight,
      italic: style.fontStyle,
      underline: style.textDecorationLine
    }
  })
  console.log('TEXT_LIVE_STYLE', JSON.stringify(liveStyle))
  if (
    !liveStyle.focused ||
    (liveStyle.weight !== '700' && liveStyle.weight !== 'bold') ||
    liveStyle.italic !== 'italic' ||
    !liveStyle.underline.includes('underline')
  ) {
    throw new Error('B/I/U did not apply to the editing text')
  }
  await window.locator('.text-draft').fill('编辑后的文字')
  await window.locator('.text-draft').press('Enter')
  await window.waitForTimeout(200)
  await window.mouse.click(x1 + 150, y1 + 78)
  await window.waitForSelector('.text-draft', { timeout: 3000 })
  const secondEditValue = await window.locator('.text-draft').inputValue()
  console.log('TEXT_REEDIT_VALUE', secondEditValue)
  if (secondEditValue !== '编辑后的文字') throw new Error('text re-edit failed')
  const persistedStyle = await window.locator('.text-draft').evaluate((element) => {
    const style = getComputedStyle(element)
    return { weight: style.fontWeight, italic: style.fontStyle, underline: style.textDecorationLine }
  })
  console.log('TEXT_PERSISTED_STYLE', JSON.stringify(persistedStyle))
  if (
    (persistedStyle.weight !== '700' && persistedStyle.weight !== 'bold') ||
    persistedStyle.italic !== 'italic' ||
    !persistedStyle.underline.includes('underline')
  ) {
    throw new Error('B/I/U style did not persist after commit')
  }
  await window.locator('.text-draft').press('Escape')
  await window.waitForTimeout(120)

  let textPoint = null
  for (let dy = 55; dy <= 125 && !textPoint; dy += 5) {
    for (let dx = 75; dx <= 210; dx += 10) {
      await window.mouse.move(x1 + dx, y1 + dy)
      await window.waitForTimeout(12)
      const nextCursor = await window
        .locator('.anno-canvas')
        .evaluate((canvas) => getComputedStyle(canvas).cursor)
      if (nextCursor === 'move') {
        textPoint = { x: dx, y: dy }
        break
      }
    }
  }
  if (!textPoint) throw new Error('text annotation is not hoverable')
  console.log('TEXT_MOVE_POINT', textPoint)
  const textCursor = await window
    .locator('.anno-canvas')
    .evaluate((canvas) => getComputedStyle(canvas).cursor)
  if (textCursor !== 'move') {
    throw new Error(`text border cursor should be move, got ${textCursor}`)
  }
  await window.mouse.down()
  await window.mouse.move(x1 + textPoint.x + 40, y1 + textPoint.y + 30, { steps: 8 })
  await window.mouse.up()
  await window.waitForTimeout(150)
  if ((await window.locator('.text-draft').count()) !== 0) {
    throw new Error('dragging text should not open the text editor')
  }
  await window.mouse.click(x1 + textPoint.x + 40, y1 + textPoint.y + 30)
  await window.waitForSelector('.text-draft', { timeout: 3000 })
  const draggedTextValue = await window.locator('.text-draft').inputValue()
  console.log('TEXT_DRAG', textCursor, draggedTextValue)
  if (draggedTextValue !== '编辑后的文字') {
    throw new Error('dragged text lost its value')
  }
  await window.locator('.text-draft').press('Escape')
  await window.waitForTimeout(120)

  await window.locator('.tb[title="马赛克"]').click()
  await window.waitForTimeout(120)
  console.log('MOSAIC_PALETTE', await window.locator('.row2 .palette').count())

  const selectionBefore = await window.locator('.selection').boundingBox()
  const seHandle = await window.locator('.resize-handle.se').boundingBox()
  if (!selectionBefore || !seHandle) throw new Error('resize handles missing')
  const seX = seHandle.x + seHandle.width / 2
  const seY = seHandle.y + seHandle.height / 2
  await window.mouse.move(seX, seY)
  await window.mouse.down()
  await window.mouse.move(seX + 80, seY + 40, { steps: 6 })
  await window.mouse.up()
  await window.waitForTimeout(150)
  const selectionAfterSe = await window.locator('.selection').boundingBox()
  console.log('RESIZE_SE', selectionBefore, selectionAfterSe)
  if (
    !selectionAfterSe ||
    selectionAfterSe.width < selectionBefore.width + 60 ||
    selectionAfterSe.height < selectionBefore.height + 25
  ) {
    throw new Error('southeast resize failed')
  }

  const nwHandle = await window.locator('.resize-handle.nw').boundingBox()
  if (!nwHandle) throw new Error('northwest resize handle missing')
  const nwX = nwHandle.x + nwHandle.width / 2
  const nwY = nwHandle.y + nwHandle.height / 2
  await window.mouse.move(nwX, nwY)
  await window.mouse.down()
  await window.mouse.move(nwX - 30, nwY - 20, { steps: 6 })
  await window.mouse.up()
  await window.waitForTimeout(150)
  const selectionAfterNw = await window.locator('.selection').boundingBox()
  console.log('RESIZE_NW', selectionAfterNw)
  if (
    !selectionAfterNw ||
    selectionAfterNw.x > selectionAfterSe.x - 20 ||
    selectionAfterNw.y > selectionAfterSe.y - 12
  ) {
    throw new Error('northwest resize failed')
  }

  await window.locator('.act').filter({ hasText: '复制' }).click()
  await new Promise((resolve) => setTimeout(resolve, 900))
  const clipboardHasImage = await app.evaluate(({ clipboard }) => !clipboard.readImage().isEmpty())
  console.log('CLIPBOARD', clipboardHasImage)
  if (!clipboardHasImage) throw new Error('clipboard does not contain the capture')

  // 看门狗验证：阻塞覆盖层渲染线程 7 秒，主进程应在心跳超时后自动隐藏窗口。
  // 这样即使真实录制把渲染线程拖住，全屏覆盖层也不会继续吃掉桌面鼠标事件。
  await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
  await window.waitForSelector('.overlay-root', { timeout: 8000 })
  await new Promise((resolve) => setTimeout(resolve, 500))
  const largeStarted = Date.now()
  await window.mouse.move(20, 20)
  await window.mouse.down()
  await window.mouse.move(viewport.width - 20, viewport.height - 30, { steps: 24 })
  await window.mouse.up()
  await window.waitForSelector('.tooldock', { timeout: 8000 })
  const largeSelection = await window.locator('.selection').boundingBox()
  const largeDimPanels = await window.locator('.dim-panel').count()
  console.log('LARGE_SELECTION', largeSelection, 'DIM_PANELS', largeDimPanels)
  console.log('LARGE_SELECTION_MS', Date.now() - largeStarted)
  if (
    !largeSelection ||
    largeSelection.width < viewport.width - 60 ||
    largeSelection.height < viewport.height - 80
  ) {
    throw new Error('large selection was not created')
  }
  if (largeDimPanels !== 4) {
    throw new Error('large selection should render exactly four dim panels')
  }
  if (Date.now() - largeStarted > 3000) {
    throw new Error('large selection blocked the overlay for too long')
  }
  const visibleBeforeWatchdog = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (candidate) =>
        candidate.webContents.getURL().includes('overlay') &&
        candidate.isVisible() &&
        candidate.getOpacity() > 0.01
    )
  )
  if (!visibleBeforeWatchdog) throw new Error('overlay is not visible before watchdog test')
  const watchdogStarted = Date.now()
  await window.evaluate(() => {
    const until = Date.now() + 7000
    while (Date.now() < until) {
      // 故意阻塞事件循环，模拟渲染线程被大图编码/合成拖死。
    }
  })
  await new Promise((resolve) => setTimeout(resolve, 600))
  const visibleAfterWatchdog = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (candidate) =>
        candidate.webContents.getURL().includes('overlay') &&
        candidate.isVisible() &&
        candidate.getOpacity() > 0.01
    )
  )
  console.log('WATCHDOG_OVERLAY_VISIBLE', visibleBeforeWatchdog, visibleAfterWatchdog)
  console.log('WATCHDOG_ELAPSED_MS', Date.now() - watchdogStarted)
  if (visibleAfterWatchdog) {
    throw new Error('watchdog did not hide the unresponsive full-screen overlay')
  }

  console.log('E2E_OK')
  await app.close()
  process.exit(0)
})().catch((error) => {
  console.error('E2E_FAIL', error)
  process.exit(1)
})
