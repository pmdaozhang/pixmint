const { _electron: electron } = require('playwright-core')
const { execFileSync } = require('node:child_process')

const INSTALLED = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\pixmint\\Pixmint.exe'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
    const page = await app.firstWindow()
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
    if (!text.includes('0.5.0')) throw new Error('update version is not 0.5.0')

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
      if (version === '0.5.0') break
      await sleep(2000)
    }
    console.log('INSTALLED_AFTER', version)
    if (version !== '0.5.0') {
      throw new Error(`installed version is ${version}, expected 0.5.0`)
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
