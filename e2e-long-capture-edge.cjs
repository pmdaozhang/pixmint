const { _electron: electron } = require('playwright-core')
const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const SELECTION = { x: 100, y: 165, width: 700, height: 500 }
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

function buildPage() {
  const rows = Array.from({ length: 160 }, (_, index) => {
    const marker = ((index * 41) % 89).toString(16).padStart(2, '0')
    return `<div class="row"><span>${index + 1}</span>Edge long capture row ${index + 1} · ${marker}</div>`
  }).join('')
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Pixmint Edge Long Capture</title>
    <style>
      html, body { margin: 0; background: #f8fafc; color: #0f172a; font: 13px/20px Consolas, monospace; }
      header {
        position: sticky; top: 0; z-index: 2; height: 36px; display: flex; align-items: center;
        padding: 0 16px; background: #fff; border-bottom: 1px solid #cbd5e1; font-weight: 700;
      }
      .row { height: 20px; padding: 0 16px; border-bottom: 1px solid #e2e8f0; display: flex; gap: 16px; }
      .row:nth-child(4n) { background: #f1f5f9; }
      .row span { width: 48px; color: #64748b; text-align: right; }
    </style>
  </head>
  <body>
    <header>Pixmint Edge Long Capture · fixed header</header>
    ${rows}
  </body>
</html>`
}

function killTree(process) {
  if (!process || process.killed) return
  spawn('taskkill', ['/PID', String(process.pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true
  })
}

function listEdgeWindows() {
  try {
    const script =
      'Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object Id,MainWindowTitle,MainWindowHandle | ConvertTo-Json -Compress'
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8'
    }).trim()
    console.log('EDGE_WINDOWS', output)
  } catch (error) {
    console.log('EDGE_WINDOWS_ERROR', error.message)
  }
}

function captureEdgeWindow() {
  const imagePath = path.join(PROJECT, 'test-results', 'edge-window.png')
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PixmintRect {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@
$p = Get-Process msedge | Where-Object { $_.MainWindowTitle -eq 'Pixmint Edge Long Capture' } | Select-Object -First 1
$r = New-Object PixmintRect+RECT
[PixmintRect]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save('${imagePath.replace(/\\/g, '/')}', [System.Drawing.Imaging.ImageFormat]::Png)
"$($r.Left),$($r.Top),$($r.Right),$($r.Bottom)"
`
  try {
    const rect = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8'
    }).trim()
    console.log('EDGE_WINDOW_RECT', rect)
  } catch (error) {
    console.log('EDGE_WINDOW_CAPTURE_ERROR', error.message)
  }
}

;(async () => {
  const profile = path.join(os.tmpdir(), `pixmint-edge-${Date.now()}`)
  fs.mkdirSync(profile, { recursive: true })
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(buildPage())
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const edge = spawn(
    EDGE,
    [
      `--app=http://127.0.0.1:${port}/`,
      `--user-data-dir=${profile}`,
      '--window-position=80,80',
      '--window-size=900,700',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-background-networking'
    ],
    { stdio: 'ignore', windowsHide: false }
  )

  let app = null
  try {
    await sleep(4500)
    listEdgeWindows()
    captureEdgeWindow()
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
    console.log('EDGE_LONG_CAPTURE', image, footer)
    if (image.width !== SELECTION.width || image.height < 1000) {
      throw new Error('Edge long capture did not produce a tall image')
    }
    if (!footer.includes(`${image.width} × ${image.height}`)) {
      throw new Error('Edge preview footer does not match image size')
    }
    const info = await preview.evaluate(() => window.snapglass.longCapture.previewInfo())
    if (info?.filePath) {
      fs.copyFileSync(info.filePath, path.join(PROJECT, 'test-results', 'edge-long-capture.png'))
    }
    await preview.locator('.long-preview-close').click()
    await sleep(800)

    console.log('EDGE_LONG_CAPTURE_OK')
    await app.close()
    killTree(edge)
    server.close()
    process.exit(0)
  } catch (error) {
    console.error('EDGE_LONG_CAPTURE_FAIL', error)
    await app?.close().catch(() => {})
    killTree(edge)
    server.close()
    process.exit(1)
  }
})()
