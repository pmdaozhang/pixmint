const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { chromium } = require('playwright-core')

/**
 * 背景：P8 Demo 是交互确认物，不能只看静态 HTML 是否打开。
 * 设计意图：用 Edge 无头模式走完倒计时、连续滚动、跳变、回退、完成和主题切换。
 * 关键约束：只读取本地 Demo，不启动产品、不写入用户数据；截图落在 test-results。
 */
async function main() {
  const project = path.resolve(__dirname, '..', '..')
  const demoPath = path.join(project, 'demos', 'P8-manual-long-capture.html')
  const outputDir = path.join(project, 'test-results')
  fs.mkdirSync(outputDir, { recursive: true })

  const browser = await chromium.launch({
    executablePath:
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true
  })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
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
    path: path.join(outputDir, 'p8-demo-selection-dark.png'),
    fullPage: true
  })

  await page.getByRole('button', { name: '开始倒计时' }).click()
  await page.waitForTimeout(3050)
  const afterCountdown = await page.locator('#hud-pill').innerText()
  if (afterCountdown !== '跟随中') {
    throw new Error(`倒计时后状态应为跟随中，实际为 ${afterCountdown}`)
  }
  await page.screenshot({
    path: path.join(outputDir, 'p8-demo-capturing-dark.png'),
    fullPage: true
  })

  await page.getByRole('button', { name: '连续滚动' }).click()
  await page.waitForTimeout(900)
  const metaAfterScroll = await page.locator('#hud-meta').innerText()
  if (!/已接 [2-9]|已接 [1-9][0-9]/.test(metaAfterScroll)) {
    throw new Error(`连续滚动后应增加屏数，实际为 ${metaAfterScroll}`)
  }

  await page.getByRole('button', { name: '模拟跳跃' }).click()
  await page.waitForTimeout(120)
  const gapState = await page.locator('#hud-pill').innerText()
  if (gapState !== '需要回滚') {
    throw new Error(`跳变后状态应为需要回滚，实际为 ${gapState}`)
  }
  await page.screenshot({
    path: path.join(outputDir, 'p8-demo-gap-dark.png'),
    fullPage: true
  })

  await page.getByRole('button', { name: '回退一屏' }).first().click()
  await page.waitForTimeout(120)
  const undoState = await page.locator('#hud-pill').innerText()
  if (undoState !== '跟随中') {
    throw new Error(`回退后状态应为跟随中，实际为 ${undoState}`)
  }

  await page.getByRole('button', { name: '完成' }).first().click()
  await page.waitForTimeout(150)
  if (await page.locator('#preview-backdrop').isHidden()) {
    throw new Error('完成后预览未打开')
  }
  await page.screenshot({
    path: path.join(outputDir, 'p8-demo-preview-dark.png')
  })

  await page.getByRole('button', { name: '关闭预览' }).click()
  await page.getByRole('button', { name: '选区' }).click()
  await page.getByRole('button', { name: '浅色' }).click()
  await page.waitForTimeout(150)
  await page.screenshot({
    path: path.join(outputDir, 'p8-demo-selection-light.png'),
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
        screenshots: [
          'p8-demo-selection-dark.png',
          'p8-demo-capturing-dark.png',
          'p8-demo-gap-dark.png',
          'p8-demo-preview-dark.png',
          'p8-demo-selection-light.png'
        ],
        checks: {
          countdown: 'pass',
          continuousScroll: metaAfterScroll,
          gap: gapState,
          undo: undoState,
          preview: 'pass',
          lightTheme: 'pass'
        }
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
