import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Rect } from '../../shared/types'
import type { FrameImage } from '../../shared/long-capture'
import { logDiagnostic } from '../diagnostics'

const FRAME_MAGIC = 0x50464231 // "PFB1"
const HEADER_BYTES = 24
const MAX_FRAME_BYTES = 128 * 1024 * 1024

export interface FrameSource {
  readonly name: string
  capture(rect: Rect, timeoutMs?: number): Promise<FrameImage | null>
  dispose(): void
}

interface PendingFrame {
  id: number
  resolve: (frame: FrameImage | null) => void
  timer: NodeJS.Timeout
}

/**
 * 背景：长截图逐帧采 PNG 时，1080p 只有约 11fps，编码和 base64 往返成为瓶颈。
 * 设计意图：专用 PowerShell/C# sidecar 通过 stdout 输出原始 BGRA，Node 只做二进制拆包。
 * 关键约束：请求串行；stdout 只允许二进制帧，日志必须走 stderr；超时/坏帧直接重建进程。
 * PIXMINT_RAW_CAPTURE_SYNTHETIC=1 只用于 smoke，跳过 GDI，仍走真实二进制 stdout。
 */
const RAW_CAPTURE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Drawing | Out-Null
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public class PixmintRawCapture {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

  static PixmintRawCapture() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
    try { SetProcessDPIAware(); } catch { }
  }

  static void WriteFrame(
    BinaryWriter writer,
    uint id,
    int width,
    int height,
    byte[] payload,
    uint errorCode
  ) {
    writer.Write((uint)0x50464231);
    writer.Write(id);
    writer.Write((uint)width);
    writer.Write((uint)height);
    writer.Write((uint)payload.Length);
    writer.Write(errorCode);
    writer.Write(payload);
    writer.Flush();
  }

  public static void Capture(
    Stream output,
    uint id,
    int x,
    int y,
    int width,
    int height,
    bool synthetic
  ) {
    BinaryWriter writer = new BinaryWriter(output);
    try {
      if (width <= 0 || height <= 0) throw new ArgumentException("invalid size");

      byte[] payload;
      if (synthetic) {
        payload = new byte[width * height * 4];
        for (int index = 0; index < payload.Length; index++) {
          payload[index] = (byte)((index * 31 + (int)id) & 255);
        }
      } else {
        using (Bitmap bitmap = new Bitmap(width, height)) {
          using (Graphics graphics = Graphics.FromImage(bitmap)) {
            graphics.CopyFromScreen(x, y, 0, 0, bitmap.Size);
          }

          BitmapData data = bitmap.LockBits(
            new Rectangle(0, 0, width, height),
            ImageLockMode.ReadOnly,
            PixelFormat.Format32bppArgb
          );
          try {
            int rowBytes = width * 4;
            byte[] row = new byte[rowBytes];
            payload = new byte[rowBytes * height];
            for (int rowIndex = 0; rowIndex < height; rowIndex++) {
              IntPtr source = IntPtr.Add(data.Scan0, rowIndex * data.Stride);
              Marshal.Copy(source, row, 0, rowBytes);
              Buffer.BlockCopy(row, 0, payload, rowIndex * rowBytes, rowBytes);
            }
          } finally {
            bitmap.UnlockBits(data);
          }
        }
      }

      WriteFrame(writer, id, width, height, payload, 0);
    } catch (Exception error) {
      WriteFrame(writer, id, 0, 0, new byte[0], 1);
      Console.Error.WriteLine(
        "capture-error: " + error.Message + " @" + x + "," + y + " " + width + "x" + height
      );
    }
  }
}
"@ | Out-Null

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(',')
  if ($parts.Length -ne 6 -or $parts[0] -ne 'capture') { continue }

  try {
    $id = [uint32]$parts[1]
    $x = [int]$parts[2]
    $y = [int]$parts[3]
    $width = [int]$parts[4]
    $height = [int]$parts[5]
    $synthetic = $env:PIXMINT_RAW_CAPTURE_SYNTHETIC -eq '1'
    [PixmintRawCapture]::Capture(
      [Console]::OpenStandardOutput(),
      $id,
      $x,
      $y,
      $width,
      $height,
      $synthetic
    )
  } catch {
    $message = $_.Exception.Message -replace '[\r\n]', ' '
    [Console]::Error.WriteLine("capture-command-error: $message")
  }
}
`

/**
 * 背景：P8 手动长截图需要 10–15fps 的连续帧，现有 fast-capture 只适合单次截图。
 * 设计意图：独立二进制 sidecar，和现有文本 sidecar 解耦，避免 PNG/base64 开销。
 * 关键约束：只支持 Windows；调用方必须串行 capture，进程异常时自动重建。
 */
export class RawGdiFrameSource implements FrameSource {
  readonly name = 'gdi-raw'
  private child: ChildProcessWithoutNullStreams | null = null
  private pending: PendingFrame | null = null
  private nextId = 1
  private header: Buffer<ArrayBufferLike> = Buffer.alloc(HEADER_BYTES)
  private headerFilled = 0
  private frameBuffer: Buffer<ArrayBufferLike> | null = null
  private frameFilled = 0
  private currentId = 0
  private currentWidth = 0
  private currentHeight = 0
  private scriptPath = ''
  private disposed = false

  capture(rect: Rect, timeoutMs = 2000): Promise<FrameImage | null> {
    if (this.disposed) return Promise.resolve(null)
    this.ensureStarted()
    const child = this.child
    if (!child || !child.stdin.writable) return Promise.resolve(null)

    this.cancelPending()
    const id = this.nextId++
    const x = Math.round(rect.x)
    const y = Math.round(rect.y)
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    if (width <= 0 || height <= 0) return Promise.resolve(null)

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return
        this.pending = null
        logDiagnostic('frame-source', `capture timeout id=${id}`, 'warn')
        this.restart()
        resolve(null)
      }, timeoutMs)

      this.pending = { id, resolve, timer }
      try {
        child.stdin.write(`capture,${id},${x},${y},${width},${height}\n`)
      } catch (error) {
        logDiagnostic(
          'frame-source',
          `capture write failed: ${error instanceof Error ? error.message : String(error)}`,
          'warn'
        )
        this.finishWithId(id, null)
        this.restart()
      }
    })
  }

  dispose(): void {
    this.disposed = true
    this.cancelPending()
    this.child?.kill()
    this.child = null
    this.resetDecoder()
    this.removeScript()
  }

  /**
   * 背景：PowerShell 首次 Add-Type 编译有延迟，长截图第一帧不应承担全部成本。
   * 设计意图：启动进程并抓一张 2×2 小图完成预热；失败不抛到业务层。
   * 关键约束：预热是尽力而为，失败时真实 capture 仍会再次尝试启动。
   */
  prewarm(): void {
    void this.capture({ x: 0, y: 0, width: 2, height: 2 }, 4000).catch(() => undefined)
  }

  private ensureStarted(): void {
    if (this.child || this.disposed) return
    try {
      const scriptPath = this.ensureScript()
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
        {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )
      child.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
      child.stderr.on('data', (chunk: Buffer) => {
        const message = chunk.toString('utf8').trim().slice(0, 500)
        if (message) logDiagnostic('frame-source', `stderr: ${message}`, 'warn')
      })
      child.on('error', (error) => {
        logDiagnostic('frame-source', `spawn error: ${error.message}`, 'error')
        if (this.child === child) {
          this.child = null
          this.finish(null)
        }
      })
      child.on('exit', (code, signal) => {
        if (this.child === child) {
          this.child = null
          this.resetDecoder()
          this.finish(null)
        }
        logDiagnostic(
          'frame-source',
          `exited code=${code ?? 'null'} signal=${signal ?? 'null'}`,
          'warn'
        )
      })
      this.child = child
    } catch (error) {
      logDiagnostic(
        'frame-source',
        `start failed: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      )
      this.child = null
    }
  }

  private ensureScript(): string {
    if (this.scriptPath && existsSync(this.scriptPath)) return this.scriptPath
    this.scriptPath = join(tmpdir(), `pixmint-raw-capture-${process.pid}.ps1`)
    writeFileSync(this.scriptPath, RAW_CAPTURE_SCRIPT, 'utf8')
    return this.scriptPath
  }

  private removeScript(): void {
    if (!this.scriptPath) return
    try {
      if (existsSync(this.scriptPath)) unlinkSync(this.scriptPath)
    } catch {
      // 临时脚本清理失败不应影响退出
    }
    this.scriptPath = ''
  }

  private onData(chunk: Buffer): void {
    let offset = 0
    while (offset < chunk.length) {
      if (!this.frameBuffer) {
        const need = HEADER_BYTES - this.headerFilled
        const take = Math.min(need, chunk.length - offset)
        chunk.copy(this.header, this.headerFilled, offset, offset + take)
        this.headerFilled += take
        offset += take
        if (this.headerFilled < HEADER_BYTES) continue

        const magic = this.header.readUInt32LE(0)
        if (magic !== FRAME_MAGIC) {
          logDiagnostic('frame-source', `invalid frame magic ${magic}`, 'error')
          this.finish(null)
          this.restart()
          return
        }

        const id = this.header.readUInt32LE(4)
        const width = this.header.readUInt32LE(8)
        const height = this.header.readUInt32LE(12)
        const bytes = this.header.readUInt32LE(16)
        const errorCode = this.header.readUInt32LE(20)
        this.headerFilled = 0

        if (bytes > MAX_FRAME_BYTES) {
          logDiagnostic('frame-source', `frame too large: ${bytes}`, 'error')
          this.finish(null)
          this.restart()
          return
        }
        if (errorCode !== 0 || width <= 0 || height <= 0) {
          this.finishWithId(id, null)
          if (bytes > 0) this.restart()
          continue
        }
        if (bytes !== width * height * 4) {
          logDiagnostic(
            'frame-source',
            `frame size mismatch ${width}x${height} bytes=${bytes}`,
            'error'
          )
          this.finishWithId(id, null)
          this.restart()
          return
        }

        this.currentId = id
        this.currentWidth = width
        this.currentHeight = height
        try {
          this.frameBuffer = Buffer.allocUnsafe(bytes)
        } catch (error) {
          logDiagnostic(
            'frame-source',
            `frame buffer allocation failed: ${error instanceof Error ? error.message : String(error)}`,
            'error'
          )
          this.finishWithId(id, null)
          this.restart()
          return
        }
        this.frameFilled = 0
        continue
      }

      const need = this.frameBuffer.length - this.frameFilled
      const take = Math.min(need, chunk.length - offset)
      chunk.copy(this.frameBuffer, this.frameFilled, offset, offset + take)
      this.frameFilled += take
      offset += take
      if (this.frameFilled !== this.frameBuffer.length) continue

      const data = this.frameBuffer
      const id = this.currentId
      const width = this.currentWidth
      const height = this.currentHeight
      this.frameBuffer = null
      this.frameFilled = 0
      this.finishWithId(id, {
        width,
        height,
        data
      })
    }
  }

  private cancelPending(): void {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    const { resolve } = this.pending
    this.pending = null
    resolve(null)
  }

  private finish(frame: FrameImage | null): void {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    const { resolve } = this.pending
    this.pending = null
    resolve(frame)
  }

  private finishWithId(id: number, frame: FrameImage | null): void {
    if (!this.pending || this.pending.id !== id) return
    this.finish(frame)
  }

  private restart(): void {
    this.child?.kill()
    this.child = null
    this.resetDecoder()
  }

  private resetDecoder(): void {
    this.headerFilled = 0
    this.frameBuffer = null
    this.frameFilled = 0
    this.currentId = 0
    this.currentWidth = 0
    this.currentHeight = 0
  }
}

/**
 * 背景：应用是跨平台的，但首版手动长截图只做 Windows。
 * 设计意图：非 Windows 返回一个明确失败的帧源，避免在构造函数里让整个应用启动失败。
 * 关键约束：错误必须可被 LongCaptureManager 捕获并显示给用户。
 */
class UnsupportedFrameSource implements FrameSource {
  readonly name = 'unsupported'

  async capture(): Promise<FrameImage | null> {
    throw new Error('手动长截图暂只支持 Windows')
  }

  dispose(): void {
    // 没有资源需要释放
  }
}

export function createDefaultFrameSource(): FrameSource {
  return process.platform === 'win32'
    ? new RawGdiFrameSource()
    : new UnsupportedFrameSource()
}
