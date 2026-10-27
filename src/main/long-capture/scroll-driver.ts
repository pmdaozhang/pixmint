import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logDiagnostic } from '../diagnostics'
import { parseScrollResult, parseScrollTarget, type ScrollResult, type ScrollTarget } from '../../shared/scroll-target'
import { SidecarClient } from '../sidecar/client'

const SCROLL_SCRIPT = String.raw`
param([uint32]$AppPid)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -ReferencedAssemblies Microsoft.CSharp @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class PixmintScrollHelper {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT {
    public uint type;
    public MOUSEINPUT mi;
  }
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT rect, int size);
  [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] public static extern int DwmGetWindowAttributeInt(IntPtr hwnd, int attr, out int value, int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

  static IntPtr found;
  static RECT foundRect;

  public static void MakeDpiAware() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
    try { SetProcessDPIAware(); } catch { }
  }

  public static string Find(int x, int y, uint appPid) {
    MakeDpiAware();
    found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid == appPid) return true;
      StringBuilder sb = new StringBuilder(256);
      GetClassName(h, sb, 256);
      string cls = sb.ToString();
      if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" ||
          cls == "Shell_SecondaryTrayWnd" || cls == "Windows.UI.Core.CoreWindow") return true;
      int cloaked;
      if (DwmGetWindowAttributeInt(h, 14, out cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
      RECT r;
      if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0 ||
          r.Right <= r.Left || r.Bottom <= r.Top) {
        if (!GetWindowRect(h, out r)) return true;
      }
      if (x >= r.Left && x < r.Right && y >= r.Top && y < r.Bottom) {
        found = h;
        foundRect = r;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero) return "null";
    StringBuilder name = new StringBuilder(256);
    GetClassName(found, name, 256);
    StringBuilder title = new StringBuilder(256);
    GetWindowText(found, title, 256);
    bool foreground = GetForegroundWindow() == found;
    return "{\"hwnd\":" + found.ToInt64() +
      ",\"className\":\"" + Escape(name.ToString()) +
      "\",\"title\":\"" + Escape(title.ToString()) +
      "\",\"foreground\":" + (foreground ? "true" : "false") +
      ",\"rect\":{\"x\":" + foundRect.Left +
      ",\"y\":" + foundRect.Top +
      ",\"width\":" + (foundRect.Right - foundRect.Left) +
      ",\"height\":" + (foundRect.Bottom - foundRect.Top) + "}}";
  }

  public static string Scroll(long hwnd, int x, int y, int notches) {
    IntPtr h = new IntPtr(hwnd);
    if (!IsWindow(h)) return "error:window";
    if (!ForceForeground(h)) return "error:foreground";
    if (!SetCursorPos(x, y)) return "error:cursor";
    System.Threading.Thread.Sleep(20);
    INPUT input = new INPUT();
    input.type = 0;
    input.mi.dwFlags = 0x0800;
    input.mi.mouseData = unchecked((uint)(notches * 120));
    INPUT[] inputs = new INPUT[] { input };
    uint sent = SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    return sent == 1 ? "ok" : "error:sendinput";
  }

  static bool ForceForeground(IntPtr h) {
    if (GetForegroundWindow() == h) return true;
    uint foregroundThread = 0;
    IntPtr foreground = GetForegroundWindow();
    if (foreground != IntPtr.Zero) {
      uint pid;
      foregroundThread = GetWindowThreadProcessId(foreground, out pid);
    }
    uint currentThread = GetCurrentThreadId();
    bool attached = false;
    try {
      if (foregroundThread != 0) attached = AttachThreadInput(currentThread, foregroundThread, true);
      ShowWindow(h, 9);
      BringWindowToTop(h);
      SetForegroundWindow(h);
    } finally {
      if (attached) AttachThreadInput(currentThread, foregroundThread, false);
    }
    if (GetForegroundWindow() != h) {
      try { SwitchToThisWindow(h, true); } catch { }
    }
    System.Threading.Thread.Sleep(40);
    return GetForegroundWindow() == h;
  }

  public static string Restore(int x, int y) {
    return SetCursorPos(x, y) ? "ok" : "error:cursor";
  }

  static string Escape(string value) {
    return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
  }
}
"@

[PixmintScrollHelper]::MakeDpiAware() | Out-Null

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(',')
  try {
    if ($parts.Length -eq 2 -and $parts[1] -eq 'ping') {
      [Console]::Out.WriteLine("$($parts[0])|ok")
    } elseif ($parts.Length -eq 4 -and $parts[1] -eq 'target') {
      $result = [PixmintScrollHelper]::Find([int]$parts[2], [int]$parts[3], $AppPid)
      [Console]::Out.WriteLine("$($parts[0])|$result")
    } elseif ($parts.Length -eq 6 -and $parts[1] -eq 'scroll') {
      $result = [PixmintScrollHelper]::Scroll([long]$parts[2], [int]$parts[3], [int]$parts[4], [int]$parts[5])
      [Console]::Out.WriteLine("$($parts[0])|$result")
    } elseif ($parts.Length -eq 4 -and $parts[1] -eq 'restore') {
      $result = [PixmintScrollHelper]::Restore([int]$parts[2], [int]$parts[3])
      [Console]::Out.WriteLine("$($parts[0])|$result")
    } else {
      [Console]::Out.WriteLine("$($parts[0])|error:command")
    }
  } catch {
    $message = $_.Exception.Message -replace '[\r\n|]', ' '
    [Console]::Out.WriteLine("$($parts[0])|error:exception:$message")
  }
  [Console]::Out.Flush()
}
`

let scriptPath = ''

function scrollScriptPath(): string {
  if (scriptPath) return scriptPath
  scriptPath = join(tmpdir(), `pixmint-scroll-${process.pid}.ps1`)
  writeFileSync(scriptPath, SCROLL_SCRIPT, 'utf8')
  return scriptPath
}

function removeScrollScript(): void {
  if (!scriptPath) return
  try {
    if (existsSync(scriptPath)) unlinkSync(scriptPath)
  } catch {
    // 临时脚本清理失败不应影响退出
  }
  scriptPath = ''
}

/**
 * Windows 滚动驱动。
 *
 * 背景：长截图需要把滚轮事件送到选区下的目标窗口，而不是 Pixmint 自己。
 * 设计意图：复用通用 SidecarClient，常驻 PowerShell + C# SendInput；
 *           先定位窗口、置前、移动指针，再滚轮，最后恢复用户指针。
 * 关键约束：坐标必须传物理像素；AppPid 用于跳过 Pixmint 自己的覆盖层/设置窗口。
 */
export class ScrollDriver {
  private readonly client: SidecarClient
  private warmed = false

  constructor(private readonly appPid = process.pid) {
    this.client = new SidecarClient({
      name: 'scroll-driver',
      launch: () => ({
        command: 'powershell.exe',
        args: [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scrollScriptPath(),
          '-AppPid',
          String(this.appPid)
        ]
      }),
      defaultTimeoutMs: 1200,
      onLog: (message) => logDiagnostic('scroll-driver', message, 'warn')
    })
  }

  prewarm(): void {
    this.client.ensureStarted()
    void this.client.request('ping', 4000).then((payload) => {
      this.warmed = payload === 'ok'
    })
  }

  async findTarget(x: number, y: number): Promise<ScrollTarget | null> {
    const payload = await this.client.request(
      `target,${Math.round(x)},${Math.round(y)}`,
      this.warmed ? 800 : 4000
    )
    this.warmed = true
    return parseScrollTarget(payload)
  }

  async scroll(
    target: ScrollTarget,
    x: number,
    y: number,
    notches: number
  ): Promise<ScrollResult> {
    const payload = await this.client.request(
      `scroll,${target.hwnd},${Math.round(x)},${Math.round(y)},${Math.trunc(notches)}`,
      1500
    )
    return parseScrollResult(payload)
  }

  async restore(x: number, y: number): Promise<void> {
    await this.client.request(`restore,${Math.round(x)},${Math.round(y)}`, 600)
  }

  dispose(): void {
    this.client.dispose()
    removeScrollScript()
  }
}
