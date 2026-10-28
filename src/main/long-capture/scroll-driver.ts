import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logDiagnostic } from '../diagnostics'
import { parseScrollResult, parseScrollTarget, type ScrollResult, type ScrollTarget } from '../../shared/scroll-target'
import type { Rect } from '../../shared/types'
import { SidecarClient } from '../sidecar/client'

const SCROLL_SCRIPT = String.raw`
param([uint32]$AppPid)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -ReferencedAssemblies Microsoft.CSharp,UIAutomationClient,UIAutomationTypes,WindowsBase @"
using System;
using System.IO;
using System.Text;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Windows.Automation;
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
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT rect, int size);
  [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] public static extern int DwmGetWindowAttributeInt(IntPtr hwnd, int attr, out int value, int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

  static IntPtr found;
  static RECT foundRect;
  static long foundArea;

  // Skip another Pixmint instance so auto-scroll never targets its own windows.
  static bool IsPixmintProcess(uint pid) {
    IntPtr process = OpenProcess(0x1000, false, pid);
    if (process == IntPtr.Zero) return false;
    try {
      StringBuilder name = new StringBuilder(1024);
      uint size = (uint)name.Capacity;
      if (!QueryFullProcessImageName(process, 0, name, ref size)) return false;
      return string.Equals(Path.GetFileName(name.ToString()), "Pixmint.exe", StringComparison.OrdinalIgnoreCase);
    } finally {
      CloseHandle(process);
    }
  }

  public static void MakeDpiAware() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
    try { SetProcessDPIAware(); } catch { }
  }

  public static string Find(int x, int y, uint appPid) {
    MakeDpiAware();
    found = IntPtr.Zero;
    foundArea = 0;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      RECT r;
      if (IsEligible(h, x, y, appPid, out r)) {
        found = h;
        foundRect = r;
        foundArea = (long)(r.Right - r.Left) * (long)(r.Bottom - r.Top);
        return false;
      }
      return true;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero) return "null";
    return Describe(found, foundRect);
  }

  static bool IsEligible(IntPtr h, int x, int y, uint appPid, out RECT rect) {
    rect = new RECT();
    if (!IsWindowVisible(h) || IsIconic(h)) return false;
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    if (pid == appPid || IsPixmintProcess(pid)) return false;
    StringBuilder sb = new StringBuilder(256);
    GetClassName(h, sb, 256);
    string cls = sb.ToString();
    if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" ||
        cls == "Shell_SecondaryTrayWnd" || cls == "Windows.UI.Core.CoreWindow") return false;
    StringBuilder title = new StringBuilder(256);
    GetWindowText(h, title, 256);
    string titleText = title.ToString();
    if (titleText == "Status" || titleText == "StatusBarWnd" || titleText == "Program Manager" ||
        titleText.Contains("NVIDIA GeForce Overlay") ||
        titleText.Contains("Windows Input Experience") ||
        titleText.Contains("Microsoft Text Input Application") ||
        titleText.Contains("\u957F\u622A\u56FE")) return false;
    int cloaked;
    if (DwmGetWindowAttributeInt(h, 14, out cloaked, sizeof(int)) == 0 && cloaked != 0) return false;
    RECT r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0 ||
        r.Right <= r.Left || r.Bottom <= r.Top) {
      if (!GetWindowRect(h, out r)) return false;
    }
    if (x < r.Left || x >= r.Right || y < r.Top || y >= r.Bottom) return false;
    if (r.Right - r.Left < 120 || r.Bottom - r.Top < 120) return false;
    rect = r;
    return true;
  }

  public static string FindByHwnd(long hwnd) {
    MakeDpiAware();
    IntPtr target = new IntPtr(hwnd);
    if (!IsWindow(target) || !IsWindowVisible(target) || IsIconic(target)) return "null";
    RECT rect;
    if (DwmGetWindowAttribute(target, 9, out rect, Marshal.SizeOf(typeof(RECT))) != 0 ||
        rect.Right <= rect.Left || rect.Bottom <= rect.Top) {
      if (!GetWindowRect(target, out rect)) return "null";
    }
    if (rect.Right <= rect.Left || rect.Bottom <= rect.Top) return "null";
    return Describe(target, rect);
  }

  static string Describe(IntPtr target, RECT rect) {
    StringBuilder name = new StringBuilder(256);
    GetClassName(target, name, 256);
    StringBuilder title = new StringBuilder(256);
    GetWindowText(target, title, 256);
    bool foreground = GetForegroundWindow() == target;
    return "{\"hwnd\":" + target.ToInt64() +
      ",\"className\":\"" + Escape(name.ToString()) +
      "\",\"title\":\"" + Escape(title.ToString()) +
      "\",\"foreground\":" + (foreground ? "true" : "false") +
      ",\"rect\":{\"x\":" + rect.Left +
      ",\"y\":" + rect.Top +
      ",\"width\":" + (rect.Right - rect.Left) +
      ",\"height\":" + (rect.Bottom - rect.Top) + "}}";
  }

  public static string Scroll(long hwnd, int x, int y, int notches) {
    return SendWheel(hwnd, x, y, notches * 120);
  }

  public static string ScrollDelta(long hwnd, int x, int y, int delta) {
    return SendWheel(hwnd, x, y, delta);
  }

  public static string KeyScroll(long hwnd, int x, int y, int keyCode, int count) {
    IntPtr h = new IntPtr(hwnd);
    if (!IsWindow(h)) return "error:window";
    if (!ForceForeground(h)) return "error:foreground";
    POINT original;
    bool hadCursor = GetCursorPos(out original);
    if (!SetCursorPos(x, y)) return "error:cursor";
    System.Threading.Thread.Sleep(30);
    for (int i = 0; i < count; i++) {
      keybd_event((byte)keyCode, 0, 0, UIntPtr.Zero);
      keybd_event((byte)keyCode, 0, 2, UIntPtr.Zero);
      System.Threading.Thread.Sleep(25);
    }
    if (hadCursor) SetCursorPos(original.X, original.Y);
    return "ok";
  }

  public static string UiaScroll(long hwnd, int x, int y, int steps) {
    IntPtr h = new IntPtr(hwnd);
    if (!IsWindow(h)) return "error:window";
    POINT original;
    bool hadCursor = GetCursorPos(out original);
    if (!SetCursorPos(x, y)) return "error:cursor";
    try {
      AutomationElement element = AutomationElement.FromPoint(new System.Windows.Point(x, y));
      if (element == null) return "error:uia-element";
      for (int depth = 0; depth < 8 && element != null; depth++) {
        object patternObject;
        if (element.TryGetCurrentPattern(ScrollPattern.Pattern, out patternObject)) {
          ScrollPattern pattern = (ScrollPattern)patternObject;
          if (pattern.Current.VerticallyScrollable) {
            int count = Math.Max(1, steps);
            for (int i = 0; i < count; i++) {
              pattern.Scroll(ScrollAmount.NoAmount, ScrollAmount.SmallIncrement);
              System.Threading.Thread.Sleep(30);
            }
            if (hadCursor) SetCursorPos(original.X, original.Y);
            return "ok";
          }
        }
        element = TreeWalker.ControlViewWalker.GetParent(element);
      }
      if (hadCursor) SetCursorPos(original.X, original.Y);
      return "error:uia-pattern";
    } catch {
      if (hadCursor) SetCursorPos(original.X, original.Y);
      return "error:uia";
    }
  }

  public static string ScrollToTop(int x, int y) {
    return SetScrollPercent(x, y, 0);
  }

  static ScrollPattern FindPattern(int x, int y) {
    AutomationElement element = AutomationElement.FromPoint(new System.Windows.Point(x, y));
    for (int depth = 0; depth < 10 && element != null; depth++) {
      object patternObject;
      if (element.TryGetCurrentPattern(ScrollPattern.Pattern, out patternObject)) {
        ScrollPattern pattern = (ScrollPattern)patternObject;
        if (pattern.Current.VerticallyScrollable) return pattern;
      }
      element = TreeWalker.ControlViewWalker.GetParent(element);
    }
    return null;
  }

  public static string ScrollInfo(int x, int y) {
    try {
      AutomationElement element = AutomationElement.FromPoint(new System.Windows.Point(x, y));
      for (int depth = 0; depth < 10 && element != null; depth++) {
        object patternObject;
        if (element.TryGetCurrentPattern(ScrollPattern.Pattern, out patternObject)) {
          ScrollPattern pattern = (ScrollPattern)patternObject;
          if (pattern.Current.VerticallyScrollable) {
            System.Windows.Rect bounds = element.Current.BoundingRectangle;
            return "{\"percent\":" + pattern.Current.VerticalScrollPercent.ToString("0.###", CultureInfo.InvariantCulture) +
              ",\"view\":" + pattern.Current.VerticalViewSize.ToString("0.###", CultureInfo.InvariantCulture) +
              ",\"rect\":{\"x\":" + Math.Round(bounds.X) +
              ",\"y\":" + Math.Round(bounds.Y) +
              ",\"width\":" + Math.Round(bounds.Width) +
              ",\"height\":" + Math.Round(bounds.Height) + "}}";
          }
        }
        element = TreeWalker.ControlViewWalker.GetParent(element);
      }
      return "null";
    } catch {
      return "error:uia";
    }
  }

  public static string SetScrollPercent(int x, int y, double target) {
    try {
      ScrollPattern pattern = FindPattern(x, y);
      if (pattern == null) return "error:uia-pattern";
      double view = pattern.Current.VerticalViewSize;
      // Chromium 的 UIA 实现首次设置只排队，第二次才真正提交。
      pattern.SetScrollPercent(ScrollPattern.NoScroll, target);
      System.Threading.Thread.Sleep(80);
      pattern.SetScrollPercent(ScrollPattern.NoScroll, target);
      double current = pattern.Current.VerticalScrollPercent;
      for (int attempt = 0; attempt < 20; attempt++) {
        System.Threading.Thread.Sleep(60);
        current = pattern.Current.VerticalScrollPercent;
        if (Math.Abs(current - target) <= 0.75 || target >= 99) {
          return "ok:" + current.ToString("0.###", CultureInfo.InvariantCulture) +
            ":" + view.ToString("0.###", CultureInfo.InvariantCulture);
        }
      }
      return "ok:" + current.ToString("0.###", CultureInfo.InvariantCulture) +
        ":" + view.ToString("0.###", CultureInfo.InvariantCulture);
    } catch {
      return "error:uia";
    }
  }

  static string SendWheel(long hwnd, int x, int y, int delta) {
    IntPtr h = new IntPtr(hwnd);
    if (!IsWindow(h)) return "error:window";
    if (!ForceForeground(h)) return "error:foreground";
    POINT original;
    bool hadCursor = GetCursorPos(out original);
    if (!SetCursorPos(x, y)) return "error:cursor";
    System.Threading.Thread.Sleep(20);
    INPUT input = new INPUT();
    input.type = 0;
    input.mi.dwFlags = 0x0800;
    input.mi.mouseData = unchecked((uint)delta);
    INPUT[] inputs = new INPUT[] { input };
    uint sent = SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (hadCursor) SetCursorPos(original.X, original.Y);
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
      if (IsIconic(h)) ShowWindow(h, 9);
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

  public static string Cursor() {
    POINT point;
    if (!GetCursorPos(out point)) return "error:cursor";
    return point.X + "," + point.Y;
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
    } elseif ($parts.Length -eq 3 -and $parts[1] -eq 'targetbyhwnd') {
      $result = [PixmintScrollHelper]::FindByHwnd([long]$parts[2])
      [Console]::Out.WriteLine("$($parts[0])|$result")
    } elseif ($parts.Length -eq 6 -and $parts[1] -eq 'scroll') {
      $result = [PixmintScrollHelper]::Scroll([long]$parts[2], [int]$parts[3], [int]$parts[4], [int]$parts[5])
      [Console]::Out.WriteLine("$($parts[0])|$result")
    } elseif ($parts.Length -eq 6 -and $parts[1] -eq 'scrolldelta') {
      $result = [PixmintScrollHelper]::ScrollDelta([long]$parts[2], [int]$parts[3], [int]$parts[4], [int]$parts[5])
      [Console]::Out.WriteLine("$($parts[0])|$result")
    } elseif ($parts.Length -eq 6 -and $parts[1] -eq 'keyscroll') {
      $result = [PixmintScrollHelper]::KeyScroll([long]$parts[2], [int]$parts[3], [int]$parts[4], [int]$parts[5], 8)
      [Console]::Out.WriteLine("$($parts[0])|$result")
    } elseif ($parts.Length -eq 6 -and $parts[1] -eq 'uiascroll') {
      $result = [PixmintScrollHelper]::UiaScroll([long]$parts[2], [int]$parts[3], [int]$parts[4], [int]$parts[5])
      [Console]::Out.WriteLine("$($parts[0])|$result")
    } elseif ($parts.Length -eq 4 -and $parts[1] -eq 'uiatop') {
      $result = [PixmintScrollHelper]::ScrollToTop([int]$parts[2], [int]$parts[3])
      [Console]::Out.WriteLine("$($parts[0])|$result")
    } elseif ($parts.Length -eq 4 -and $parts[1] -eq 'uiainfo') {
      $result = [PixmintScrollHelper]::ScrollInfo([int]$parts[2], [int]$parts[3])
      [Console]::Out.WriteLine("$($parts[0])|$result")
    } elseif ($parts.Length -eq 5 -and $parts[1] -eq 'uiasetpct') {
      $target = [double]::Parse($parts[4], [Globalization.CultureInfo]::InvariantCulture)
      $result = [PixmintScrollHelper]::SetScrollPercent([int]$parts[2], [int]$parts[3], $target)
      [Console]::Out.WriteLine("$($parts[0])|$result")
    } elseif ($parts.Length -eq 4 -and $parts[1] -eq 'restore') {
      $result = [PixmintScrollHelper]::Restore([int]$parts[2], [int]$parts[3])
      [Console]::Out.WriteLine("$($parts[0])|$result")
    } elseif ($parts.Length -eq 2 -and $parts[1] -eq 'cursor') {
      $result = [PixmintScrollHelper]::Cursor()
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
    void this.warmUp()
  }

  async warmUp(): Promise<void> {
    this.client.ensureStarted()
    const payload = await this.client.request('ping', 5000)
    this.warmed = payload === 'ok'
  }

  async findTarget(x: number, y: number): Promise<ScrollTarget | null> {
    const payload = await this.client.request(
      `target,${Math.round(x)},${Math.round(y)}`,
      this.warmed ? 2000 : 5000
    )
    this.warmed = true
    return parseScrollTarget(payload)
  }

  async findTargetByHwnd(hwnd: number): Promise<ScrollTarget | null> {
    const payload = await this.client.request(
      `targetbyhwnd,${Math.round(hwnd)}`,
      this.warmed ? 2000 : 5000
    )
    this.warmed = true
    return parseScrollTarget(payload)
  }

  async scrollToTop(x: number, y: number): Promise<boolean> {
    return (await this.setScrollPercent(x, y, 0)) !== null
  }

  async getScrollInfo(
    x: number,
    y: number
  ): Promise<{ percent: number; view: number; rect: Rect } | null> {
    const payload = await this.client.request(
      `uiainfo,${Math.round(x)},${Math.round(y)}`,
      this.warmed ? 3000 : 6000
    )
    this.warmed = true
    if (!payload || payload === 'null') return null
    try {
      const start = payload.indexOf('{')
      const end = payload.lastIndexOf('}')
      if (start < 0 || end < start) return null
      const value = JSON.parse(payload.slice(start, end + 1)) as {
        percent: number
        view: number
        rect: Rect
      }
      if (
        !Number.isFinite(value.percent) ||
        !Number.isFinite(value.view) ||
        value.view <= 0 ||
        !value.rect ||
        value.rect.width <= 0 ||
        value.rect.height <= 0
      ) {
        return null
      }
      return value
    } catch {
      return null
    }
  }

  async setScrollPercent(
    x: number,
    y: number,
    target: number
  ): Promise<{ percent: number; view: number } | null> {
    const payload = await this.client.request(
      `uiasetpct,${Math.round(x)},${Math.round(y)},${target.toFixed(3)}`,
      this.warmed ? 4000 : 7000
    )
    this.warmed = true
    if (!payload || !payload.startsWith('ok:')) return null
    const [, percentText, viewText] = payload.split(':')
    const percent = Number(percentText)
    const view = Number(viewText)
    if (!Number.isFinite(percent) || !Number.isFinite(view) || view <= 0) return null
    return { percent, view }
  }

  async scroll(
    target: ScrollTarget,
    x: number,
    y: number,
    notches: number
  ): Promise<ScrollResult> {
    return this.scrollDelta(target, x, y, notches * 120)
  }

  async scrollDelta(
    target: ScrollTarget,
    x: number,
    y: number,
    delta: number
  ): Promise<ScrollResult> {
    const payload = await this.client.request(
      `scrolldelta,${target.hwnd},${Math.round(x)},${Math.round(y)},${Math.round(delta)}`,
      1500
    )
    return parseScrollResult(payload)
  }

  async scrollKeys(
    target: ScrollTarget,
    x: number,
    y: number,
    keyCode: number
  ): Promise<ScrollResult> {
    const payload = await this.client.request(
      `keyscroll,${target.hwnd},${Math.round(x)},${Math.round(y)},${Math.round(keyCode)}`,
      2000
    )
    return parseScrollResult(payload)
  }

  async scrollUia(
    target: ScrollTarget,
    x: number,
    y: number,
    steps: number
  ): Promise<ScrollResult> {
    const payload = await this.client.request(
      `uiascroll,${target.hwnd},${Math.round(x)},${Math.round(y)},${Math.max(1, Math.round(steps))}`,
      3000
    )
    return parseScrollResult(payload)
  }

  async restore(x: number, y: number): Promise<void> {
    await this.client.request(`restore,${Math.round(x)},${Math.round(y)}`, 600)
  }

  async getCursor(): Promise<{ x: number; y: number } | null> {
    const payload = await this.client.request('cursor', this.warmed ? 800 : 4000)
    if (!payload || payload === 'error:cursor') return null
    this.warmed = true
    const [x, y] = payload.split(',').map(Number)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return { x, y }
  }

  dispose(): void {
    this.client.dispose()
    removeScrollScript()
  }
}
