const { _electron: electron } = require('playwright-core')
const path = require('node:path')

const PROJECT = __dirname
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const PROFILE = path.join(PROJECT, '..', '_staging', 'e2e-translate-profile')

;(async () => {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-ocr-translate'],
    cwd: PROJECT,
    env: {
      ...process.env,
      OCR_SMOKE_FIXTURE: 'tests/fixtures/ocr-ambiguous.png',
      PIXMINT_USER_DATA_DIR: PROFILE
    }
  })
  const window = await app.firstWindow()
  await window.waitForSelector('.ocr-root', { timeout: 15000 })
  await new Promise((resolve) => setTimeout(resolve, 500))
  const bounds = await app.evaluate(({ BrowserWindow }) => {
    const visible = BrowserWindow.getAllWindows().find((item) => item.isVisible())
    return visible ? visible.getBounds() : null
  })
  console.log('TRANSLATE_WINDOW_BOUNDS', bounds)
  if (!bounds || bounds.height > 380 || bounds.height < 240) {
    throw new Error('translation window is not compact')
  }

  const original = await window.locator('#ocr-original').inputValue()
  console.log('TRANSLATE_WINDOW_TEXT', original)
  if (!original.includes('中文ab')) throw new Error('translate window text missing')
  const footer = await window.locator('.ocr-compact-footer').count()
  console.log('TRANSLATE_WINDOW_FOOTER', footer)
  if (footer !== 0) throw new Error('translate window should not have footer actions')
  const readOnly = await window.locator('#ocr-original').evaluate((element) => element.readOnly)
  console.log('TRANSLATE_ORIGINAL_READONLY', readOnly)
  if (!readOnly) throw new Error('translate original should be read-only')
  const selectable = await window.evaluate(() => {
    const originalElement = document.querySelector('#ocr-original')
    const resultElement = document.querySelector('.translate-result')
    return {
      original: originalElement ? getComputedStyle(originalElement).userSelect : null,
      result: resultElement ? getComputedStyle(resultElement).userSelect : null
    }
  })
  console.log('TRANSLATE_SELECTABLE', JSON.stringify(selectable))
  if (selectable.original !== 'text' || selectable.result !== 'text') {
    throw new Error('translate text should be selectable')
  }

  const directionTrigger = window.locator('.direction-trigger')
  const defaultDirection = await directionTrigger.innerText()
  console.log('TRANSLATE_DIRECTION_DEFAULT', defaultDirection)
  if (!defaultDirection.includes('CN→EN')) {
    throw new Error('ambiguous text should default to CN→EN')
  }
  await directionTrigger.click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const directionOptions = window.locator('.direction-option')
  const directionCount = await directionOptions.count()
  const directionLabels = await directionOptions.allInnerTexts()
  const selectedClass = await directionOptions
    .filter({ hasText: 'CN→EN' })
    .getAttribute('class')
  console.log(
    'TRANSLATE_DIRECTION_OPTIONS',
    directionCount,
    JSON.stringify(directionLabels),
    selectedClass
  )
  if (
    directionCount !== 2 ||
    !directionLabels.includes('CN→EN') ||
    !directionLabels.includes('EN→CN') ||
    !selectedClass?.includes('selected')
  ) {
    throw new Error('translation direction menu is incomplete')
  }

  await window.evaluate(async () => {
    await window.snapglass.settings.update({ translationProvider: 'free' })
    window.dispatchEvent(new Event('focus'))
  })
  await new Promise((resolve) => setTimeout(resolve, 300))
  const hint = await window.locator('.ocr-hint').count()
  console.log('TRANSLATE_WINDOW_FREE_HINT', hint)
  if (hint !== 0) throw new Error('free provider should not show configuration hint')

  await window.evaluate(async () => {
    await window.snapglass.settings.update({ translationProvider: 'none' })
    window.dispatchEvent(new Event('focus'))
  })
  await new Promise((resolve) => setTimeout(resolve, 250))
  await directionOptions.filter({ hasText: 'EN→CN' }).click()
  await new Promise((resolve) => setTimeout(resolve, 150))
  const switchedDirection = await directionTrigger.innerText()
  const menuClosed = (await window.locator('.direction-menu').count()) === 0
  console.log('TRANSLATE_DIRECTION_SWITCH', switchedDirection, 'MENU_CLOSED', menuClosed)
  if (!switchedDirection.includes('EN→CN') || !menuClosed) {
    throw new Error('translation direction switch failed')
  }

  await window.locator('.ocr-icon-btn').click()
  await new Promise((resolve) => setTimeout(resolve, 300))
  console.log('TRANSLATE_WINDOW_E2E_OK')
  await app.close()
  process.exit(0)
})().catch((error) => {
  console.error('TRANSLATE_WINDOW_E2E_FAIL', error)
  process.exit(1)
})
