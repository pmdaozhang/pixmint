const fs = require('node:fs')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')

;(async () => {
  const startedAt = Date.now()
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--e2e-settings'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.settings-root', { timeout: 15000 })
  console.log('SETTINGS_STARTUP_MS', Date.now() - startedAt)
  const brandMarks = await page.locator('.brand-mark').count()
  console.log('SETTINGS_BRAND_MARK', brandMarks)
  if (brandMarks !== 1) throw new Error('settings brand mark missing')
  const iconPath = path.join(PROJECT, 'assets', 'icon.ico')
  const iconExists = fs.existsSync(iconPath)
  console.log('SETTINGS_ICON_FILE', iconExists, iconExists ? fs.statSync(iconPath).size : 0)
  if (!iconExists) throw new Error('settings window icon file is missing')
  if ((await page.locator('text=OCR 与翻译').count()) === 0) {
    throw new Error('translation settings card missing')
  }

  await page.selectOption('#translation-provider', 'openai')
  await page.waitForSelector('#translation-key')
  await page.locator('#translation-key').fill('test-key-abc')
  await page.locator('#translation-key-save').click()
  await new Promise((resolve) => setTimeout(resolve, 500))

  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  const secretsPath = path.join(userData, 'secrets.json')
  const secrets = fs.readFileSync(secretsPath, 'utf8')
  console.log('SECRET_WRITTEN', secrets.includes('translationKey'))
  console.log('SECRET_PLAINTEXT', secrets.includes('test-key-abc'))
  if (!secrets.includes('translationKey')) throw new Error('encrypted key was not written')
  if (secrets.includes('test-key-abc')) throw new Error('API key was stored in plaintext')

  await page.locator('#translation-key').fill('')
  await page.locator('#translation-key-save').click()
  await new Promise((resolve) => setTimeout(resolve, 400))
  const cleared = fs.readFileSync(secretsPath, 'utf8')
  console.log('SECRET_CLEARED', !cleared.includes('translationKey'))
  if (cleared.includes('translationKey')) throw new Error('API key was not cleared')

  await page.selectOption('#translation-provider', 'free')
  console.log('SETTINGS_E2E_OK')
  await app.close()
  process.exit(0)
})().catch((error) => {
  console.error('SETTINGS_E2E_FAIL', error)
  process.exit(1)
})
