const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

/** 用临时 userData（英文）启动覆盖层，框选后截图，验证工具栏语言。 */
;(async () => {
  const project = path.resolve(__dirname, '..')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pixmint-overlay-i18n-'))
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({ schemaVersion: 1, language: 'en-US' })
  )
  const app = await electron.launch({
    executablePath: path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.', '--smoke-overlay'],
    cwd: project,
    env: { ...process.env, PIXMINT_USER_DATA_DIR: userData }
  })
  const overlay = await app.firstWindow()
  await overlay.waitForSelector('.overlay-root', { timeout: 20000 })
  await overlay.waitForTimeout(1800)
  await overlay.mouse.move(300, 220)
  await overlay.mouse.down()
  await overlay.mouse.move(1100, 720, { steps: 8 })
  await overlay.mouse.up()
  await overlay.waitForSelector('.tooldock', { timeout: 8000 })
  await overlay.waitForTimeout(300)
  await overlay.screenshot({ path: path.join(project, 'test-results', 'overlay-en.png') })
  const english = await overlay.locator('[title="Rectangle / Ellipse"]').count()
  console.log('OVERLAY_I18N', english > 0 ? 'EN_OK' : 'EN_MISSING')
  await app.close()
})().catch((error) => {
  console.error('OVERLAY_I18N_FAILED', error)
  process.exit(1)
})
