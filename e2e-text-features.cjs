const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')

const repeat = (text, count) => text.repeat(count)

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
  window.on('pageerror', (error) => console.log('PAGEERROR', error.message))
  await window.waitForSelector('.overlay-root', { timeout: 15000 })
  await window.waitForTimeout(700)
  await window.waitForFunction(() => document.visibilityState === 'visible')
  await window.bringToFront()

  const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const x1 = 120
  const y1 = 100
  const x2 = Math.min(viewport.width - 120, 920)
  const y2 = Math.min(viewport.height - 140, 520)
  await window.mouse.move(x1, y1)
  await window.mouse.down()
  await window.mouse.move(x2, y2, { steps: 8 })
  await window.mouse.up()
  await window.waitForSelector('.tooldock', { timeout: 5000 })
  await window.waitForTimeout(250)

  await window.locator('.tb[title="文字"]').click()
  await window.waitForTimeout(120)
  await window.mouse.click(x1 + 90, y1 + 70)
  await window.waitForSelector('.text-draft', { timeout: 3000 })
  const draft = window.locator('.text-draft')
  const widthOf = () => draft.evaluate((element) => element.getBoundingClientRect().width)

  // 1. 输入框宽度随内容自适应
  await draft.fill('你好')
  await window.waitForTimeout(80)
  const w1 = await widthOf()
  await draft.fill('你好世界啊')
  await window.waitForTimeout(80)
  const w2 = await widthOf()
  console.log('ADAPTIVE_WIDTH', w1.toFixed(1), w2.toFixed(1))
  if (!(w2 > w1)) throw new Error('输入框宽度未随内容自适应')

  // 2. 触右换行，宽度不超过选区剩余宽度
  await draft.fill(repeat('你', 200))
  await window.waitForTimeout(120)
  const wrap = await draft.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    clientWidth: element.clientWidth,
    maxWidth: element.style.maxWidth
  }))
  console.log('WRAP', wrap)
  if (!(wrap.height > 20)) throw new Error('长文本未换行')
  const limit = parseFloat(wrap.maxWidth)
  if (!(wrap.width <= limit + 1)) throw new Error('输入框超过选区剩余宽度')

  // 3. 换行到接近选区底部时拒绝输入并 toast
  await draft.fill(repeat('你', 1200))
  await window.waitForTimeout(120)
  const toast = window.locator('.overlay-toast')
  await toast.waitFor({ state: 'visible', timeout: 2500 })
  const toastText = (await toast.innerText()).trim()
  console.log('OVERFLOW_TOAST', toastText)
  if (!toastText.includes('超出截图区域')) throw new Error('缺少超出截图区域提示')

  // 4. 字体选择器与会员权限
  const fontSelect = window.locator('.font-select')
  if ((await fontSelect.count()) !== 1) throw new Error('缺少字体选择器')
  await fontSelect.click()
  await window.waitForSelector('.font-pop', { timeout: 3000 })
  const items = window.locator('.font-item')
  const options = await items.allInnerTexts()
  console.log('FONT_OPTIONS', options.length, JSON.stringify(options.slice(0, 3)))
  if (options.length < 10) throw new Error('字体选项不足')
  const free = options.some((option) => option.includes('👑'))
  console.log('FREE_STATE', free)
  if (free) {
    const before = app.windows().length
    await items.nth(1).click()
    await window.waitForTimeout(1200)
    const after = app.windows().length
    console.log('PURCHASE_WINDOWS', before, after)
    if (after <= before) throw new Error('免费用户点击会员字体未打开购买窗')
    for (const page of app.windows()) {
      if (page !== window) await page.close().catch(() => {})
    }
  } else {
    await items.nth(1).click()
    await window.waitForTimeout(200)
    const family = await draft.evaluate((element) => getComputedStyle(element).fontFamily)
    console.log('PRO_FONT_FAMILY', family)
    if (!family.includes('Pixmint')) throw new Error('会员字体未生效')
  }

  console.log('E2E_TEXT_FEATURES_OK')
  await app.close()
})().catch((error) => {
  console.error('E2E_FAIL', error)
  process.exit(1)
})
