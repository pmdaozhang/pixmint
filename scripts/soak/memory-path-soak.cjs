const fs = require('node:fs')
const path = require('node:path')
const {
  launch,
  memorySnapshot,
  percentile,
  selectRegion,
  sleep,
  waitForInactive,
  writeReport
} = require('./lib.cjs')

const MODE = process.env.PIXMINT_MEMORY_PATH ?? 'esc'
const CYCLES = Number(process.env.PIXMINT_MEMORY_CYCLES ?? 50)
// 复制/保存会把图片交给系统剪贴板或写文件，预算包含这部分系统占用。
const DEFAULT_MAX_PRIVATE_MB = { esc: 32, pin: 32, ocr: 32, save: 48, copy: 64 }
const MAX_PRIVATE_MB = Number(
  process.env.PIXMINT_MEMORY_MAX_PRIVATE_MB ?? DEFAULT_MAX_PRIVATE_MB[MODE] ?? 32
)
const SAVE_DIR = path.join(__dirname, '..', '..', 'test-results', 'memory-save')

async function waitForOverlayActive(app, timeout = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await app.evaluate(() => globalThis.__snapglassOverlayActive?.())) return
    await sleep(100)
  }
  throw new Error('overlay did not become active')
}

async function overlayWindow(app) {
  for (const window of app.windows()) {
    try {
      if ((await window.locator('.overlay-root').count()) > 0) return window
    } catch {
      // 窗口可能正在关闭
    }
  }
  return null
}

function tabPrivateMb(snapshot) {
  const total = snapshot.processes
    .filter((process) => process.type === 'Tab')
    .reduce((sum, process) => sum + (process.privateKb ?? 0), 0)
  return Math.round((total / 1024) * 10) / 10
}

async function waitForFile(filePath, timeout = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (fs.existsSync(filePath)) return
    await sleep(50)
  }
  throw new Error(`file was not written: ${filePath}`)
}

async function runAction(app, overlay, filePath) {
  if (MODE === 'esc') {
    await overlay.keyboard.press('Escape')
    return
  }
  if (MODE === 'copy') {
    await overlay.locator('.act').filter({ hasText: '复制' }).click()
    return
  }
  if (MODE === 'pin') {
    await overlay.locator('.act').filter({ hasText: '钉图' }).click()
    const pin = await app.waitForEvent('window', { timeout: 15000 }).catch(() => null)
    const target = pin ?? app.windows().find((window) => window !== overlay) ?? null
    if (!target) throw new Error('pin window not found')
    await target.waitForSelector('.pin-root', { timeout: 10000 })
    await target.locator('.pin-actions button[title="关闭"]').click()
    return
  }
  if (MODE === 'ocr') {
    await overlay.locator('.act').filter({ hasText: '识别' }).click()
    const ocr = await app.waitForEvent('window', { timeout: 20000 }).catch(() => null)
    const target = ocr ?? app.windows().find((window) => window !== overlay) ?? null
    if (!target) throw new Error('ocr window not found')
    await target.waitForSelector('.ocr-root', { timeout: 20000 })
    await target.locator('.ocr-icon-btn[title="关闭"]').click()
    return
  }
  if (MODE === 'save') {
    await overlay.locator('.act').filter({ hasText: '保存' }).click()
    await waitForFile(filePath)
    fs.unlinkSync(filePath)
    return
  }
  throw new Error(`unknown memory path: ${MODE}`)
}

;(async () => {
  fs.mkdirSync(SAVE_DIR, { recursive: true })
  const savePath = path.join(SAVE_DIR, `capture-${process.pid}.png`)
  const app = await launch([MODE === 'ocr' ? '--smoke-overlay-ocr' : '--smoke-overlay'])
  const failures = []
  const durations = []
  const samples = []
  try {
    if (MODE === 'save') {
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, savePath)
    }
    const first = await app.firstWindow()
    await first.waitForSelector('.overlay-root', { timeout: 30000 })
    // smoke 模式在 1.2 秒后才显示假覆盖层。
    await sleep(1500)
    await first.keyboard.press('Escape')
    await waitForInactive(app)
    const before = await memorySnapshot(app)
    const beforePrivateMb = tabPrivateMb(before)

    for (let index = 0; index < CYCLES; index += 1) {
      const started = Date.now()
      try {
        if (fs.existsSync(savePath)) fs.unlinkSync(savePath)
        await app.evaluate(() => globalThis.__snapglassStartCapture?.())
        await waitForOverlayActive(app)
        const overlay = await overlayWindow(app)
        if (!overlay) throw new Error('overlay window not found')
        await selectRegion(overlay, 160, 140, 760, 520)
        await runAction(app, overlay, savePath)
        await waitForInactive(app, 20000)
        if (MODE === 'copy') await app.evaluate(({ clipboard }) => clipboard.clear())
        await sleep(150)
      } catch (error) {
        failures.push({ iteration: index, error: String(error) })
      }
      durations.push(Date.now() - started)
      if ((index + 1) % 10 === 0) {
        samples.push({ cycle: index + 1, ...(await memorySnapshot(app)) })
      }
      if ((index + 1) % 10 === 0) {
        console.log('MEMORY_PATH_PROGRESS', MODE, index + 1, CYCLES)
      }
    }

    // 复制路径会把图片交给系统剪贴板；先释放剪贴板再测应用自身占用。
    await app.evaluate(({ clipboard }) => clipboard.clear())
    await sleep(2000)
    const after = await memorySnapshot(app)
    const afterPrivateMb = tabPrivateMb(after)
    const privateGrowthMb = Math.round((afterPrivateMb - beforePrivateMb) * 10) / 10
    writeReport(`memory-${MODE}`, {
      mode: MODE,
      cycles: CYCLES,
      failures,
      privateGrowthMb,
      maxPrivateMb: MAX_PRIVATE_MB,
      beforePrivateMb,
      afterPrivateMb,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      before,
      samples,
      after
    })
    await app.close()
    process.exit(failures.length === 0 && privateGrowthMb <= MAX_PRIVATE_MB ? 0 : 1)
  } catch (error) {
    console.error('MEMORY_PATH_SOAK_FAIL', MODE, error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
