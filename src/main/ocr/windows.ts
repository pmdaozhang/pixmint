import { execFile } from 'node:child_process'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { OcrResult, OcrTextBlock } from '../../shared/types'

const execFileAsync = promisify(execFile)

const WINDOWS_OCR_SCRIPT = String.raw`
param([string]$ImagePath, [string]$LanguageTag = 'zh-Hans-CN')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Globalization.Language,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and
  $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
})[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = $null
try {
  $language = New-Object Windows.Globalization.Language -ArgumentList $LanguageTag
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
} catch {
  $engine = $null
}
if (-not $engine) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}
if (-not $engine) { throw 'Windows OCR engine is not available. Install OCR language features first.' }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines = @($result.Lines | ForEach-Object { $_.Text })
$blocks = @()
foreach ($line in $result.Lines) {
  $words = @($line.Words)
  if ($words.Count -eq 0) { continue }
  $left = [double]::PositiveInfinity
  $top = [double]::PositiveInfinity
  $right = [double]::NegativeInfinity
  $bottom = [double]::NegativeInfinity
  foreach ($word in $words) {
    $rect = $word.BoundingRect
    if ($rect.Width -le 0 -or $rect.Height -le 0) { continue }
    if ($rect.X -lt $left) { $left = $rect.X }
    if ($rect.Y -lt $top) { $top = $rect.Y }
    if (($rect.X + $rect.Width) -gt $right) { $right = $rect.X + $rect.Width }
    if (($rect.Y + $rect.Height) -gt $bottom) { $bottom = $rect.Y + $rect.Height }
  }
  if ($left -eq [double]::PositiveInfinity) { continue }
  $blocks += [pscustomobject]@{
    text = $line.Text
    x = [math]::Round($left)
    y = [math]::Round($top)
    width = [math]::Max(1, [math]::Round($right - $left))
    height = [math]::Max(1, [math]::Round($bottom - $top))
  }
}
$available = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag })

$json = [pscustomobject]@{
  text = $result.Text
  lines = $lines
  blocks = $blocks
  language = $engine.RecognizerLanguage.LanguageTag
  available = $available
} | ConvertTo-Json -Compress -Depth 4
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
[Convert]::ToBase64String($bytes)
`

function scriptPath(): string {
  return join(tmpdir(), `snapglass-windows-ocr-${process.pid}-${Date.now()}.ps1`)
}

export async function recognizeWindows(
  imagePath: string,
  languageTag = 'zh-Hans-CN'
): Promise<OcrResult> {
  const path = scriptPath()
  writeFileSync(path, WINDOWS_OCR_SCRIPT, 'utf8')
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path,
        '-ImagePath',
        imagePath,
        '-LanguageTag',
        languageTag
      ],
      { windowsHide: true, timeout: 60000, maxBuffer: 20 * 1024 * 1024 }
    )
    const encoded = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop()
    if (!encoded) throw new Error('Windows OCR did not return data')
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded) as {
      text?: string
      lines?: string[] | string
      blocks?: unknown
      language?: string
      available?: string[] | string
    }
    console.log(
      'OCR_ENGINE',
      parsed.language ?? 'unknown',
      'AVAILABLE',
      Array.isArray(parsed.available) ? parsed.available.join(',') : parsed.available ?? ''
    )
    const lines = Array.isArray(parsed.lines)
      ? parsed.lines
      : parsed.lines
        ? [parsed.lines]
        : []
    return { text: parsed.text ?? '', lines, blocks: parseWindowsBlocks(parsed.blocks) }
  } finally {
    try {
      unlinkSync(path)
    } catch {
      // 临时脚本清理失败不影响识别结果
    }
  }
}

function parseWindowsBlocks(raw: unknown): OcrTextBlock[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  return list.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const text = typeof record.text === 'string' ? record.text.trim() : ''
    const x = Number(record.x)
    const y = Number(record.y)
    const width = Number(record.width)
    const height = Number(record.height)
    if (
      !text ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return []
    }
    return [{ text, x, y, width, height }]
  })
}
