const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-ocr-translate'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  const window = await app.firstWindow()
  await window.waitForSelector('.ocr-root', { timeout: 15000 })
  await window.evaluate(async () => {
    await window.snapglass.settings.update({ translationProvider: 'free' })
    window.dispatchEvent(new Event('focus'))
  })
  // 翻译输入框在只读模式下不能 fill，直接走 preload 的翻译 API，
  // 测的是真实的 IPC + 网络翻译链路。
  const started = Date.now()
  const result = await window.evaluate(() =>
    window.snapglass.translation.translate('Hello world')
  )
  console.log('LIVE_TRANSLATION_MS', Date.now() - started)
  console.log('LIVE_TRANSLATION_RESULT', result)
  await app.close()
  process.exit(0)
})().catch((error) => {
  console.error('LIVE_TRANSLATION_E2E_FAIL', error)
  process.exit(1)
})
