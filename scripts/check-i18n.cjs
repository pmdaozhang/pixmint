const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

/** 用临时 userData 打开设置页，切到英文并截图，避免污染真实设置。 */
;(async () => {
  const project = path.resolve(__dirname, '..')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-i18n-'))
  const app = await electron.launch({
    executablePath: path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.', '--e2e-settings'],
    cwd: project,
    env: { ...process.env, PIXMINT_USER_DATA_DIR: userData }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.settings-root', { timeout: 15000 })
  // 语言下拉是第 3 个 select：翻译服务、目标语言、界面语言
  await page.selectOption('select >> nth=2', 'en-US')
  await page.waitForTimeout(700)
  await page.screenshot({ path: path.join(project, 'test-results', 'settings-en.png') })
  const title = await page.locator('.card-title').first().innerText()
  console.log('I18N_SETTINGS_TITLE', title.replace(/\s+/g, ' '))
  await app.close()
})().catch((error) => {
  console.error('I18N_CHECK_FAILED', error)
  process.exit(1)
})
