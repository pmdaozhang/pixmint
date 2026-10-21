import { spawn } from 'node:child_process'

/**
 * 背景：Windows 会给新建的全屏窗口播放“从小到大”的 DWM 过渡，
 * 截图覆盖层因此看起来像整个桌面放大了一下；Snipaste 这类原生工具没有这个动画。
 * 设计意图：调用 DwmSetWindowAttribute(DWMWA_TRANSITIONS_FORCEDISABLED) 禁用该窗口过渡。
 * 关键约束：只在 Windows 调用；失败只记录日志，不能影响截图窗口创建。
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
[SnapGlassDwm]::DwmSetWindowAttribute([IntPtr]::new([long]${hwnd}), 3, [ref]$value, 4) | Out-Null
`
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
      { windowsHide: true, stdio: 'ignore' }
    )
    child.on('error', (error) => {
      console.warn('DISABLE_TRANSITIONS_FAILED', error)
    })
  } catch (error) {
    console.warn('DISABLE_TRANSITIONS_ERROR', error)
  }
}
