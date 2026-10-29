const { _electron: electron } = require('playwright-core')
const { mkdtempSync, readFileSync, rmSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SHOTS = path.join(PROJECT, 'test-results', 'onboarding')
const userData = mkdtempSync(path.join(tmpdir(), 'pixmint-onboarding-'))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

;(async () => {
  mkdirSync(SHOTS, { recursive: true })
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', `--user-data-dir=${userData}`],
    cwd: PROJECT,
    env: { ...process.env }
  })

  try {
    const deadline = Date.now() + 25000
    let win = null
    while (!win && Date.now() < deadline) {
      for (const candidate of app.windows()) {
        try {
          await candidate.waitForSelector('.onboarding-root', { timeout: 800 })
          win = candidate
          break
        } catch {
          // 继续找引导窗口
        }
      }
      if (!win) await new Promise((resolve) => setTimeout(resolve, 400))
    }
    if (!win) {
      console.log('WINDOWS', app.windows().map((candidate) => candidate.url()))
      throw new Error('onboarding window not found')
    }

    const stepCount = await win.locator('.onb-step-dot').count()
    const titles = await win.locator('.onb-copy h1').allTextContents()
    console.log('STEPS', stepCount)
    console.log('TITLES', JSON.stringify(titles))
    assert(stepCount === 5, 'expected 5 onboarding steps')
    assert(titles.length === 5, 'expected 5 onboarding pages')
    assert(titles[0].includes('支持录制 GIF 动画'), 'page 1 title mismatch')
    assert(titles[1].includes('视频也能录制'), 'page 2 title mismatch')
    assert(titles[2].includes('OCR、翻译页都有'), 'page 3 title mismatch')
    assert(titles[3].includes('截下眼前的画面'), 'page 4 title mismatch')

    for (let page = 1; page <= 5; page += 1) {
      if (page > 1) {
        await win.locator('.onb-step-dot').nth(page - 1).click()
        await win.waitForTimeout(500)
      }
      await win.waitForTimeout(page === 1 ? 900 : 1200)
      await win.screenshot({ path: path.join(SHOTS, `p${page}.png`) })
    }

    await win.locator('.onb-step-dot').nth(0).click()
    await win.waitForTimeout(1200)
    const gifSync = await win.evaluate(() => {
      const select = document.querySelector('.onb-gif-select')
      const cursor = document.querySelector('.onb-gif-cursor')
      const rect = select.getBoundingClientRect()
      const matrix = new DOMMatrixReadOnly(getComputedStyle(cursor).transform)
      const cursorRect = cursor.getBoundingClientRect()
      return {
        width: rect.width,
        height: rect.height,
        dx: cursorRect.left - rect.right,
        dy: cursorRect.top - rect.bottom,
        moved: matrix.m41 + matrix.m42
      }
    })
    console.log('GIF_SYNC', gifSync)
    assert(gifSync.width > 100, 'gif selection did not grow')
    assert(Math.abs(gifSync.dx) < 1 && Math.abs(gifSync.dy) < 1, 'gif cursor is not on the selection corner')

    await win.locator('.onb-step-dot').nth(1).click()
    await win.waitForTimeout(2200)
    const video = await win.evaluate(() => {
      const element = document.querySelector('.onb-video')
      return {
        duration: element.duration,
        paused: element.paused,
        ready: element.readyState,
        close: element.currentSrc.includes('onboarding-clip')
      }
    })
    console.log('VIDEO', video)
    assert(video.ready >= 2, 'video not loaded')
    assert(!video.paused, 'video not playing')
    assert(video.duration > 7.5, 'video should be the 8s seamless loop')
    assert(video.close, 'video asset path mismatch')

    await win.locator('.onb-step-dot').nth(2).click()
    await win.waitForTimeout(2600)
    const ocrCentered = await win.evaluate(() => {
      const visual = document.querySelector('.onb-visual')
      const stage = document.querySelector('.onb-ocr-stage')
      return {
        dx:
          Math.round(
            (stage.offsetLeft + stage.offsetWidth / 2 - visual.clientWidth / 2) * 10
          ) / 10,
        dy:
          Math.round(
            (stage.offsetTop + stage.offsetHeight / 2 - visual.clientHeight / 2) * 10
          ) / 10,
        shown: document.querySelector('.onb-ocr-stack').classList.contains('show')
      }
    })
    console.log('OCR_CENTER', ocrCentered)
    assert(Math.abs(ocrCentered.dx) < 2 && Math.abs(ocrCentered.dy) < 2, 'OCR stage is not centered')
    assert(ocrCentered.shown, 'OCR result stack not shown')

    await win.locator('.onb-step-dot').nth(4).click()
    await win.waitForTimeout(500)
    await win.locator('.onb-primary').click().catch(() => {})
    // 点击“开始使用”会立即关闭引导窗口，不能再对页面等待。
    await new Promise((resolve) => setTimeout(resolve, 1200))

    const settingsPath = path.join(userData, 'settings.json')
    const saved = JSON.parse(readFileSync(settingsPath, 'utf8'))
    console.log('SETTINGS', JSON.stringify(saved))
    assert(saved.onboardingCompleted === true, 'onboardingCompleted not saved')
    assert(saved.onboardingVersion === 2, 'onboardingVersion not saved')

    console.log('E2E_ONBOARDING_OK')
  } finally {
    await app.close().catch(() => {})
    rmSync(userData, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error('E2E_ONBOARDING_FAILED', error)
  process.exit(1)
})
