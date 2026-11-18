// 临时预览启动器：分离启动 Electron 覆盖层，避免被启动会话回收。
// 仅供本机演示，不属于应用代码。
const { spawn } = require('node:child_process')
const path = require('node:path')

const project = __dirname
const exe = path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(exe, ['.', '--smoke-overlay'], {
  cwd: project,
  detached: true,
  stdio: 'ignore'
})
child.unref()
console.log('PID', child.pid)
