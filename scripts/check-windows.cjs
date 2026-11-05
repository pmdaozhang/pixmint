const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

;(async () => {
  const project = path.resolve(__dirname, '..')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-windows-'))
  const app = await electron.launch({
    executablePath: path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.', '--smoke-overlay'],
    cwd: project,
    env: { ...process.env, PIXMINT_USER_DATA_DIR: userData }
  })
  app.process().stdout?.on('data', (chunk) => process.stdout.write(String(chunk)))
  await new Promise((resolve) => setTimeout(resolve, 4000))
  const windows = app.windows()
  console.log('WINDOW_COUNT', windows.length)
  for (const window of windows) {
    console.log('WINDOW', await window.title().catch(() => '?'), window.url())
  }
  console.log('EXITED', app.process().exitCode)
  await app.close().catch(() => undefined)
})().catch((error) => {
  console.error('CHECK_WINDOWS_FAILED', error)
  process.exit(1)
})
