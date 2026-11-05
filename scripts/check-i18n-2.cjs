const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

/** 临时 userData（英文）验证引导页与反馈窗口。 */
async function launchWithEnglish(args) {
  const project = path.resolve(__dirname, '..')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-i18n2-'))
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({ schemaVersion: 1, language: 'en-US' })
  )
  const app = await electron.launch({
    executablePath: path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.', ...args],
    cwd: project,
    env: { ...process.env, PIXMINT_USER_DATA_DIR: userData }
  })
  return { app, project }
}

;(async () => {
  const onboarding = await launchWithEnglish(['--e2e-onboarding'])
  const ob = await onboarding.app.firstWindow()
  await ob.waitForSelector('.onb-card', { timeout: 15000 })
  await ob.waitForTimeout(600)
  await ob.screenshot({ path: path.join(onboarding.project, 'test-results', 'onboarding-en.png') })
  const skip = (await ob.locator('.onb-skip').innerText()).trim()
  console.log('ONBOARDING_I18N', skip)
  await onboarding.app.close()

  const feedback = await launchWithEnglish(['--e2e-feedback'])
  const fb = await feedback.app.firstWindow()
  await fb.waitForSelector('.feedback-root, .feedback-form, h1', { timeout: 15000 })
  await fb.waitForTimeout(600)
  await fb.screenshot({ path: path.join(feedback.project, 'test-results', 'feedback-en.png') })
  const heading = (await fb.locator('h1').first().innerText()).trim()
  console.log('FEEDBACK_I18N', heading)
  await feedback.app.close()
})().catch((error) => {
  console.error('I18N2_FAILED', error)
  process.exit(1)
})
