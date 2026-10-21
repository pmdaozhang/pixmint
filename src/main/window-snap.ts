import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Rect } from '../shared/types'

const WINDOW_SNAP_SCRIPT = String.raw`
param([uint32]$AppPid)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -ReferencedAssemblies Microsoft.CSharp @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class SnapGlassWindowFinder {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT rect, int size);
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] public static extern int DwmGetWindowAttributeInt(IntPtr hwnd, int attr, out int value, int size);
  [DllImport("oleacc.dll")] public static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint dwId, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppvObject);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

  public static void MakeDpiAware() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
    try { SetProcessDPIAware(); } catch { }
  }

  static RECT Intersect(RECT a, RECT b) {
    RECT result = new RECT();
    result.Left = Math.Max(a.Left, b.Left);
    result.Top = Math.Max(a.Top, b.Top);
    result.Right = Math.Min(a.Right, b.Right);
    result.Bottom = Math.Min(a.Bottom, b.Bottom);
    return result;
  }

  static bool TryHitTest(IntPtr hwnd, int x, int y, out RECT rect) {
    rect = new RECT();
    object obj;
    Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
    int hr = AccessibleObjectFromWindow(hwnd, 0xFFFFFFFC, ref iid, out obj);
    if (hr != 0 || obj == null) return false;
    try {
      dynamic acc = obj;
      object hit = acc.accHitTest(x, y);
      if (hit == null) return false;
      if (hit is int) {
        int l, t, w, h;
        acc.accLocation(out l, out t, out w, out h, (int)hit);
        rect = new RECT { Left = l, Top = t, Right = l + w, Bottom = t + h };
        return w > 0 && h > 0;
      }
      dynamic child = hit;
      int cl, ct, cw, ch;
      child.accLocation(out cl, out ct, out cw, out ch, 0);
      rect = new RECT { Left = cl, Top = ct, Right = cl + cw, Bottom = ct + ch };
      return cw > 0 && ch > 0;
    } catch {
      return false;
    }
  }

  public static string Find(int x, int y, uint appPid) {
    MakeDpiAware();
    IntPtr found = IntPtr.Zero;
    RECT foundRect = new RECT();
    IntPtr shell = GetShellWindow();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (h == shell || !IsWindowVisible(h) || IsIconic(h)) return true;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid == appPid) return true;
      StringBuilder sb = new StringBuilder(256);
      GetClassName(h, sb, 256);
      string cls = sb.ToString();
      if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd" || cls == "Windows.UI.Core.CoreWindow") return true;
      int cloaked;
      if (DwmGetWindowAttributeInt(h, 14, out cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
      RECT r;
      if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0 || r.Right <= r.Left || r.Bottom <= r.Top) {
        if (!GetWindowRect(h, out r)) return true;
      }
      int w = r.Right - r.Left;
      int hgt = r.Bottom - r.Top;
      if (w < 40 || hgt < 30) return true;
      if (x >= r.Left && x < r.Right && y >= r.Top && y < r.Bottom) {
        found = h;
        foundRect = r;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero) return "null";

    RECT result = foundRect;
    RECT hit;
    if (TryHitTest(found, x, y, out hit)) {
      RECT clipped = Intersect(hit, foundRect);
      int w = clipped.Right - clipped.Left;
      int hgt = clipped.Bottom - clipped.Top;
      if (w >= 16 && hgt >= 16) result = clipped;
    }
    return "{\"x\":" + result.Left + ",\"y\":" + result.Top + ",\"width\":" + (result.Right - result.Left) + ",\"height\":" + (result.Bottom - result.Top) + "}";
  }
}
"@

[SnapGlassWindowFinder]::MakeDpiAware() | Out-Null

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(',')
  if ($parts.Length -ne 3) {
    [Console]::Out.WriteLine('0|null')
    [Console]::Out.Flush()
    continue
  }
  $requestId = $parts[0]
  try {
    $result = [SnapGlassWindowFinder]::Find([int]$parts[1], [int]$parts[2], $AppPid)
    [Console]::Out.WriteLine("$requestId|$result")
  } catch {
    [Console]::Out.WriteLine("$requestId|null")
  }
  [Console]::Out.Flush()
}
`

interface PendingQuery {
  id: number
  resolve: (rect: Rect | null) => void
  timer: NodeJS.Timeout
}

export class WindowSnapHelper {
  private process: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private pending: PendingQuery | null = null
  private nextId = 1

  constructor(private readonly appPid = process.pid) {}

  prewarm(): void {
    this.ensureStarted()
  }

  ensureStarted(): void {
    if (this.process) return
    try {
      const scriptPath = join(tmpdir(), 'snapglass-window-snap.ps1')
      writeFileSync(scriptPath, WINDOW_SNAP_SCRIPT, 'utf8')
      this.process = spawn(
        'powershell.exe',
        [
          '-Sta',
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '-AppPid',
          String(this.appPid)
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      this.process.stdout.setEncoding('utf8')
      this.process.stdout.on('data', (chunk: string) => this.onData(chunk))
      this.process.stderr.on('data', () => {})
      this.process.on('exit', () => {
        this.process = null
        this.resolvePending(null)
      })
    } catch {
      this.process = null
    }
  }

  query(x: number, y: number): Promise<Rect | null> {
    this.ensureStarted()
    if (!this.process?.stdin.writable) return Promise.resolve(null)
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.resolve(null)
      this.pending = null
    }
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.id === id) {
          this.pending = null
          this.restart()
        }
        resolve(null)
      }, 300)
      this.pending = { id, resolve, timer }
      try {
        this.process?.stdin.write(`${id},${Math.round(x)},${Math.round(y)}\n`)
      } catch {
        this.resolvePending(null)
      }
    })
  }

  dispose(): void {
    this.resolvePending(null)
    this.process?.kill()
    this.process = null
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
      if (payload === 'null') {
        this.resolvePending(null)
        continue
      }
      try {
        const start = payload.indexOf('{')
        const end = payload.lastIndexOf('}')
        if (start < 0 || end < start) continue
        const rect = JSON.parse(payload.slice(start, end + 1)) as Rect
        this.resolvePending(rect)
      } catch {
        this.resolvePending(null)
      }
    }
  }

  private resolvePending(rect: Rect | null): void {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    this.pending.resolve(rect)
    this.pending = null
  }
}
