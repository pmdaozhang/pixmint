const { chromium } = require('playwright-core')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

;(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true
  })
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('http://127.0.0.1:7103/test-ui/test.html#overlay')
  await page.waitForSelector('.overlay-root')

  await page.mouse.move(80, 80)
  await page.mouse.down()
  await page.mouse.move(650, 520, { steps: 8 })
  await page.mouse.up()
  await page.waitForSelector('.tooldock')
  console.log('ROW2_DEFAULT', await page.locator('.row2').count())

  await page.locator('.tb[title="线条 / 箭头"]').click()
  await page.waitForTimeout(100)
  console.log('ROW2_AFTER_CLICK', await page.locator('.row2').count())
  await page.locator('.tb[title="线条 / 箭头"]').click()
  await page.waitForTimeout(100)
  console.log('ROW2_AFTER_SECOND_CLICK', await page.locator('.row2').count())

  await page.locator('.tb[title="文字"]').click()
  await page.waitForTimeout(100)
  await page.mouse.click(180, 180)
  await page.waitForSelector('.text-draft')
  await page.locator('.text-draft').fill('Hello Pixmint')
  await page.locator('.text-draft').press('Enter')
  await page.waitForTimeout(200)
  console.log('TEXT_INPUT_GONE', (await page.locator('.text-draft').count()) === 0)
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('.anno-canvas')
    if (!canvas) return 0
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1
    return count
  })
  console.log('TEXT_PIXELS', painted)

  await page.locator('.tb[title="马赛克"]').click()
  await page.waitForTimeout(100)
  console.log('MOSAIC_PALETTE', await page.locator('.row2 .palette').count())

  await page.goto('http://127.0.0.1:7103/test-ui/test.html#pin')
  await page.waitForSelector('.pin-root')
  console.log('PIN_DRAG_HANDLE', await page.locator('.pin-drag').count())
  await page.mouse.move(100, 100)
  await page.mouse.down()
  await page.mouse.move(180, 150, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(100)
  const calls = await page.evaluate(() => window.__pinCalls)
  console.log('PIN_DRAG_CALLS', JSON.stringify(calls))

  console.log('PAGE_ERRORS', errors.length ? JSON.stringify(errors) : 'none')
  await browser.close()
  if (errors.length) process.exit(1)
})().catch((error) => {
  console.error('UI_TEST_FAIL', error)
  process.exit(1)
})
