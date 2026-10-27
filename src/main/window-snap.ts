import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Rect } from '../shared/types'
import { logDiagnostic } from './diagnostics'
import { SidecarClient } from './sidecar/client'

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

let scriptPath = ''

function windowSnapScriptPath(): string {
  if (scriptPath) return scriptPath
  scriptPath = join(tmpdir(), `snapglass-window-snap-${process.pid}.ps1`)
  writeFileSync(scriptPath, WINDOW_SNAP_SCRIPT, 'utf8')
  return scriptPath
}

function removeWindowSnapScript(): void {
  if (!scriptPath) return
  try {
    if (existsSync(scriptPath)) unlinkSync(scriptPath)
  } catch {
    // 临时脚本清理失败不应影响退出
  }
  scriptPath = ''
}

/**
 * 背景：窗口/控件吸附需要常驻 PowerShell + UI Automation，启动成本高。
 * 设计意图：复用通用 SidecarClient，保持 300ms 最新请求优先的超时语义。
 * 关键约束：返回非法坐标时按 null 处理，不能把坏矩形传给覆盖层。
 */
export class WindowSnapHelper {
  private readonly client: SidecarClient

  constructor(private readonly appPid = process.pid) {
    this.client = new SidecarClient({
      name: 'window-snap',
      launch: () => ({
        command: 'powershell.exe',
        args: [
          '-Sta',
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          windowSnapScriptPath(),
          '-AppPid',
          String(this.appPid)
        ]
      }),
      defaultTimeoutMs: 300,
      onLog: (message) => logDiagnostic('window-snap', message, 'warn')
    })
  }

  prewarm(): void {
    this.ensureStarted()
  }

  ensureStarted(): void {
    this.client.ensureStarted()
  }

  async query(x: number, y: number): Promise<Rect | null> {
    const payload = await this.client.request(
      `${Math.round(x)},${Math.round(y)}`,
      300
    )
    if (!payload || payload === 'null') return null
    try {
      const start = payload.indexOf('{')
      const end = payload.lastIndexOf('}')
      if (start < 0 || end < start) return null
      const rect = JSON.parse(payload.slice(start, end + 1)) as Rect
      if (
        !Number.isFinite(rect.x) ||
        !Number.isFinite(rect.y) ||
        !Number.isFinite(rect.width) ||
        !Number.isFinite(rect.height)
      ) {
        return null
      }
      return rect
    } catch {
      return null
    }
  }

  dispose(): void {
    this.client.dispose()
    removeWindowSnapScript()
  }
}
