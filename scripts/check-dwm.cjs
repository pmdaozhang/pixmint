const { _electron: electron } = require('playwright-core')
const path = require('node:path')

/** 临时诊断：启动覆盖层，读取主进程 DISABLE_TRANSITIONS 的 HRESULT。 */
;(async () => {
  const project = path.resolve(__dirname, '..')
  const app = await electron.launch({
    executablePath: path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.', '--smoke-overlay'],
    cwd: project,
    env: { ...process.env }
  })
  const lines = []
  app.process().stdout?.on('data', (chunk) => {
    const text = String(chunk)
    lines.push(text)
    process.stdout.write(text)
  })
  await new Promise((resolve) => setTimeout(resolve, 3500))
  await app.close().catch(() => undefined)
  const joined = lines.join('')
  const match = joined.match(/DISABLE_TRANSITIONS[^\n]*/g)
  console.log('DWM_CHECK', match ? match.join(' | ') : 'NOT_FOUND')
})().catch((error) => {
  console.error('DWM_CHECK_FAILED', error)
  process.exit(1)
})
