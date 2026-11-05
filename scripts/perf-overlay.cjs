const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

/** 测量两次框选的工具栏出现耗时；同时打印主进程窗口可见状态。 */
;(async () => {
  const project = path.resolve(__dirname, '..')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-perf-'))
  const app = await electron.launch({
    executablePath: path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.', '--smoke-overlay'],
    cwd: project,
    env: { ...process.env, PIXMINT_USER_DATA_DIR: userData }
  })
  const logs = []
  app.process().stdout?.on('data', (chunk) => logs.push(String(chunk)))
  const overlay = await app.firstWindow()
  overlay.on('console', (message) => {
    const text = message.text()
    if (text.startsWith('PERF_')) logs.push(text + '\n')
  })

  await overlay.waitForSelector('.overlay-root', { timeout: 20000 })
  await overlay.waitForTimeout(1800)
  await overlay.keyboard.press('Escape')
  await overlay.waitForTimeout(600)

  const run = async (label) => {
    logs.length = 0
    await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
    await overlay.waitForSelector('.overlay-root', { timeout: 10000 })
    await overlay.waitForTimeout(250)
    const started = Date.now()
    await overlay.mouse.move(300, 220)
    await overlay.mouse.down()
    await overlay.mouse.move(1100, 720, { steps: 10 })
    await overlay.mouse.up()
    await overlay.waitForSelector('.tooldock', { timeout: 8000 })
    const visibleMs = Date.now() - started
    await overlay.waitForTimeout(400)
    console.log(`=== ${label} tooldock_visible_from_drag_start_ms=${visibleMs} ===`)
    for (const line of logs.join('').split(/\r?\n/)) {
      if (line.includes('PERF_') || line.includes('OVERLAY_VISIBLE_BEFORE_SHOW')) {
        console.log(line)
      }
    }
    await overlay.keyboard.press('Escape')
    await overlay.waitForTimeout(600)
  }

  await run('FIRST')
  await run('SECOND')
  await app.close()
})().catch((error) => {
  console.error('PERF_FAILED', error)
  process.exit(1)
})
