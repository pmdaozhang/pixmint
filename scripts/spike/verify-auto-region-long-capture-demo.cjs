const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { chromium } = require('playwright-core')

/**
 * 背景：区域长截图改变了交互，必须验证不再出现窗口选择器，并覆盖自动、暂停、手动和失败态。
 * 设计意图：只测本地 Demo，不启动产品、不写用户数据。
 * 关键约束：断言真实 DOM 状态，不能只看截图。
 */
async function main() {
  const project = path.resolve(__dirname, '..', '..')
  const demoPath = path.join(project, 'demos', 'P9-auto-region-long-capture.html')
  const outputDir = path.join(project, 'test-results')
  fs.mkdirSync(outputDir, { recursive: true })

  const browser = await chromium.launch({
    executablePath:
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true
  })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })

  await page.goto(pathToFileURL(demoPath).href)
  await page.waitForTimeout(200)
  await page.screenshot({
    path: path.join(outputDir, 'auto-region-long-idle.png'),
    fullPage: true
  })

  if ((await page.locator('.picker, .window-picker').count()) !== 0) {
    throw new Error('区域长截图不应出现窗口选择器')
  }

  await page.locator('#long-btn').click()
  await page.waitForSelector('#hud:not([hidden])')
  await page.waitForFunction(() => {
    const text = document.querySelector('#hud-meta')?.textContent ?? ''
    const match = /(\d+)\s*屏/.exec(text)
    return match ? Number(match[1]) >= 2 : false
  })
  await page.screenshot({
    path: path.join(outputDir, 'auto-region-long-auto.png'),
    fullPage: true
  })

  await page.locator('#pause-btn').click()
  if ((await page.locator('#hud-pill').innerText()) !== '已暂停') {
    throw new Error('暂停状态没有生效')
  }
  await page.locator('#pause-btn').click()

  await page.locator('#manual-btn').click()
  await page.waitForSelector('.stage.manual .manual-hint')
  if ((await page.locator('#hud-pill').innerText()) !== '手动滚动') {
    throw new Error('没有进入手动滚动状态')
  }
  await page.screenshot({
    path: path.join(outputDir, 'auto-region-long-manual.png'),
    fullPage: true
  })

  await page.locator('[data-demo="error"]').click()
  await page.waitForFunction(() => document.querySelector('#hud')?.dataset.tone === 'error')
  await page.screenshot({
    path: path.join(outputDir, 'auto-region-long-error.png'),
    fullPage: true
  })

  await page.locator('[data-demo="reset"]').click()
  await page.locator('#long-btn').click()
  await page.waitForFunction(() => document.querySelector('#stage')?.classList.contains('is-preview'), {
    timeout: 8000
  })
  await page.waitForSelector('.stage.is-preview .preview')
  await page.waitForTimeout(320)
  await page.screenshot({
    path: path.join(outputDir, 'auto-region-long-preview.png')
  })

  if (errors.length > 0) {
    throw new Error(`Demo 控制台错误：\n${errors.join('\n')}`)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: {
          noWindowPicker: 'pass',
          autoScroll: 'pass',
          pause: 'pass',
          manualFallback: 'pass',
          error: 'pass',
          preview: 'pass'
        },
        screenshots: [
          'auto-region-long-idle.png',
          'auto-region-long-auto.png',
          'auto-region-long-manual.png',
          'auto-region-long-error.png',
          'auto-region-long-preview.png'
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
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      null,
      2
    )
  )
  process.exitCode = 1
})
