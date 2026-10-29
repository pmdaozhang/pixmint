const { _electron: electron } = require('playwright-core')
const { spawn, execFileSync } = require('node:child_process')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const REGION = { x: 120, y: 158, width: 220, height: 34 }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForWindow(app, selector, timeout = 20000) {
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
public class PixmintWordFocus { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
"@
$p = Get-Process electron | Where-Object { $_.MainWindowTitle -eq 'Electron' } | Select-Object -First 1
if ($p) { [PixmintWordFocus]::SetForegroundWindow($p.MainWindowHandle) | Out-Null }
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
    stdio: 'ignore',
    env: { ...process.env, OCR_FIXTURE_TEXT: 'tomato', OCR_FIXTURE_SIZE: '28' }
  })
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
    await sleep(600)
    await overlay.mouse.move(REGION.x, REGION.y)
    await overlay.mouse.down()
    await overlay.mouse.move(REGION.x + REGION.width, REGION.y + REGION.height, { steps: 6 })
    await overlay.mouse.up()
    await overlay.waitForSelector('.tooldock', { timeout: 8000 })
    await overlay.locator('.act[title="识别并翻译"]').click()

    const ocr = await waitForWindow(app, '.ocr-root', 20000)
    await ocr.waitForSelector('.word-card', { timeout: 15000 })
    const card = (await ocr.locator('.word-card').innerText()).replace(/\s+/g, ' ')
    console.log('WORD_CARD', JSON.stringify(card))
    if (!/tomato/i.test(card)) throw new Error('word card missing word')
    if (!/英/.test(card) || !/美/.test(card)) throw new Error('word card missing UK/US phonetics')
    console.log('WORD_CARD_OK')
    await ocr.keyboard.press('Escape').catch(() => {})
  } finally {
    await app.close().catch(() => {})
    fixture.kill()
  }
})().catch((error) => {
  console.error('WORD_CARD_FAIL', error)
  process.exit(1)
})
