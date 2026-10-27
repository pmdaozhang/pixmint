const { _electron: electron } = require('playwright-core')
const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const NOTEPAD = 'C:\\Windows\\system32\\notepad.exe'
const SELECTION = { x: 100, y: 210, width: 700, height: 480 }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForWindow(app, selector, timeout = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    for (const window of app.windows()) {
      try {
        if ((await window.locator(selector).count()) > 0) return window
      } catch {
        // window may be closing
      }
    }
    await sleep(200)
  }
  throw new Error(`timeout waiting for ${selector}`)
}

async function showOverlay(app) {
  const active = await app.evaluate(() => globalThis.__snapglassOverlayActive?.())
  if (!active) await app.evaluate(() => globalThis.__snapglassShowOverlay?.())
  const overlay = await waitForWindow(app, '.overlay-root', 15000)
  await overlay.waitForSelector('.overlay-root', { timeout: 8000 })
  await overlay.waitForFunction(() => document.visibilityState === 'visible', undefined, {
    timeout: 10000
  })
  await overlay.bringToFront()
  await overlay.evaluate(() => window.focus())
  await sleep(800)
  return overlay
}

async function selectRegion(overlay) {
  await overlay.mouse.move(SELECTION.x, SELECTION.y)
  await overlay.mouse.down()
  await overlay.mouse.move(
    SELECTION.x + SELECTION.width,
    SELECTION.y + SELECTION.height,
    { steps: 8 }
  )
  await overlay.mouse.up()
  await overlay.waitForSelector('.tooldock', { timeout: 8000 })
}

function positionNotepad() {
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PixmintNotepad {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$p = Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*pixmint-long-notepad*' } | Select-Object -First 1
if (-not $p) { exit 2 }
[PixmintNotepad]::MoveWindow($p.MainWindowHandle, 80, 80, 900, 700, $true) | Out-Null
[PixmintNotepad]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 500
$r = New-Object PixmintNotepad+RECT
[PixmintNotepad]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$out = '${path.join(PROJECT, 'test-results', 'notepad-window.png').replace(/\\/g, '/')}'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
"$($r.Left),$($r.Top),$($r.Right),$($r.Bottom)"
`
  try {
    const rect = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8'
    }).trim()
    console.log('NOTEPAD_WINDOW_RECT', rect)
  } catch (error) {
    console.log('NOTEPAD_WINDOW_ERROR', error.message)
  }
}

function killTree(process) {
  if (!process || process.killed) return
  spawn('taskkill', ['/PID', String(process.pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true
  })
}

;(async () => {
  const file = path.join(os.tmpdir(), 'pixmint-long-notepad.txt')
  const lines = Array.from({ length: 700 }, (_, index) => {
    const marker = ((index * 53) % 101).toString(16).padStart(2, '0')
    return `Pixmint notepad long line ${String(index + 1).padStart(4, '0')} · ${marker}`
  })
  fs.writeFileSync(file, lines.join('\r\n'), 'utf8')
  const notepad = spawn(NOTEPAD, [file], { stdio: 'ignore', windowsHide: false })

  let app = null
  try {
    await sleep(3500)
    positionNotepad()
    await sleep(800)
    app = await electron.launch({
      executablePath: ELECTRON,
      args: ['.', '--smoke-overlay'],
      cwd: PROJECT,
      env: { ...process.env }
    })
    app.process().stdout?.on('data', (data) => console.log('MAIN', String(data).trim()))
    app.process().stderr?.on('data', (data) => console.log('MAIN_ERR', String(data).trim()))

    const overlay = await showOverlay(app)
    await selectRegion(overlay)
    await overlay.locator('.tb[title="长截图"]').click()
    const hud = await waitForWindow(app, '.hud-card', 15000)
    await hud.waitForSelector('.hud-card', { timeout: 5000 })
    const preview = await waitForWindow(app, '.long-preview-root', 40000)
    await preview.waitForSelector('.long-preview-root', { timeout: 8000 })
    await preview.waitForFunction(
      () => {
        const image = document.querySelector('.long-preview-content img')
        return Boolean(image && image.complete && image.naturalWidth > 0)
      },
      undefined,
      { timeout: 15000 }
    )
    const image = await preview.locator('.long-preview-content img').evaluate((element) => ({
      width: element.naturalWidth,
      height: element.naturalHeight,
      src: element.src
    }))
    const footer = (await preview.locator('.long-preview-footer').innerText()).replace(/\s+/g, ' ')
    console.log('NOTEPAD_LONG_CAPTURE', image, footer)
    if (image.width !== SELECTION.width || image.height < 1000) {
      throw new Error('Notepad long capture did not produce a tall image')
    }
    const info = await preview.evaluate(() => window.snapglass.longCapture.previewInfo())
    if (info?.filePath) {
      fs.copyFileSync(
        info.filePath,
        path.join(PROJECT, 'test-results', 'notepad-long-capture.png')
      )
    }
    await preview.locator('.long-preview-close').click()
    await sleep(800)

    console.log('NOTEPAD_LONG_CAPTURE_OK')
    await app.close()
    killTree(notepad)
    process.exit(0)
  } catch (error) {
    console.error('NOTEPAD_LONG_CAPTURE_FAIL', error)
    await app?.close().catch(() => {})
    killTree(notepad)
    process.exit(1)
  }
})()
