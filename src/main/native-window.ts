import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 背景：Windows 会给新建的全屏窗口播放“从小到大”的 DWM 过渡，
 * 截图覆盖层因此看起来像整个桌面放大了一下；Snipaste 这类原生工具没有这个动画。
 * 现状（2026-11）：DwmSetWindowAttribute(DWMWA_TRANSITIONS_FORCEDISABLED) 在 Windows 11
 * 上**不能**抑制覆盖层的打开缩放动画（实测 HRESULT=0，动画照常）。真正有效的做法是
 * 覆盖层永不 hide/show，空闲保持显示、只改 alpha（见 windows/overlay.ts）。
 * 这里保留调用，用于抑制最小化/还原等其它窗口过渡，失败只记录日志。
 */
export function disableWindowTransitions(handle: Buffer): void {
  if (process.platform !== 'win32') return
  try {
    const hwnd =
      handle.length >= 8
        ? handle.readBigUInt64LE(0).toString()
        : handle.readUInt32LE(0).toString()
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SnapGlassDwm {
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}
"@
$value = 1
$result = [SnapGlassDwm]::DwmSetWindowAttribute([IntPtr]::new([long]${hwnd}), 3, [ref]$value, 4)
Write-Output "HRESULT=$result"
`
    // 背景：窗口创建发生在启动和内存回收时，spawnSync 会同步阻塞主进程最多 4 秒，
    // 期间按 F1 的快捷键回调、所有 IPC 都要排队。
    // 设计意图：改为异步执行；窗口创建时是隐藏的，第一次显示远晚于 DWM 调用完成，
    // 仍然能在显示前关闭“从小到大”的展开动画。
    // 关键约束：超时后杀掉子进程；失败只记录日志，不影响窗口创建。
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script
      ],
      { windowsHide: true }
    )
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), 4000)
    timer.unref?.()
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      console.warn('DISABLE_TRANSITIONS_FAILED', error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        console.warn('DISABLE_TRANSITIONS_FAILED', stderr)
      } else {
        console.log('DISABLE_TRANSITIONS', stdout.trim())
      }
      try {
        appendFileSync(
          join(tmpdir(), 'pixmint-dwm.log'),
          `${new Date().toISOString()} ${stdout.trim()} ${stderr.trim()}\n`
        )
      } catch {
        // 诊断日志失败不影响窗口创建
      }
    })
    child.unref()
  } catch (error) {
    console.warn('DISABLE_TRANSITIONS_ERROR', error)
  }
}
