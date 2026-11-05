const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

function launch(project, args, userData) {
  return electron.launch({
    executablePath: path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.', ...args],
    cwd: project,
    env: { ...process.env, PIXMINT_USER_DATA_DIR: userData }
  })
}

;(async () => {
  const project = path.resolve(__dirname, '..')

  // 1. 更新介绍页 + 跳过此版本
  const wnData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-wn-'))
  const wnApp = await launch(project, ['--e2e-whats-new'], wnData)
  const wn = await wnApp.firstWindow()
  await wn.waitForSelector('.wn-card', { timeout: 15000 })
  await wn.waitForTimeout(500)
  await wn.screenshot({ path: path.join(project, 'test-results', 'whats-new.png') })
  console.log('WN_TITLE', (await wn.locator('.wn-body h1').innerText()).trim())
  await wn.locator('.wn-secondary').click().catch(() => undefined)
  // 点击后窗口立即关闭，等待写盘要用 Node 定时器，不能再等 page
  await new Promise((resolve) => setTimeout(resolve, 900))
  const saved = JSON.parse(fs.readFileSync(path.join(wnData, 'settings.json'), 'utf8'))
  console.log('WN_SKIPPED_VERSION', saved.skippedUpdateVersion)
  await wnApp.close().catch(() => undefined)

  // 2. 工具条 38px + 马赛克滑杆已移除
  const uiData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-ui2-'))
  const uiApp = await launch(project, ['--smoke-overlay'], uiData)
  const overlay = await uiApp.firstWindow()
  await overlay.waitForSelector('.overlay-root', { timeout: 20000 })
  await overlay.waitForTimeout(1800)
  await overlay.mouse.move(300, 220)
  await overlay.mouse.down()
  await overlay.mouse.move(1100, 720, { steps: 8 })
  await overlay.mouse.up()
  await overlay.waitForSelector('.tooldock', { timeout: 8000 })
  await overlay.waitForTimeout(250)
  const dock = await overlay.locator('.tooldock').boundingBox()
  console.log('TOOLDOCK_HEIGHT', dock ? Math.round(dock.height) : null)
  await overlay.locator('.tb[title="马赛克"]').click()
  await overlay.waitForTimeout(300)
  console.log('MOSAIC_RANGE_COUNT', await overlay.locator('.mosaic-brush-range').count())
  await overlay.screenshot({ path: path.join(project, 'test-results', 'mosaic-submenu.png') })
  await uiApp.close().catch(() => undefined)
})().catch((error) => {
  console.error('CHECK_FAILED', error)
  process.exit(1)
})
