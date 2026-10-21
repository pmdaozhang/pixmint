const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--e2e-onboarding'],
    cwd: PROJECT,
    env: { ...process.env }
  })
  const window = await app.firstWindow()
  const errors = []
  window.on('pageerror', (error) => errors.push(error.message))
  window.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await window.waitForSelector('.onboarding-root', { timeout: 15000 })
  const shortcut = (await window.locator('.onb-keycap').innerText()).trim()
  console.log('ONBOARDING_SHORTCUT', shortcut)
  if (shortcut !== 'F1') throw new Error('onboarding shortcut should default to F1')
  if ((await window.locator('.onb-card').count()) !== 1) {
    throw new Error('onboarding card is missing')
  }

  await window.locator('.onb-primary').click()
  await window.waitForTimeout(2200)
  const styleCount = await window.locator('.onb-style-cell').count()
  const styleTitles = await window
    .locator('.onb-style-cell')
    .evaluateAll((items) => items.map((item) => item.getAttribute('title')))
  console.log('ONBOARDING_STYLES', styleCount, styleTitles)
  if (styleCount !== 3 || styleTitles.join(',') !== '实线,细线,点线') {
    throw new Error('onboarding line styles do not match the software')
  }

  await window.locator('.onb-replay').click()
  await window.waitForTimeout(200)
  if ((await window.locator('.onb-demo-content').count()) !== 1) {
    throw new Error('onboarding line animation failed to replay')
  }

  const finishVisible = await window.locator('.onb-primary').innerText()
  if (!finishVisible.includes('开始使用')) {
    throw new Error('onboarding finish button is missing')
  }

  const closed = window.waitForEvent('close', { timeout: 5000 })
  await window.locator('.onb-primary').click()
  await closed
  if (errors.length) throw new Error(`renderer errors: ${errors.join(' | ')}`)
  console.log('ONBOARDING_E2E_OK')
  await app.close()
  process.exit(0)
})().catch(async (error) => {
  console.error('ONBOARDING_E2E_FAIL', error)
  process.exit(1)
})
