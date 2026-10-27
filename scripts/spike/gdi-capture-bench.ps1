param(
  [int]$Width = 700,
  [int]$Height = 600,
  [int]$Frames = 30,
  [int]$Fps = 10,
  [ValidateSet('raw', 'png')]
  [string]$Mode = 'raw'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PixmintBenchDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@

try { [PixmintBenchDpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch { }
try { [PixmintBenchDpi]::SetProcessDPIAware() | Out-Null } catch { }

function Get-Percentile {
  param(
    [double[]]$Values,
    [double]$Percent
  )
  if ($Values.Count -eq 0) { return 0 }
  $ordered = $Values | Sort-Object
  $index = [Math]::Min($ordered.Count - 1, [Math]::Max(0, [Math]::Ceiling($Percent * $ordered.Count) - 1))
  return [double]$ordered[$index]
}

function Invoke-CaptureFrame {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [System.Drawing.Graphics]$Graphics,
    [string]$CaptureMode
  )
  # 背景：长截图需要知道单帧采集成本，而不是只看最终导出一张图的时间。
  # 设计意图：复用现有 GDI CopyFromScreen 路径，分别测原始像素和 PNG 编码两种表示。
  # 关键约束：只读屏幕到内存，不落盘，避免把测试画面留在磁盘。
  $Graphics.CopyFromScreen(0, 0, 0, 0, $Bitmap.Size)

  if ($CaptureMode -eq 'raw') {
    $rect = New-Object System.Drawing.Rectangle(0, 0, $Bitmap.Width, $Bitmap.Height)
    $locked = $Bitmap.LockBits(
      $rect,
      [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    try {
      $bytes = [byte[]]::new($locked.Stride * $locked.Height)
      [System.Runtime.InteropServices.Marshal]::Copy($locked.Scan0, $bytes, 0, $bytes.Length)
      return $bytes.Length
    } finally {
      $Bitmap.UnlockBits($locked) | Out-Null
    }
  }

  $stream = New-Object System.IO.MemoryStream
  try {
    $Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return $stream.Length
  } finally {
    $stream.Dispose()
  }
}

$bitmap = $null
$graphics = $null
try {
  $bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen(0, 0, 0, 0, $bitmap.Size)

  # 预热：排除首次 GDI 初始化、字体/图形驱动懒加载对结果的影响。
  for ($i = 0; $i -lt 5; $i++) {
    [void](Invoke-CaptureFrame -Bitmap $bitmap -Graphics $graphics -CaptureMode $Mode)
  }

  $intervalMs = 1000.0 / [Math]::Max(1, $Fps)
  $captureTimes = [System.Collections.Generic.List[double]]::new()
  $lastBytes = 0
  $sw = [System.Diagnostics.Stopwatch]::StartNew()

  for ($i = 0; $i -lt $Frames; $i++) {
    $frameStart = $sw.Elapsed.TotalMilliseconds
    $lastBytes = Invoke-CaptureFrame -Bitmap $bitmap -Graphics $graphics -CaptureMode $Mode
    $captureMs = $sw.Elapsed.TotalMilliseconds - $frameStart
    $captureTimes.Add($captureMs)

    $remaining = $intervalMs - $captureMs
    if ($remaining -gt 0) {
      [System.Threading.Thread]::Sleep([int][Math]::Round($remaining))
    }
  }

  $elapsedMs = $sw.Elapsed.TotalMilliseconds
  $result = [pscustomobject]@{
    ok = $true
    width = $Width
    height = $Height
    frames = $Frames
    targetFps = $Fps
    mode = $Mode
    elapsedMs = [Math]::Round($elapsedMs, 2)
    achievedFps = [Math]::Round($Frames / ($elapsedMs / 1000.0), 2)
    avgCaptureMs = [Math]::Round(($captureTimes | Measure-Object -Average).Average, 2)
    p95CaptureMs = [Math]::Round((Get-Percentile -Values $captureTimes.ToArray() -Percent 0.95), 2)
    minCaptureMs = [Math]::Round(($captureTimes | Measure-Object -Minimum).Minimum, 2)
    maxCaptureMs = [Math]::Round(($captureTimes | Measure-Object -Maximum).Maximum, 2)
    lastBytes = $lastBytes
  }
  $result | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{
    ok = $false
    width = $Width
    height = $Height
    frames = $Frames
    targetFps = $Fps
    mode = $Mode
    error = $_.Exception.Message
  } | ConvertTo-Json -Compress
  exit 1
} finally {
  if ($graphics) { $graphics.Dispose() }
  if ($bitmap) { $bitmap.Dispose() }
}
