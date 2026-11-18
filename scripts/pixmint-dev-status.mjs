#!/usr/bin/env node
/**
 * 开发版运行状态自检。
 *
 * 背景：开发版（`pnpm dev`）的进程名是 electron.exe，不是安装版的 Pixmint.exe，
 *       按 Pixmint.exe 查会误判“没起来”。
 * 用法：`node scripts/pixmint-dev-status.mjs`
 * 结论：输出开发版进程（命令行含 _snapglass_app 的 electron.exe）与日志尾部。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MARKER = '_snapglass_app'

let raw = ''
try {
  raw = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${MARKER}*' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim()
} catch {
  raw = ''
}

let parsed = null
if (raw) {
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
}
const processes = parsed ? (Array.isArray(parsed) ? parsed : [parsed]) : []
console.log(`开发版进程（electron.exe，命令行含 ${MARKER}）: ${processes.length} 个`)
for (const item of processes) console.log(`  PID ${item.ProcessId}`)

const logDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
const logPath = path.join(logDir, 'snapglass', 'snapglass.log')
try {
  const lines = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/)
  console.log('日志尾部:')
  for (const line of lines.slice(-3)) console.log(`  ${line}`)
} catch {
  console.log('日志: 未找到', logPath)
}

if (processes.length > 0) {
  console.log('结论：开发版已运行 → 按 F1 呼出截图覆盖层；关闭走托盘「退出」。')
} else {
  console.log('结论：未发现开发版进程。启动命令：pnpm dev')
}
