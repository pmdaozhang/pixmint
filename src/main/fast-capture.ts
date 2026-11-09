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

const WARM_TIMEOUT_MS = 450
const PREWARM_TIMEOUT_MS = 2500
const KEEPALIVE_INTERVAL_MS = 30_000
const KEEPALIVE_TIMEOUT_MS = 1500

/**
 * 背景：desktopCapturer 单次调用固定要 0.6-0.8 秒，F1 需要更快的冻结画面。
 * 设计意图：保留常驻 PowerShell + GDI CopyFromScreen，但把进程生命周期交给通用 SidecarClient。
 * 关键约束：request 会取消旧请求；超时返回 null，由调用方回退到 desktopCapturer。
 */
export class FastCapture {
  private warmed = false
  private disposed = false
  /** 预热请求进行中时不能再发截图请求，否则 SidecarClient 会取消预热。 */
  private prewarming = false
  private capturing = false
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
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
    onLog: (message) => logDiagnostic('fast-capture', message, 'warn'),
    // 系统睡眠/会话切换会杀掉常驻 PowerShell；退出后立刻后台重启，
    // 不把冷启动拖到下一次 F1。
    onExit: () => {
      this.warmed = false
      this.startPrewarm()
    }
  })

  prewarm(): void {
    if (this.disposed) return
    this.startPrewarm()
    if (!this.keepaliveTimer) {
      // Windows 会把空闲的后台 PowerShell/GDI 路径放到冷状态，表现为
      // “连续用很快，放一会儿第一次又慢”。定时 1x1 截图让助手保持热态。
      this.keepaliveTimer = setInterval(() => this.keepalive(), KEEPALIVE_INTERVAL_MS)
    }
  }

  private keepalive(): void {
    if (this.disposed || this.capturing || this.prewarming) return
    if (!this.client.isRunning) {
      this.warmed = false
      this.startPrewarm()
      return
    }
    void this.client.request('0,0,1,1', KEEPALIVE_TIMEOUT_MS).then(() => {
      if (this.disposed) return
      // 超时会由 SidecarClient 杀掉子进程；此时立刻重新预热。
      if (!this.client.isRunning) {
        this.warmed = false
        this.startPrewarm()
      }
    })
  }

  /**
   * 后台预热。系统睡眠/切换会话后常驻 PowerShell 可能被系统杀掉，
   * 这里用独立的较长超时重新拉起，避免下一次 F1 仍按 450ms 的热态超时去等冷启动。
   */
  private startPrewarm(): void {
    if (this.disposed || this.prewarming || this.capturing) return
    this.prewarming = true
    this.client.ensureStarted()
    void this.client
      .request('0,0,1,1', PREWARM_TIMEOUT_MS)
      .then((payload) => {
        if (this.disposed) return
        this.warmed = Boolean(payload && payload !== 'ERROR')
        logDiagnostic(
          'fast-capture',
          this.warmed ? 'prewarm ok' : 'prewarm failed',
          this.warmed ? 'info' : 'warn'
        )
      })
      .catch((error: unknown) => {
        this.warmed = false
        logDiagnostic('fast-capture', `prewarm error: ${String(error)}`, 'warn')
      })
      .finally(() => {
        this.prewarming = false
      })
  }

  async capture(rect: Rect, timeout?: number): Promise<string | null> {
    if (this.disposed) return null
    // 助手不在或还没热起来时不要阻塞 F1：立即回退 desktopCapturer，
    // 同时在后台重新预热，下一次按键就能恢复快速路径。
    if (!this.warmed || this.prewarming || !this.client.isRunning) {
      logDiagnostic('fast-capture', 'helper not warm; falling back', 'warn')
      this.startPrewarm()
      return null
    }
    const x = Math.round(rect.x)
    const y = Math.round(rect.y)
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    this.capturing = true
    let needsPrewarm = false
    try {
      const payload = await this.client.request(
        `${x},${y},${width},${height}`,
        timeout ?? WARM_TIMEOUT_MS
      )
      if (!payload) {
        // 超时后 SidecarClient 已经重启了子进程，必须按冷态重新预热。
        this.warmed = false
        needsPrewarm = true
        return null
      }
      if (payload === 'ERROR') return null
      return `data:image/png;base64,${payload}`
    } finally {
      this.capturing = false
      if (needsPrewarm) this.startPrewarm()
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
    this.client.dispose()
    removeCaptureScript()
  }
}

export const fastCapture = new FastCapture()
