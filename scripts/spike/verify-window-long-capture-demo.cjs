const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { chromium } = require('playwright-core')

/**
 * 背景：窗口长截图 Demo 是交互确认物，必须验证菜单、选区、自动滚动和错误态。
 * 设计意图：用 Edge 无头模式走完整流程，并保存关键状态截图。
 * 关键约束：只读取本地 Demo，不启动产品、不写用户数据。
 */
async function main() {
  const project = path.resolve(__dirname, '..', '..')
  const demoPath = path.join(project, 'demos', 'P8-window-long-capture.html')
  const outputDir = path.join(project, 'test-results')
  fs.mkdirSync(outputDir, { recursive: true })

  const browser = await chromium.launch({
    executablePath:
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true
  })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1150 },
    deviceScaleFactor: 1
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })

  await page.goto(pathToFileURL(demoPath).href)
  await page.waitForTimeout(250)
  await page.screenshot({
    path: path.join(outputDir, 'window-long-capture-idle.png'),
    fullPage: true
  })

  await page.locator('#long-btn').click()
  await page.waitForTimeout(150)
  if (await page.locator('#picker').isHidden()) {
    throw new Error('点击长截图后二级菜单没有打开')
  }
  await page.screenshot({
    path: path.join(outputDir, 'window-long-capture-picker.png'),
    fullPage: true
  })

  await page.locator('.picker-row[data-target="chrome"]').click()
  await page.waitForTimeout(160)
  if (await page.locator('#selection').isHidden()) {
    throw new Error('选择 Chrome 后没有显示默认选区')
  }
  if (await page.locator('#confirm-bar').isHidden()) {
    throw new Error('选择 Chrome 后没有显示确认条')
  }
  const beforeResize = await page.locator('#selection-size').innerText()
  await page.screenshot({
    path: path.join(outputDir, 'window-long-capture-adjust.png'),
    fullPage: true
  })

  const handle = await page.locator('.handle[data-dir="se"]').boundingBox()
  if (!handle) throw new Error('没有找到缩放手柄')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x - 90, handle.y - 70, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(120)
  const afterResize = await page.locator('#selection-size').innerText()
  if (beforeResize === afterResize) {
    throw new Error('拖动缩放手柄后选区尺寸没有变化')
  }
  await page.screenshot({
    path: path.join(outputDir, 'window-long-capture-resized.png'),
    fullPage: true
  })

  console.log(
    'START_BUTTON_DEBUG',
    await page.locator('#start-btn').evaluate((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return {
        visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
    })
  )
  await page.locator('#start-btn').evaluate((element) => element.click())
  await page.waitForTimeout(1000)
  const capturePill = await page.locator('#hud-pill').innerText()
  if (capturePill !== '自动滚动中') {
    throw new Error(`开始后状态应为自动滚动中，实际为 ${capturePill}`)
  }
  const captureMeta = await page.locator('#hud-meta').innerText()
  if (!/已截 [2-9]|已截 [1-9][0-9]/.test(captureMeta)) {
    throw new Error(`自动滚动后屏数没有增加：${captureMeta}`)
  }
  await page.screenshot({
    path: path.join(outputDir, 'window-long-capture-auto.png'),
    fullPage: true
  })

  await page.locator('#pause-btn').click()
  await page.waitForTimeout(120)
  if ((await page.locator('#hud-pill').innerText()) !== '已暂停') {
    throw new Error('暂停后状态没有变成已暂停')
  }
  await page.screenshot({
    path: path.join(outputDir, 'window-long-capture-paused.png'),
    fullPage: true
  })

  await page.locator('#pause-btn').click()
  await page.waitForTimeout(900)
  await page.locator('#stop-btn').click()
  await page.waitForTimeout(180)
  if (await page.locator('#preview-backdrop').isHidden()) {
    throw new Error('停止后没有打开预览')
  }
  await page.screenshot({
    path: path.join(outputDir, 'window-long-capture-preview.png')
  })

  await page.locator('#preview-close').click()
  await page.waitForTimeout(120)
  await page.locator('#long-btn').click()
  await page.locator('.picker-row[data-target="notes"]').click()
  await page.locator('#start-btn').evaluate((element) => element.click())
  await page.waitForTimeout(120)
  if ((await page.locator('#hud-pill').innerText()) !== '无法开始') {
    throw new Error('不可滚动窗口没有进入错误状态')
  }
  await page.screenshot({
    path: path.join(outputDir, 'window-long-capture-error.png'),
    fullPage: true
  })

  await page.locator('#close-hud').click()
  await page.getByRole('button', { name: '浅色' }).click()
  await page.waitForTimeout(150)
  await page.screenshot({
    path: path.join(outputDir, 'window-long-capture-light.png'),
    fullPage: true
  })

  if (errors.length > 0) {
    throw new Error(`Demo 有控制台错误：\n${errors.join('\n')}`)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        demo: demoPath,
        checks: {
          picker: 'pass',
          defaultSelection: 'pass',
          resize: { before: beforeResize, after: afterResize },
          autoScroll: captureMeta,
          pause: 'pass',
          preview: 'pass',
          error: 'pass',
          lightTheme: 'pass'
        },
        screenshots: [
          'window-long-capture-idle.png',
          'window-long-capture-picker.png',
          'window-long-capture-adjust.png',
          'window-long-capture-resized.png',
          'window-long-capture-auto.png',
          'window-long-capture-paused.png',
          'window-long-capture-preview.png',
          'window-long-capture-error.png',
          'window-long-capture-light.png'
        ]
      },
      null,
      2
    )
  )
  await browser.close()
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  )
  process.exitCode = 1
})
