const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

/** 验证：语言切换双向生效；下拉里的中文名固定为「简体中文」。 */
;(async () => {
  const project = path.resolve(__dirname, '..')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-i18n3-'))
  const childEnv = { ...process.env, PIXMINT_USER_DATA_DIR: userData }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.', '--e2e-settings'],
    cwd: project,
    env: childEnv
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.settings-root', { timeout: 15000 })

  const snap = async (label) => {
    const state = await page.evaluate(() => ({
      selects: Array.from(document.querySelectorAll('select')).map((s) => ({
        value: s.value,
        options: Array.from(s.options).map((o) => o.textContent)
      })),
      heading: document.querySelector('.card-title')?.textContent?.trim() ?? '',
      languageRow: Array.from(document.querySelectorAll('.row-label strong'))
        .map((el) => el.textContent.trim())
        .find((text) => text === 'Language' || text === '界面语言') ?? ''
    }))
    console.log(label, JSON.stringify(state, null, 1))
  }

  await snap('--- 初始 ---')
  await page.selectOption('select >> nth=2', 'en-US')
  await page.waitForTimeout(900)
  await snap('--- 切到 English ---')
  await page.selectOption('select >> nth=2', 'zh-CN')
  await page.waitForTimeout(900)
  await snap('--- 切回 简体中文 ---')

  await app.close()
})().catch((error) => {
  console.error('I18N_CHECK_FAILED', error)
  process.exit(1)
})
