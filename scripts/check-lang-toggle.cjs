const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

/** 复现：设置页里 en-US → zh-CN 来回切换，打印标题和设置值。 */
;(async () => {
  const project = path.resolve(__dirname, '..')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-lang-toggle-'))
  const app = await electron.launch({
    executablePath: path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.', '--e2e-settings'],
    cwd: project,
    env: { ...process.env, PIXMINT_USER_DATA_DIR: userData }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.settings-root', { timeout: 15000 })

  // 第一张卡片现在是界面语言，取第二张（快捷键）判断语言是否切换
  const title = async () => (await page.locator('.card-title').nth(1).innerText()).trim()
  const stored = async () =>
    app.evaluate(async ({ ipcMain }) => {
      // 直接读渲染层可见的设置
      return null
    })

  console.log('START', await title())

  await page.selectOption('#interface-language', 'en-US')
  await page.waitForTimeout(600)
  console.log('AFTER_EN', await title())

  await page.selectOption('#interface-language', 'zh-CN')
  await page.waitForTimeout(600)
  console.log('AFTER_ZH', await title())

  const selectValue = await page.locator('#interface-language').inputValue()
  console.log('SELECT_VALUE', selectValue)

  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.waitForTimeout(300)
  console.log('CONSOLE_ERRORS', errors.length)

  await app.close()
})().catch((error) => {
  console.error('LANG_TOGGLE_FAILED', error)
  process.exit(1)
})
