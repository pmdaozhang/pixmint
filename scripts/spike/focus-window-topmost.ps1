param([Parameter(Mandatory = $true)][string]$Title)

$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class PixmintE2eWindow {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$target = [IntPtr]::Zero
$bestArea = 0
$callback = [PixmintE2eWindow+EnumProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  $text = [Text.StringBuilder]::new(512)
  [PixmintE2eWindow]::GetWindowText($hWnd, $text, 512) | Out-Null
  if ($text.ToString().Contains($Title) -and [PixmintE2eWindow]::IsWindowVisible($hWnd)) {
    $rect = New-Object PixmintE2eWindow+RECT
    if ([PixmintE2eWindow]::GetWindowRect($hWnd, [ref]$rect)) {
      $area = ($rect.Right - $rect.Left) * ($rect.Bottom - $rect.Top)
      if ($area -gt $script:bestArea) {
        $script:bestArea = $area
        $script:target = $hWnd
      }
    }
  }
  return $true
}
[PixmintE2eWindow]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
if ($target -eq [IntPtr]::Zero) {
  throw "Target window not found: $Title"
}

$HWND_TOPMOST = [IntPtr](-1)
$SWP_SHOWWINDOW = 0x0040
[PixmintE2eWindow]::ShowWindow($target, 9) | Out-Null
[PixmintE2eWindow]::SetWindowPos(
  $target,
  $HWND_TOPMOST,
  100,
  100,
  1200,
  800,
  $SWP_SHOWWINDOW
) | Out-Null
[PixmintE2eWindow]::SetForegroundWindow($target) | Out-Null
Write-Output "FOCUSED $($target.ToInt64())"
