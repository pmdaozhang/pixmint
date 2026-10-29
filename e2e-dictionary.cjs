const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--show-settings'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  try {
    let win = null
    const deadline = Date.now() + 20000
    while (!win && Date.now() < deadline) {
      for (const candidate of app.windows()) {
        try {
          if ((await candidate.locator('#settings-root, .settings-root').count()) > 0) {
            win = candidate
            break
          }
        } catch {
          // closing
        }
      }
      if (!win) await sleep(300)
    }
    if (!win) {
      const any = await app.firstWindow()
      await any.waitForSelector('body')
      win = any
    }
    const apple = await win.evaluate(() => window.snapglass.dictionary.lookup('apple'))
    const tomato = await win.evaluate(() => window.snapglass.dictionary.lookup('tomato'))
    const missing = await win.evaluate(() => window.snapglass.dictionary.lookup('zzzznotaword'))
    console.log('DICTIONARY_APPLE', JSON.stringify(apple))
    console.log('DICTIONARY_TOMATO', JSON.stringify(tomato))
    console.log('DICTIONARY_MISSING', JSON.stringify(missing))
    if (!apple || !apple.meanings.length) throw new Error('apple lookup failed')
    if (missing !== null) throw new Error('unknown word should return null')
    console.log('DICTIONARY_OK')
  } finally {
    await app.close().catch(() => {})
  }
})().catch((error) => {
  console.error('DICTIONARY_FAIL', error)
  process.exit(1)
})
