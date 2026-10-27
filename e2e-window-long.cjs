const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { _electron: electron } = require('playwright-core')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const OUTPUT = path.join(PROJECT, 'test-results')
const TARGET_TITLE = 'Pixmint Window Long E2E'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPage(app, selector, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      try {
        if ((await page.locator(selector).count()) > 0) return page
      } catch {
        // 窗口可能正在切换路由或销毁，下一轮继续找。
      }
    }
    await sleep(120)
  }
  throw new Error(`等待页面 ${selector} 超时`)
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true })
  const targetPath = path.join(OUTPUT, 'window-long-target.html')
  const profilePath = path.join(OUTPUT, 'window-long-edge-profile')
  fs.mkdirSync(profilePath, { recursive: true })
  const sections = Array.from({ length: 28 }, (_, index) => {
    const n = String(index + 1).padStart(2, '0')
    return `<section><h2>Section ${n}</h2><p>${'Pixmint window long capture test content. '.repeat(8)}</p></section>`
  }).join('')
  fs.writeFileSync(
    targetPath,
    `<!doctype html><html><head><meta charset="utf-8"><title>${TARGET_TITLE}</title>
    <style>
      html,body{margin:0;background:#f4f6fa;color:#111827;font:14px/1.6 sans-serif}
      header{position:sticky;top:0;padding:18px 22px;background:#1d4ed8;color:white;font-weight:700}
      main{padding:0 22px 80px}section{padding:24px 0;border-bottom:1px solid #d7ddea}
      h2{margin:0 0 10px;font-size:20px}p{margin:0;color:#334155}
    </style></head><body><header>${TARGET_TITLE}</header><main>${sections}</main></body></html>`,
    'utf8'
  )

  const edge = spawn(
    EDGE,
    [
      `--app=${pathToFileURL(targetPath).href}`,
      `--user-data-dir=${profilePath}`,
      '--window-size=900,760',
      '--window-position=820,100',
      '--no-first-run',
      '--disable-features=msEdgeFirstRunExperience'
    ],
    { stdio: 'ignore' }
  )
  await sleep(2200)

  let app
  try {
    app = await electron.launch({
      executablePath: ELECTRON,
      args: ['.', '--smoke-overlay'],
      cwd: PROJECT,
      env: { ...process.env }
    })
    app.process().stdout?.on('data', (data) => console.log('MAIN', String(data).trim()))
    app.process().stderr?.on('data', (data) => console.log('MAIN_ERR', String(data).trim()))

    const overlay = await app.firstWindow()
    overlay.on('pageerror', (error) => console.log('PAGEERROR', error.message))
    await overlay.waitForSelector('.overlay-root', { timeout: 15000 })
    await overlay.waitForTimeout(800)
    await overlay.bringToFront()
    await overlay.evaluate(() => window.focus())

    const viewport = await overlay.evaluate(() => ({
      width: innerWidth,
      height: innerHeight
    }))
    await overlay.mouse.move(90, 80)
    await overlay.mouse.down()
    await overlay.mouse.move(Math.min(viewport.width - 90, 980), 620, { steps: 8 })
    await overlay.mouse.up()
    await overlay.waitForSelector('.tooldock', { timeout: 5000 })

    const longButton = overlay.locator('.tb-long')
    const text = (await longButton.innerText()).trim()
    const icons = await longButton.locator('svg').count()
    if (text !== '' || icons !== 1) throw new Error('长截图入口必须是纯图标按钮')

    await longButton.click()
    await overlay.waitForSelector('.window-picker', { timeout: 5000 })
    await overlay.waitForFunction(
      () => !document.querySelector('.window-picker')?.textContent?.includes('正在读取窗口'),
      undefined,
      { timeout: 8000 }
    )
    const rows = await overlay.locator('.window-picker-row').allTextContents()
    console.log('WINDOW_ROWS', rows)
    const targetRow = overlay
      .locator('.window-picker-row')
      .filter({ hasText: TARGET_TITLE })
      .first()
    if ((await targetRow.count()) !== 1) {
      throw new Error(`窗口列表里没有目标窗口：${rows.join(' | ')}`)
    }
    await targetRow.click()

    const selection = await waitForPage(app, '.long-selection-confirm')
    await selection.waitForSelector('.long-selection-box')
    const selectionTitle = (await selection.locator('.long-selection-confirm-head strong').innerText()).trim()
    if (!selectionTitle.includes(TARGET_TITLE)) {
      throw new Error(`选区页目标错误：${selectionTitle}`)
    }
    const box = await selection.locator('.long-selection-box').boundingBox()
    console.log('SELECTION', box, selectionTitle)
    if (!box || box.width < 120 || box.height < 120) {
      throw new Error('窗口内容区选区尺寸异常')
    }
    await selection.screenshot({
      path: path.join(OUTPUT, 'window-long-selection.png')
    })

    await selection.getByRole('button', { name: '重新选择' }).click()
    await overlay.waitForFunction(() => document.visibilityState === 'visible', undefined, {
      timeout: 8000
    })
    await overlay.waitForSelector('.window-picker', { timeout: 8000 })
    await overlay.waitForFunction(
      () => !document.querySelector('.window-picker')?.textContent?.includes('正在读取窗口'),
      undefined,
      { timeout: 8000 }
    )
    const secondTarget = overlay
      .locator('.window-picker-row')
      .filter({ hasText: TARGET_TITLE })
      .first()
    await secondTarget.click()
    const confirmedSelection = await waitForPage(app, '.long-selection-confirm')
    await confirmedSelection.waitForSelector('.long-selection-box')
    await confirmedSelection.getByRole('button', { name: '开始长截图' }).click()
    const hud = await waitForPage(app, '.hud-shell')
    await hud.waitForSelector('.hud-pill')
    await hud.waitForFunction(
      () => {
        const text = document.querySelector('.hud-meta')?.textContent ?? ''
        const match = /(\d+)\s*屏/.exec(text)
        return match ? Number(match[1]) >= 2 : false
      },
      undefined,
      { timeout: 20000 }
    )
    const meta = (await hud.locator('.hud-meta').innerText()).trim()
    console.log('HUD_META', meta)
    await hud.screenshot({ path: path.join(OUTPUT, 'window-long-hud.png') })
    await hud.getByRole('button', { name: '完成' }).click()

    const preview = await waitForPage(app, '.long-preview-root', 20000)
    await preview.waitForSelector('.long-preview-content img, .long-preview-content canvas')
    const previewSize = await preview.evaluate(() => {
      const image = document.querySelector(
        '.long-preview-content img, .long-preview-content canvas'
      )
      return image
        ? {
            tag: image.tagName,
            width: image.clientWidth,
            height: image.clientHeight
          }
        : null
    })
    console.log('PREVIEW', previewSize)
    await preview.screenshot({ path: path.join(OUTPUT, 'window-long-preview.png') })
    await preview.locator('.long-preview-close').click()

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: {
            iconOnly: 'pass',
            picker: 'pass',
            reselect: 'pass',
            selection: { title: selectionTitle, box },
            autoScroll: meta,
            preview: previewSize
          }
        },
        null,
        2
      )
    )
  } finally {
    if (app) await app.close().catch(() => {})
    edge.kill()
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      { ok: false, error: error instanceof Error ? error.stack : String(error) },
      null,
      2
    )
  )
  process.exitCode = 1
})
