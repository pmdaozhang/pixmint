import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { OcrResult } from '../../shared/types'

const execFileAsync = promisify(execFile)

const WINDOWS_OCR_SCRIPT = String.raw`
param([string]$ImagePath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
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
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw 'Windows OCR engine is not available. Install OCR language features first.' }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines = @($result.Lines | ForEach-Object { $_.Text })

$json = [pscustomobject]@{
  text = $result.Text
  lines = $lines
} | ConvertTo-Json -Compress -Depth 4
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
[Convert]::ToBase64String($bytes)
`

function scriptPath(): string {
  return join(tmpdir(), 'snapglass-windows-ocr.ps1')
}

export async function recognizeWindows(imagePath: string): Promise<OcrResult> {
  const path = scriptPath()
  writeFileSync(path, WINDOWS_OCR_SCRIPT, 'utf8')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path, '-ImagePath', imagePath],
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
  }
  const lines = Array.isArray(parsed.lines)
    ? parsed.lines
    : parsed.lines
      ? [parsed.lines]
      : []
  return { text: parsed.text ?? '', lines }
}
