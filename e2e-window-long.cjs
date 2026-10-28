const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { _electron: electron } = require('playwright-core')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const OUTPUT = path.join(PROJECT, 'test-results')
const USER_DATA = path.join(OUTPUT, 'e2e-window-long-profile')
const APP_LOG = path.join(USER_DATA, 'snapglass.log')
const TARGET_TITLE = 'Pixmint Window Long E2E'
const FAILURE_MODE = process.argv.includes('--failure')
const LARGE_SELECTION_MODE = process.argv.includes('--large-selection')
const TO_BOTTOM_MODE = process.argv.includes('--to-bottom')
const AUTO_TO_BOTTOM = LARGE_SELECTION_MODE || TO_BOTTOM_MODE

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

async function waitForHudPill(app, expected, timeout = 25000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      try {
        const pill = page.locator('.hud-pill')
        if ((await pill.count()) === 0) continue
        if ((await pill.innerText()).trim() === expected) return page
      } catch {
        // HUD 可能在切模式时销毁重建，下一轮继续找新页面。
      }
    }
    await sleep(160)
  }
  throw new Error(`等待 HUD 状态 ${expected} 超时`)
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true })
  fs.mkdirSync('C:\\Temp', { recursive: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  const targetPath = 'C:\\Temp\\pixmint-e2e-target.html'
  const profilePath = 'C:\\Temp\\pixmint-e2e-profile'
  fs.mkdirSync(profilePath, { recursive: true })
  const sectionCount = 32
  const sections = Array.from({ length: sectionCount }, (_, index) => {
    const n = String(index + 1).padStart(2, '0')
    const hue = Math.round((index * 360) / sectionCount)
    return `<section style="--marker:hsl(${hue} 70% 45%)"><div class="marker"></div><h2>Section ${n}</h2><p>${'Pixmint window long capture test content. '.repeat(8)}</p></section>`
  }).join('')
  const failureNoise = FAILURE_MODE
    ? `<style>html,body{height:100%;overflow:hidden !important}#scroller{height:100%;overflow:hidden !important}</style>`
    : ''
  const initialScroll = LARGE_SELECTION_MODE ? '0' : '600'
  fs.writeFileSync(
    targetPath,
    `<!doctype html><html><head><meta charset="utf-8"><title>${TARGET_TITLE}</title>
    <style>
      html,body{margin:0;background:#f4f6fa;color:#111827;font:14px/1.6 sans-serif}
      header{position:sticky;top:0;padding:18px 22px;background:#1d4ed8;color:white;font-weight:700}
      main{padding:0 22px 80px}section{padding:24px 0;border-bottom:1px solid #d7ddea}
      h2{margin:0 0 10px;font-size:20px}p{margin:0;color:#334155}
      .marker{height:4px;margin:0 0 10px;border-radius:2px;background:var(--marker)}
    </style></head><body><header>${TARGET_TITLE}</header><main>${sections}</main>${failureNoise}
    <script>addEventListener('load', () => setTimeout(() => scrollTo(0, ${initialScroll}), 300))</script>
    </body></html>`,
    'utf8'
  )

  const target = spawn(
    EDGE,
    [
      '--new-window',
      pathToFileURL(targetPath).href,
      '--window-size=1400,900',
      '--window-position=100,100',
      `--user-data-dir=${profilePath}`,
      '--no-first-run',
      '--disable-extensions',
      '--disable-session-crashed-bubble'
    ],
    { stdio: 'ignore' }
  )
  await sleep(2500)
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(PROJECT, 'scripts', 'spike', 'focus-window-topmost.ps1'),
    '-Title',
    TARGET_TITLE
  ])
  await sleep(500)

  let app
  try {
    app = await electron.launch({
      executablePath: ELECTRON,
      args: ['.', '--smoke-overlay'],
      cwd: PROJECT,
      env: { ...process.env, PIXMINT_USER_DATA_DIR: USER_DATA }
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
    const selectionStart = LARGE_SELECTION_MODE ? [20, 20] : [110, 140]
    const selectionEnd = LARGE_SELECTION_MODE
      ? [viewport.width - 20, viewport.height - 20]
      : [Math.min(viewport.width - 80, 1290), 740]
    await overlay.mouse.move(selectionStart[0], selectionStart[1])
    await overlay.mouse.down()
    await overlay.mouse.move(selectionEnd[0], selectionEnd[1], { steps: 8 })
    await overlay.mouse.up()
    await overlay.waitForSelector('.tooldock', { timeout: 5000 })

    const longButton = overlay.locator('.tb-long')
    const text = (await longButton.innerText()).trim()
    const icons = await longButton.locator('svg').count()
    if (text !== '' || icons !== 1) throw new Error('长截图入口必须是纯图标按钮')

    await longButton.click()
    await sleep(250)
    if ((await overlay.locator('.window-picker').count()) !== 0) {
      throw new Error('点击长截图后不应出现窗口选择器')
    }

    const hud = await waitForPage(app, '.hud-shell')
    await hud.waitForSelector('.hud-pill')
    if (FAILURE_MODE) {
      const errorHud = await waitForHudPill(app, '已停止')
      const tone = await errorHud.locator('.hud-card').getAttribute('data-tone')
      const manualButtonCount = await errorHud.getByRole('button', { name: '改手动' }).count()
      console.log('NO_MANUAL_ERROR', tone, manualButtonCount)
      if (tone !== 'error' || manualButtonCount !== 0) {
        throw new Error(`手动兜底未移除：tone=${tone}, manualButtons=${manualButtonCount}`)
      }
      await errorHud.screenshot({ path: path.join(OUTPUT, 'window-long-no-manual.png') })
      await errorHud.getByRole('button', { name: '关闭' }).click()
      console.log(
        JSON.stringify(
          {
            ok: true,
            checks: {
              errorState: 'pass',
              manualRemoved: 'pass'
            }
          },
          null,
          2
        )
      )
      return
    }
    const pauseButton = hud.getByRole('button', { name: '暂停' })
    if ((await hud.getByRole('button', { name: '回退一屏' }).count()) !== 0) {
      throw new Error('HUD 不应再显示“回退一屏”')
    }
    if ((await pauseButton.count()) > 0) {
      await hud.waitForFunction(
        () => {
          const text = document.querySelector('.hud-meta')?.textContent ?? ''
          const match = /(\d+)\s*屏/.exec(text)
          return match ? Number(match[1]) >= 1 : false
        },
        undefined,
        { timeout: 8000 }
      )
      await pauseButton.click()
      await hud.waitForFunction(
        () => document.querySelector('.hud-card')?.getAttribute('data-tone') === 'paused',
        undefined,
        { timeout: 5000 }
      )
      const fillBefore = await hud
        .locator('.hud-fill')
        .evaluate((element) => {
          const style = getComputedStyle(element)
          return { animationName: style.animationName, width: style.width }
        })
      await sleep(600)
      const fillAfter = await hud
        .locator('.hud-fill')
        .evaluate((element) => getComputedStyle(element).width)
      if (fillBefore.animationName !== 'none' || fillBefore.width !== fillAfter) {
        throw new Error(
          `暂停后进度条仍在运动：${JSON.stringify({ fillBefore, fillAfter })}`
        )
      }
      await hud.getByRole('button', { name: '继续' }).click()
    }
    await sleep(350)
    const borderPages = app
      .windows()
      .filter((page) => page.url().includes('long-capture-border'))
    const borderParts = []
    for (const page of borderPages) {
      const part = page.locator('[data-part]').first()
      const partName = await part.getAttribute('data-part')
      const style = await part.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return {
          width: rect.width,
          height: rect.height,
          background: getComputedStyle(element).backgroundColor
        }
      })
      borderParts.push({ partName, ...style })
    }
    console.log('BORDER_PARTS', borderParts)
    const partNames = borderParts.map((item) => item.partName).sort()
    if (partNames.join(',') !== 'bottom,label,left,right,top') {
      throw new Error(`长截图边界窗不完整：${partNames.join(',')}`)
    }
    for (const part of borderParts) {
      if (part.partName === 'label') continue
      if (part.width <= 0 || part.height <= 0 || part.background === 'rgba(0, 0, 0, 0)') {
        throw new Error(`长截图边界 ${part.partName} 未绘制`)
      }
    }
    let meta = AUTO_TO_BOTTOM ? 'auto-to-bottom' : ''
    if (!AUTO_TO_BOTTOM) {
      await hud.waitForFunction(
        () => {
          const text = document.querySelector('.hud-meta')?.textContent ?? ''
          const match = /(\d+)\s*屏/.exec(text)
          return match ? Number(match[1]) >= 10 : false
        },
        undefined,
        { timeout: 30000 }
      )
      meta = (await hud.locator('.hud-meta').innerText()).trim()
      console.log('HUD_META', meta)
      await hud.screenshot({ path: path.join(OUTPUT, 'window-long-hud.png') })
      await hud.getByRole('button', { name: '完成' }).click()
    }

    const preview = await waitForPage(
      app,
      '.long-preview-root',
      AUTO_TO_BOTTOM ? 45000 : 20000
    )
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
    const previewLayout = await preview.evaluate(() => {
      const content = document.querySelector('.long-preview-content')
      const image = document.querySelector('.long-preview-content img')
      if (!content || !image) return null
      const style = getComputedStyle(content)
      return {
        scrollWidth: content.scrollWidth,
        clientWidth: content.clientWidth,
        imageWidth: image.getBoundingClientRect().width,
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor
      }
    })
    if (
      !previewLayout ||
      previewLayout.scrollWidth > previewLayout.clientWidth + 1 ||
      previewLayout.imageWidth > previewLayout.clientWidth + 1 ||
      previewLayout.backgroundImage !== 'none'
    ) {
      throw new Error(`预览布局不符合要求：${JSON.stringify(previewLayout)}`)
    }
    const previewChrome = await preview.evaluate(() => {
      const root = document.querySelector('.long-preview-root')
      const windowElement = document.querySelector('.long-preview-window')
      if (!root || !windowElement) return null
      return {
        padding: getComputedStyle(root).padding,
        boxShadow: getComputedStyle(windowElement).boxShadow
      }
    })
    if (
      !previewChrome ||
      previewChrome.padding !== '48px' ||
      !previewChrome.boxShadow.includes('40px')
    ) {
      throw new Error(`预览窗阴影/边距不符合要求：${JSON.stringify(previewChrome)}`)
    }
    console.log('PREVIEW', previewSize)
    console.log('PREVIEW_LAYOUT', previewLayout)
    console.log('PREVIEW_CHROME', previewChrome)
    const previewActions = await preview
      .locator('.long-preview-action')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const style = getComputedStyle(element)
          return {
            text: element.textContent?.trim() ?? '',
            height: style.height,
            background: style.backgroundColor,
            border: style.borderColor,
            color: style.color
          }
        })
      )
    console.log('PREVIEW_ACTIONS', previewActions)
    const actionLabels = previewActions.map((action) => action.text)
    if (actionLabels.join('|') !== '复制|保存|×') {
      throw new Error(`预览窗操作按钮不符合要求：${actionLabels.join(',')}`)
    }
    if (
      new Set(previewActions.map((action) => action.height)).size !== 1 ||
      new Set(previewActions.map((action) => action.background)).size !== 1 ||
      new Set(previewActions.map((action) => action.border)).size !== 1
    ) {
      throw new Error(`预览窗按钮材质不一致：${JSON.stringify(previewActions)}`)
    }
    for (const name of ['缩小', '放大', '适应宽度']) {
      if ((await preview.getByRole('button', { name }).count()) !== 0) {
        throw new Error(`预览窗不应再显示“${name}”`)
      }
    }
    await preview.getByRole('button', { name: '复制' }).click()
    await preview.waitForFunction(
      () =>
        document
          .querySelector('.long-preview-footer')
          ?.textContent?.includes('已复制长截图到剪贴板') === true,
      undefined,
      { timeout: 5000 }
    )
    const appLog = fs.existsSync(APP_LOG)
      ? fs.readFileSync(APP_LOG, 'utf8')
      : ''
    const startPercentMatches = [
      ...appLog.matchAll(/uia start percent=([\d.]+)/g)
    ]
    const initialPercent = startPercentMatches.length
      ? Number(startPercentMatches[startPercentMatches.length - 1][1])
      : null
    if (
      !LARGE_SELECTION_MODE &&
      (initialPercent === null || initialPercent <= 0.1)
    ) {
      throw new Error(`长截图没有从当前滚动位置开始：${initialPercent}`)
    }
    const mediaUrl = await preview
      .locator('.long-preview-content img')
      .getAttribute('src')
    const resultPath = mediaUrl
      ? new URL(mediaUrl).searchParams.get('path') || ''
      : ''
    if (!resultPath || !fs.existsSync(resultPath)) {
      throw new Error(`无法读取长图结果文件：${resultPath}`)
    }
    const suffix = LARGE_SELECTION_MODE
      ? '-large'
      : TO_BOTTOM_MODE
        ? '-to-bottom'
        : ''
    const resultName = `window-long${suffix}-result.png`
    const previewName = `window-long${suffix}-preview.png`
    fs.copyFileSync(resultPath, path.join(OUTPUT, resultName))
    await preview.screenshot({ path: path.join(OUTPUT, previewName) })
    await preview.locator('.long-preview-close').click()

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: {
            iconOnly: 'pass',
            noWindowPicker: 'pass',
            border: borderParts,
            autoScroll: meta,
            preview: previewSize,
            previewLayout,
            previewChrome,
            previewActions,
            initialPercent,
            largeSelection: LARGE_SELECTION_MODE,
            toBottom: TO_BOTTOM_MODE,
            copy: 'pass',
            result: resultName
          }
        },
        null,
        2
      )
    )
  } finally {
    if (app) await app.close().catch(() => {})
    target.kill()
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'msedge*' -and $_.CommandLine -like '*pixmint-e2e-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
        ],
        { stdio: 'ignore' }
      )
    } catch {
      // 测试清理失败不应覆盖产品验证结果
    }
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
