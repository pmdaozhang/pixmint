import { desktopCapturer, screen } from 'electron'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Rect,
  WindowTargetInfo,
  WindowTargetItem
} from '../shared/types'
import { logDiagnostic } from './diagnostics'
import { SidecarClient } from './sidecar/client'

const TARGET_SCRIPT = String.raw`
param([uint32]$AppPid)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -ReferencedAssemblies UIAutomationClient,UIAutomationTypes,WindowsBase @"
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.Windows.Automation;

public class PixmintWindowTarget {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref RECT point);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT rect, int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

  static void MakeDpiAware() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
    try { SetProcessDPIAware(); } catch { }
  }

  static void ForceForeground(IntPtr hWnd) {
    if (GetForegroundWindow() == hWnd) return;
    uint foregroundPid;
    uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out foregroundPid);
    uint currentThread = GetCurrentThreadId();
    try {
      AttachThreadInput(currentThread, foregroundThread, true);
      ShowWindow(hWnd, 9);
      BringWindowToTop(hWnd);
      SetForegroundWindow(hWnd);
      SwitchToThisWindow(hWnd, true);
    } finally {
      AttachThreadInput(currentThread, foregroundThread, false);
    }
  }

  static RECT WindowRect(IntPtr hWnd) {
    RECT rect;
    if (DwmGetWindowAttribute(hWnd, 9, out rect, Marshal.SizeOf(typeof(RECT))) == 0 &&
        rect.Right > rect.Left && rect.Bottom > rect.Top) {
      return rect;
    }
    GetWindowRect(hWnd, out rect);
    return rect;
  }

  static RECT ClientRect(IntPtr hWnd) {
    RECT rect;
    GetClientRect(hWnd, out rect);
    ClientToScreen(hWnd, ref rect);
    return rect;
  }

  static RECT? FindScrollable(IntPtr hWnd) {
    try {
      AutomationElement root = AutomationElement.FromHandle(hWnd);
      if (root == null) return null;
      AutomationElementCollection all = root.FindAll(TreeScope.Descendants, Condition.TrueCondition);
      RECT best = new RECT();
      double bestArea = 0;
      int count = Math.Min(all.Count, 500);
      for (int i = 0; i < count; i++) {
        AutomationElement element = all[i];
        object patternObject;
        if (!element.TryGetCurrentPattern(ScrollPattern.Pattern, out patternObject)) continue;
        ScrollPattern pattern = (ScrollPattern)patternObject;
        if (!pattern.Current.VerticallyScrollable) continue;
        System.Windows.Rect bounds = element.Current.BoundingRectangle;
        if (bounds.Width < 40 || bounds.Height < 40) continue;
        double area = bounds.Width * bounds.Height;
        if (area <= bestArea) continue;
        best = new RECT {
          Left = (int)Math.Round(bounds.X),
          Top = (int)Math.Round(bounds.Y),
          Right = (int)Math.Round(bounds.X + bounds.Width),
          Bottom = (int)Math.Round(bounds.Y + bounds.Height)
        };
        bestArea = area;
      }
      return bestArea > 0 ? best : (RECT?)null;
    } catch {
      return null;
    }
  }

  public static string Select(long hwnd) {
    MakeDpiAware();
    IntPtr hWnd = new IntPtr(hwnd);
    if (!IsWindow(hWnd)) return "error:window";
    if (IsIconic(hWnd)) ShowWindow(hWnd, 9);
    ForceForeground(hWnd);
    Thread.Sleep(160);

    RECT window = WindowRect(hWnd);
    RECT client = ClientRect(hWnd);
    RECT content = FindScrollable(hWnd) ?? client;
    StringBuilder title = new StringBuilder(256);
    StringBuilder cls = new StringBuilder(256);
    GetWindowText(hWnd, title, 256);
    GetClassName(hWnd, cls, 256);
    return "{\"hwnd\":" + hwnd +
      ",\"title\":\"" + Escape(title.ToString()) +
      "\",\"class\":\"" + Escape(cls.ToString()) +
      "\",\"windowRect\":{\"x\":" + window.Left +
      ",\"y\":" + window.Top +
      ",\"width\":" + (window.Right - window.Left) +
      ",\"height\":" + (window.Bottom - window.Top) +
      "},\"clientRect\":{\"x\":" + client.Left +
      ",\"y\":" + client.Top +
      ",\"width\":" + (client.Right - client.Left) +
      ",\"height\":" + (client.Bottom - client.Top) +
      "},\"contentRect\":{\"x\":" + content.Left +
      ",\"y\":" + content.Top +
      ",\"width\":" + (content.Right - content.Left) +
      ",\"height\":" + (content.Bottom - content.Top) + "}}";
  }

  static string Escape(string value) {
    return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
  }
}
"@ | Out-Null

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(',')
  $id = if ($parts.Length -gt 0) { $parts[0] } else { '0' }
  if ($parts.Length -ne 3 -or $parts[1] -ne 'select') {
    [Console]::Out.WriteLine("$id|error:command")
    [Console]::Out.Flush()
    continue
  }
  try {
    $result = [PixmintWindowTarget]::Select([long]$parts[2])
    [Console]::Out.WriteLine("$id|$result")
  } catch {
    $message = $_.Exception.Message -replace '[\r\n|]', ' '
    [Console]::Out.WriteLine("$id|error:exception:$message")
  }
  [Console]::Out.Flush()
}
`

let scriptPath = ''

function targetScriptPath(): string {
  if (scriptPath) return scriptPath
  scriptPath = join(tmpdir(), `pixmint-window-target-${process.pid}.ps1`)
  writeFileSync(scriptPath, TARGET_SCRIPT, 'utf8')
  return scriptPath
}

function removeTargetScript(): void {
  if (!scriptPath) return
  try {
    if (existsSync(scriptPath)) unlinkSync(scriptPath)
  } catch {
    // 临时脚本清理失败不应影响退出
  }
  scriptPath = ''
}

interface RawTarget {
  hwnd: number
  title: string
  class: string
  windowRect: Rect
  clientRect: Rect
  contentRect: Rect
}

/**
 * 背景：窗口长截图必须先选中一个顶层窗口，并拿到它的主滚动内容区。
 * 设计意图：desktopCapturer 负责缩略图列表，PowerShell/UIA 负责置前和内容区矩形。
 * 关键约束：只返回一个窗口目标；屏幕/多窗口歧义由上层提示选择具体窗口。
 */
export class WindowTargetService {
  private warmed = false
  private readonly client = new SidecarClient({
    name: 'window-target',
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
        targetScriptPath(),
        '-AppPid',
        String(process.pid)
      ]
    }),
    defaultTimeoutMs: 2500,
    onLog: (message) => logDiagnostic('window-target', message, 'warn')
  })

  async list(): Promise<WindowTargetItem[]> {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 180, height: 112 },
      fetchWindowIcons: true
    })
    const items: WindowTargetItem[] = []
    for (const source of sources) {
      const name = source.name.trim()
      if (!name) continue
      if (
        name === 'Pixmint' ||
        name.includes('长截图') ||
        name.includes('窗口长截图') ||
        name.includes('设置')
      ) {
        continue
      }
      const kind = source.id.startsWith('screen:') ? 'screen' : 'window'
      if (kind === 'window' && !/^window:\d+/.test(source.id)) continue
      items.push({
        id: source.id,
        name,
        kind,
        thumbnailDataUrl: source.thumbnail.isEmpty()
          ? ''
          : source.thumbnail.toDataURL(),
        displayId: source.display_id || undefined,
        appIconDataUrl:
          source.appIcon && !source.appIcon.isEmpty()
            ? source.appIcon.toDataURL()
            : undefined,
        note: kind === 'screen' ? '需单一前台窗口' : undefined
      })
    }
    items.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'screen' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return items
  }

  async select(itemId: string): Promise<WindowTargetInfo> {
    if (itemId.startsWith('screen:')) {
      throw new Error('当前桌面有多个窗口，请选择具体窗口')
    }
    const match = /^window:(\d+)/.exec(itemId)
    if (!match) throw new Error('无法识别窗口')
    const hwnd = Number(match[1])
    const payload = await this.client.request(
      `select,${hwnd}`,
      this.warmed ? 3000 : 8000
    )
    if (!payload) throw new Error('目标窗口没有响应')
    this.warmed = true
    const start = payload.indexOf('{')
    const end = payload.lastIndexOf('}')
    if (start < 0 || end < start) {
      logDiagnostic('window-target', `invalid payload: ${payload.slice(0, 400)}`, 'warn')
      throw new Error('目标窗口信息无效')
    }
    const raw = JSON.parse(payload.slice(start, end + 1)) as RawTarget
    if (!raw.hwnd || raw.contentRect.width <= 0 || raw.contentRect.height <= 0) {
      throw new Error('无法读取目标窗口内容区')
    }
    const center = {
      x: raw.contentRect.x + raw.contentRect.width / 2,
      y: raw.contentRect.y + raw.contentRect.height / 2
    }
    const display = screen.getDisplayNearestPoint(center)
    const toDip = (rect: Rect): Rect => ({
      x: Math.round(rect.x / display.scaleFactor - display.bounds.x),
      y: Math.round(rect.y / display.scaleFactor - display.bounds.y),
      width: Math.round(rect.width / display.scaleFactor),
      height: Math.round(rect.height / display.scaleFactor)
    })
    return {
      targetId: itemId,
      hwnd,
      title: raw.title || '窗口',
      displayId: display.id,
      contentRect: toDip(raw.contentRect),
      windowRect: toDip(raw.windowRect),
      scaleFactor: display.scaleFactor
    }
  }

  dispose(): void {
    this.client.dispose()
    removeTargetScript()
  }
}
