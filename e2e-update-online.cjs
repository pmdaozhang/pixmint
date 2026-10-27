const { _electron: electron } = require('playwright-core')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const INSTALLED = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\pixmint\\Pixmint.exe'
const targetVersion =
  process.env.UPDATE_TARGET_VERSION ||
  JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForWindow(app, selector, timeout = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    for (const window of app.windows()) {
      try {
        if ((await window.locator(selector).count()) > 0) return window
      } catch {
        // window may be closing
      }
    }
    await sleep(200)
  }
  throw new Error(`timeout waiting for ${selector}`)
}

function installedVersion() {
  try {
    return execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `(Get-Item '${INSTALLED}').VersionInfo.FileVersion`
      ],
      { encoding: 'utf8' }
    ).trim()
  } catch {
    return ''
  }
}

;(async () => {
  console.log('INSTALLED_BEFORE', installedVersion())
  let app = null
  try {
    app = await electron.launch({
      executablePath: INSTALLED,
      args: ['--show-settings'],
      env: { ...process.env }
    })
    app.process().stdout?.on('data', (data) => console.log('MAIN', String(data).trim()))
    app.process().stderr?.on('data', (data) => console.log('MAIN_ERR', String(data).trim()))
    const page = await waitForWindow(app, '.settings-root', 20000)
    await page.waitForSelector('.settings-root', { timeout: 20000 })

    const updateRow = page.locator('.update-row')
    await updateRow.waitFor({ timeout: 10000 })
    let text = (await updateRow.innerText()).replace(/\s+/g, ' ')
    console.log('UPDATE_INITIAL', text)

    if (!text.includes('发现新版本') && !text.includes('下载更新')) {
      await updateRow.getByRole('button', { name: '检查更新' }).click()
    }

    await page.waitForFunction(
      () => {
        const row = document.querySelector('.update-row')
        return Boolean(
          row &&
            (row.textContent?.includes('发现新版本') ||
              row.textContent?.includes('下载更新'))
        )
      },
      undefined,
      { timeout: 60000 }
    )
    text = (await updateRow.innerText()).replace(/\s+/g, ' ')
    console.log('UPDATE_FOUND', text)
    if (!text.includes(targetVersion)) {
      throw new Error(`update version is not ${targetVersion}`)
    }

    await updateRow.getByRole('button', { name: '下载更新' }).click()
    await page.waitForFunction(
      () => {
        const row = document.querySelector('.update-row')
        return Boolean(row && row.textContent?.includes('重启并安装'))
      },
      undefined,
      { timeout: 300000 }
    )
    text = (await updateRow.innerText()).replace(/\s+/g, ' ')
    console.log('UPDATE_DOWNLOADED', text)

    await updateRow.getByRole('button', { name: '重启并安装' }).click()
    console.log('UPDATE_INSTALL_TRIGGERED')
    await sleep(5000)

    let version = ''
    for (let attempt = 0; attempt < 120; attempt += 1) {
      version = installedVersion()
      if (version === targetVersion) break
      await sleep(2000)
    }
    console.log('INSTALLED_AFTER', version)
    if (version !== targetVersion) {
      throw new Error(`installed version is ${version}, expected ${targetVersion}`)
    }

    console.log('ONLINE_UPDATE_E2E_OK')
    await app.close().catch(() => {})
    process.exit(0)
  } catch (error) {
    console.error('ONLINE_UPDATE_E2E_FAIL', error)
    await app?.close().catch(() => {})
    process.exit(1)
  }
})()
