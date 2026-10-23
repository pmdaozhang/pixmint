import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Rect } from '../shared/types'
import { logDiagnostic } from './diagnostics'
import { SidecarClient } from './sidecar/client'

const CAPTURE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SnapGlassDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@

try { [SnapGlassDpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch { }
try { [SnapGlassDpi]::SetProcessDPIAware() | Out-Null } catch { }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(',')
  if ($parts.Length -ne 5) { continue }
  $id = $parts[0]
  $graphics = $null
  $bitmap = $null
  $stream = $null
  try {
    $x = [int]$parts[1]
    $y = [int]$parts[2]
    $width = [int]$parts[3]
    $height = [int]$parts[4]
    if ($width -le 0 -or $height -le 0) { throw 'invalid size' }
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($x, $y, 0, 0, $bitmap.Size)
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $base64 = [Convert]::ToBase64String($stream.ToArray())
    [Console]::Out.WriteLine("$id|$base64")
    [Console]::Out.Flush()
  } catch {
    [Console]::Out.WriteLine("$id|ERROR")
    [Console]::Out.Flush()
  } finally {
    if ($graphics) { $graphics.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
    if ($stream) { $stream.Dispose() }
  }
}
`

let scriptPath = ''

function captureScriptPath(): string {
  if (scriptPath) return scriptPath
  scriptPath = join(tmpdir(), `snapglass-fast-capture-${process.pid}.ps1`)
  writeFileSync(scriptPath, CAPTURE_SCRIPT, 'utf8')
  return scriptPath
}

function removeCaptureScript(): void {
  if (!scriptPath) return
  try {
    if (existsSync(scriptPath)) unlinkSync(scriptPath)
  } catch {
    // 临时脚本清理失败不应影响退出
  }
  scriptPath = ''
}

/**
 * 背景：desktopCapturer 单次调用固定要 0.6-0.8 秒，F1 需要更快的冻结画面。
 * 设计意图：保留常驻 PowerShell + GDI CopyFromScreen，但把进程生命周期交给通用 SidecarClient。
 * 关键约束：request 会取消旧请求；超时返回 null，由调用方回退到 desktopCapturer。
 */
export class FastCapture {
  private warmed = false
  private disposed = false
  private readonly client = new SidecarClient({
    name: 'fast-capture',
    launch: () => ({
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        captureScriptPath()
      ]
    }),
    defaultTimeoutMs: 900,
    onLog: (message) => logDiagnostic('fast-capture', message, 'warn')
  })

  prewarm(): void {
    if (this.disposed) return
    this.client.ensureStarted()
    void this.capture({ x: 0, y: 0, width: 1, height: 1 }, 2000).then((dataUrl) => {
      this.warmed = Boolean(dataUrl)
    })
  }

  async capture(rect: Rect, timeout?: number): Promise<string | null> {
    if (this.disposed) return null
    const x = Math.round(rect.x)
    const y = Math.round(rect.y)
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    const payload = await this.client.request(
      `${x},${y},${width},${height}`,
      timeout ?? (this.warmed ? 450 : 900)
    )
    if (!payload || payload === 'ERROR') return null
    return `data:image/png;base64,${payload}`
  }

  dispose(): void {
    this.disposed = true
    this.client.dispose()
    removeCaptureScript()
  }
}

export const fastCapture = new FastCapture()
