const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')

const PROJECT = path.resolve(__dirname, '..', '..')
const RESULTS_DIR = path.join(PROJECT, 'test-results')

function electronExecutable() {
  const executable = require('electron')
  if (typeof executable !== 'string' || !fs.existsSync(executable)) {
    throw new Error('找不到 Electron 可执行文件，请先运行 pnpm install')
  }
  return executable
}

async function launch(extraArgs = [], env = {}) {
  return electron.launch({
    executablePath: electronExecutable(),
    args: ['.', ...extraArgs],
    cwd: PROJECT,
    env: { ...process.env, ...env }
  })
}

async function waitForWindow(app, selector, timeout = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    for (const window of app.windows()) {
      try {
        if ((await window.locator(selector).count()) > 0) return window
      } catch {
        // 窗口可能正在关闭
      }
    }
    await sleep(100)
  }
  throw new Error(`timeout waiting for ${selector}`)
}

async function waitForInactive(app, timeout = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const active = await app.evaluate(() => globalThis.__snapglassOverlayActive?.())
    if (!active) return
    await sleep(100)
  }
  throw new Error('overlay did not become inactive')
}

async function selectRegion(window, x1, y1, x2, y2) {
  await window.mouse.move(x1, y1)
  await window.mouse.down()
  await window.mouse.move(x2, y2, { steps: 6 })
  await window.mouse.up()
  await window.waitForSelector('.tooldock', { timeout: 8000 })
}

async function memorySnapshot(app) {
  const memory = await app.evaluate(() => process.memoryUsage())
  const processes = await app.evaluate(({ app: electronApp }) =>
    electronApp.getAppMetrics().map((metric) => ({
      type: metric.type,
      pid: metric.pid,
      cpuPercent: metric.cpu.percentCPUUsage,
      workingSetKb: metric.memory.workingSetSize,
      peakWorkingSetKb: metric.memory.peakWorkingSetSize,
      privateKb: metric.memory.privateBytes,
      sharedKb: metric.memory.sharedBytes
    }))
  )
  let renderer = null
  for (const window of app.windows()) {
    try {
      renderer = await window.evaluate(() => ({
        heap: performance.memory
          ? {
              usedJSHeapSize: performance.memory.usedJSHeapSize,
              totalJSHeapSize: performance.memory.totalJSHeapSize
            }
          : null,
        nodes: document.getElementsByTagName('*').length,
        canvases: document.querySelectorAll('canvas').length,
        images: document.querySelectorAll('img').length
      }))
      break
    } catch {
      // 窗口可能正在关闭
    }
  }
  return { memory, processes, renderer }
}

function tempArtifacts() {
  const dir = os.tmpdir()
  try {
    const result = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /^(snapglass|pixmint)-/.test(entry.name)) {
        const filePath = path.join(dir, entry.name)
        try {
          result.push({ name: entry.name, size: fs.statSync(filePath).size })
        } catch {
          result.push({ name: entry.name, size: 0 })
        }
      }
      if (entry.isDirectory() && entry.name === 'snapglass-recording') {
        const recordingDir = path.join(dir, entry.name)
        for (const file of fs.readdirSync(recordingDir)) {
          try {
            result.push({
              name: `${entry.name}/${file}`,
              size: fs.statSync(path.join(recordingDir, file)).size
            })
          } catch {
            // 录制文件可能在统计时被清理
          }
        }
      }
    }
    return result
  } catch {
    return []
  }
}

function percentile(values, target) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((target / 100) * sorted.length) - 1)
  )
  return sorted[index]
}

function writeReport(name, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(RESULTS_DIR, `${name}-${stamp}.json`)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
  console.log('SOAK_REPORT', filePath)
  return filePath
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = {
  PROJECT,
  RESULTS_DIR,
  launch,
  memorySnapshot,
  percentile,
  selectRegion,
  sleep,
  tempArtifacts,
  waitForInactive,
  waitForWindow,
  writeReport
}
