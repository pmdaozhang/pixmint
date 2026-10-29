const { _electron: electron } = require('playwright-core')
const { spawn, execFileSync } = require('node:child_process')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const REGION = { x: 120, y: 162, width: 303, height: 20 }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForWindow(app, selector, timeout = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    for (const window of app.windows()) {
      try {
        if ((await window.locator(selector).count()) > 0) return window
      } catch {
        // closing
      }
    }
    await sleep(200)
  }
  throw new Error(`timeout waiting for ${selector}`)
}

function pressF1() {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `
Add-Type @"
using System;using System.Runtime.InteropServices;
public class PixmintOcrFocus { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
"@
$p = Get-Process electron | Where-Object { $_.MainWindowTitle -eq 'Electron' } | Select-Object -First 1
if ($p) { [PixmintOcrFocus]::SetForegroundWindow($p.MainWindowHandle) | Out-Null }
Start-Sleep -Milliseconds 300
$shell = New-Object -ComObject WScript.Shell
$shell.SendKeys('{F1}')
`
    ],
    { stdio: 'ignore' }
  )
}

;(async () => {
  const fixture = spawn(ELECTRON, [path.join(PROJECT, 'scripts', 'ocr-line-fixture.cjs')], {
    stdio: 'ignore'
  })
  // 夹具必须先完成首帧绘制，否则覆盖层预热时截到的是它出现前的桌面。
  await sleep(2000)
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  try {
    await sleep(500)
    pressF1()
    const overlay = await waitForWindow(app, '.overlay-root', 15000)
    await overlay.waitForSelector('.overlay-root', { timeout: 8000 })
    await overlay.waitForFunction(() => document.visibilityState === 'visible', undefined, {
      timeout: 10000
    })
    await overlay.bringToFront()
    await overlay.evaluate(() => window.focus())
    await sleep(700)
    await overlay.mouse.move(REGION.x, REGION.y)
    await overlay.mouse.down()
    await overlay.mouse.move(REGION.x + REGION.width, REGION.y + REGION.height, { steps: 6 })
    await overlay.mouse.up()
    await overlay.waitForSelector('.tooldock', { timeout: 8000 })
    await overlay.screenshot({
      path: path.join(PROJECT, 'test-results', 'ocr-303x20-selection.png'),
      clip: REGION
    })
    await overlay.screenshot({
      path: path.join(PROJECT, 'test-results', 'ocr-303x20-full.png')
    })
    await overlay.locator('.act[title="识别选区文字"]').click()

    const ocr = await waitForWindow(app, '.ocr-root', 20000)
    await ocr.waitForSelector('.ocr-root', { timeout: 8000 })
    await sleep(1200)
    const text = await ocr.locator('.ocr-compact-input').inputValue().catch(async () =>
      ocr.locator('.ocr-compact-input').innerText()
    )
    console.log('OCR_303x20_TEXT', JSON.stringify(text))
    console.log(
      'OCR_WINDOW_TEXT',
      JSON.stringify((await ocr.locator('.ocr-root').innerText()).replace(/\s+/g, ' '))
    )
    if (!text || !text.trim()) throw new Error('OCR returned empty text')
    if (!/[\u4e00-\u9fa5]/.test(text)) throw new Error('OCR text has no Chinese characters')
    console.log('OCR_303x20_OK')
    await ocr.keyboard.press('Escape').catch(() => {})
  } finally {
    await app.close().catch(() => {})
    fixture.kill()
  }
})().catch((error) => {
  console.error('OCR_303x20_FAIL', error)
  process.exit(1)
})
