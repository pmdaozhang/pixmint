import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Rect } from '../shared/types'

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

interface PendingCapture {
  id: number
  resolve: (dataUrl: string | null) => void
  timer: NodeJS.Timeout
}

/**
 * Windows GDI 截屏助手。desktopCapturer 单次调用固定要 0.6-0.8 秒，
 * 这里用常驻 PowerShell 进程 + CopyFromScreen，单次约 150-300ms。
 */
export class FastCapture {
  private process: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private pending: PendingCapture | null = null
  private nextId = 1
  private warmed = false
  private disposed = false

  prewarm(): void {
    if (this.disposed) return
    this.ensureStarted()
    void this.capture({ x: 0, y: 0, width: 1, height: 1 }, 2000).then((dataUrl) => {
      this.warmed = Boolean(dataUrl)
    })
  }

  async capture(rect: Rect, timeout?: number): Promise<string | null> {
    if (this.disposed) return null
    this.ensureStarted()
    if (!this.process?.stdin.writable) return null

    const previous = this.pending
    if (previous) {
      clearTimeout(previous.timer)
      previous.resolve(null)
      this.pending = null
    }

    const id = this.nextId++
    return new Promise((resolve) => {
      const effectiveTimeout = timeout ?? (this.warmed ? 450 : 900)
      const timer = setTimeout(() => {
        if (this.pending?.id === id) {
          this.pending = null
          this.restart()
        }
        resolve(null)
      }, effectiveTimeout)
      this.pending = { id, resolve, timer }
      try {
        const x = Math.round(rect.x)
        const y = Math.round(rect.y)
        const width = Math.round(rect.width)
        const height = Math.round(rect.height)
        this.process?.stdin.write(`${id},${x},${y},${width},${height}\n`)
      } catch {
        this.finish(id, null)
      }
    })
  }

  dispose(): void {
    this.disposed = true
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.resolve(null)
      this.pending = null
    }
    this.process?.kill()
    this.process = null
  }

  private ensureStarted(): void {
    if (this.process || this.disposed) return
    try {
      const scriptPath = join(tmpdir(), 'snapglass-fast-capture.ps1')
      writeFileSync(scriptPath, CAPTURE_SCRIPT, 'utf8')
      const child = spawn(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => this.onData(chunk))
      child.stderr.on('data', () => {})
      child.on('exit', () => {
        if (this.process === child) this.process = null
        if (this.pending) {
          clearTimeout(this.pending.timer)
          const { resolve } = this.pending
          this.pending = null
          resolve(null)
        }
      })
      this.process = child
    } catch {
      this.process = null
    }
  }

  private restart(): void {
    this.process?.kill()
    this.process = null
    this.buffer = ''
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      const separator = line.indexOf('|')
      if (separator < 0) continue
      const id = Number(line.slice(0, separator))
      const payload = line.slice(separator + 1)
      if (!this.pending || this.pending.id !== id) continue
      this.finish(id, payload === 'ERROR' ? null : `data:image/png;base64,${payload}`)
    }
  }

  private finish(id: number, dataUrl: string | null): void {
    if (!this.pending || this.pending.id !== id) return
    clearTimeout(this.pending.timer)
    const { resolve } = this.pending
    this.pending = null
    resolve(dataUrl)
  }
}

export const fastCapture = new FastCapture()
