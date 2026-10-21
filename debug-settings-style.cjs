const { _electron: electron } = require('playwright-core')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const PROJECT = __dirname
const EXE = path.join(PROJECT, 'release', 'win-unpacked', 'Pixmint.exe')

;(async () => {
  const app = await electron.launch({
    executablePath: EXE,
    args: ['--e2e-settings'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.settings-root', { timeout: 15000 })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const info = await app.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('settings')
      )
      if (!target) return null
      const buffer = target.getNativeWindowHandle()
      return {
        handle: buffer.readBigUInt64LE(0).toString(),
        visible: target.isVisible(),
        title: target.getTitle()
      }
    })
    console.log('SETTINGS_WINDOW', info)
    if (info) {
      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
}
"@
$h=[IntPtr]::new([long]${info.handle})
$style=[W]::GetWindowLongPtr($h,-16).ToInt64()
$ex=[W]::GetWindowLongPtr($h,-20).ToInt64()
$owner=[W]::GetWindow($h,4)
[pscustomobject]@{Style=('0x{0:X}' -f $style);ExStyle=('0x{0:X}' -f $ex);ToolWindow=(($ex -band 0x80) -ne 0);AppWindow=(($ex -band 0x40000) -ne 0);Visible=[W]::IsWindowVisible($h);Owner=$owner} | Format-List
`
      console.log(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8' }))
    }
    await app.close()
    process.exit(0)
  } catch (error) {
    console.error('STYLE_FAIL', error)
    await app.close().catch(() => {})
    process.exit(1)
  }
})()
