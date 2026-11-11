#!/usr/bin/env node
/**
 * 覆盖层视觉回归（屏幕级）：
 *
 * 现有的 e2e 只量 DOM opacity，无法发现“遮罩缩放动画”和“首帧合成卡顿”。
 * 这个脚本会真实录屏，然后按帧检查两件事：
 *   1. F1 遮罩必须单帧直出：从桌面到遮罩稳定态之间最多允许 2 帧过渡；
 *   2. 框选松手后工具栏必须在 2 帧内出现在屏幕上。
 *
 * 运行前提：Windows 桌面、ffmpeg（可用 FFMPEG_PATH 指定）、项目内 electron 依赖。
 * 用法：pnpm regression:overlay-visual
 *
 * 退出码：0 通过；1 不通过；2 环境不满足（比如找不到 ffmpeg）。
 */
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode } from 'fast-png'

const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright-core')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROJECT = path.resolve(HERE, '..', '..')
const ELECTRON = path.join(PROJECT, 'node_modules', 'electron', 'dist', 'electron.exe')
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const TMP = path.join(os.tmpdir(), `pixmint-overlay-visual-${Date.now()}`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const problems = []
function fail(message) {
  problems.push(message)
  console.error(`FAIL ${message}`)
}
function info(message) {
  console.log(message)
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} exited ${result.status}: ${result.stderr || ''}`)
  }
  return result
}

function record(file, seconds) {
  return spawn(
    FFMPEG,
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'gdigrab', '-framerate', '60', '-i', 'desktop',
      '-t', String(seconds),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-pix_fmt', 'yuv420p',
      '-y', file
    ],
    { windowsHide: true }
  )
}

function waitExit(proc) {
  return new Promise((resolve) => proc.on('close', resolve))
}

async function extractFrames(video, dir, crop, prefix) {
  await fs.mkdir(dir, { recursive: true })
  run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error',
    '-i', video,
    '-vf', `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},fps=30`,
    '-start_number', '0',
    path.join(dir, `${prefix}-%03d.png`),
    '-y'
  ])
  const names = (await fs.readdir(dir)).filter((name) => name.startsWith(`${prefix}-`)).sort()
  return names.map((name) => path.join(dir, name))
}

async function frameMean(file, stride = 4) {
  const png = decode(await fs.readFile(file))
  const channels = png.channels
  const data = png.data
  let sum = 0
  let count = 0
  for (let i = 0; i < data.length; i += channels * stride) {
    sum += data[i] + data[i + 1] + data[i + 2]
    count += 3
  }
  return sum / count
}

async function frameBytes(file) {
  return decode(await fs.readFile(file))
}

function patchDiff(a, b) {
  const channels = Math.min(a.channels, b.channels)
  const length = Math.min(a.data.length, b.data.length)
  let sum = 0
  let count = 0
  for (let i = 0; i < length; i += channels) {
    sum += Math.abs(a.data[i] - b.data[i])
    count += 1
  }
  return count ? sum / count : 255
}

;(async () => {
  await fs.mkdir(TMP, { recursive: true })
  try {
    run(FFMPEG, ['-version'])
  } catch {
    console.error(`找不到 ffmpeg。请设置 FFMPEG_PATH 或把 ffmpeg 加入 PATH。`)
    process.exit(2)
  }

  const userData = path.join(TMP, 'userdata')
  await fs.mkdir(userData, { recursive: true })
  const settingsPath = path.join(userData, 'settings.json')
  const sourceSettings = path.join(os.homedir(), 'AppData', 'Roaming', 'snapglass', 'settings.json')
  try {
    const settings = JSON.parse(await fs.readFile(sourceSettings, 'utf8'))
    // 测试实例绝不能再往注册表写开机自启。
    settings.launchAtLogin = false
    await fs.writeFile(settingsPath, JSON.stringify(settings))
  } catch {
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        schemaVersion: 1,
        shortcut: 'F1',
        theme: 'system',
        language: 'zh-CN',
        launchAtLogin: false,
        onboardingCompleted: true,
        onboardingVersion: 2
      })
    )
  }

  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', '--smoke-overlay'],
    cwd: PROJECT,
    env: { ...process.env, PIXMINT_USER_DATA_DIR: userData }
  })

  try {
    let overlay = null
    const started = Date.now()
    while (Date.now() - started < 20000) {
      for (const win of app.windows()) {
        try {
          if ((await win.locator('.overlay-root').count()) > 0) {
            overlay = win
            break
          }
        } catch {
          // window closing
        }
      }
      if (overlay) break
      await sleep(100)
    }
    if (!overlay) throw new Error('覆盖层窗口没有出现')

    // 让 smoke 自动展示完成一次预热，再关闭会话。
    await sleep(2500)
    await overlay.keyboard.press('Escape').catch(() => {})
    await sleep(1200)

    const viewport = await overlay.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))

    // ---------- 1. 遮罩直出 ----------
    const flashVideo = path.join(TMP, 'flash.mp4')
    const flashRec = record(flashVideo, 3)
    await sleep(700)
    await app.evaluate(() => globalThis.__snapglassStartCapture && globalThis.__snapglassStartCapture())
    await sleep(1200)
    await overlay.keyboard.press('Escape').catch(() => {})
    await waitExit(flashRec)

    const center = {
      x: Math.max(0, Math.round(viewport.width / 2) - 450),
      y: Math.max(0, Math.round(viewport.height / 2) - 450),
      width: Math.min(900, viewport.width),
      height: Math.min(900, viewport.height)
    }
    const centerDir = path.join(TMP, 'center')
    const centerFrames = await extractFrames(flashVideo, centerDir, center, 'c')
    const means = []
    for (const file of centerFrames) means.push(await frameMean(file, 8))

    let dropIndex = -1
    let dropSize = 0
    for (let i = 1; i < means.length; i += 1) {
      const drop = means[i - 1] - means[i]
      if (drop > dropSize) {
        dropSize = drop
        dropIndex = i
      }
    }
    if (dropIndex < 0 || dropSize < 12) {
      fail(`遮罩没有在录屏中出现（最大单帧亮度下降 ${dropSize.toFixed(1)}）`)
    } else {
      // 用“遮罩出现后的帧差”判断是否还有过渡：
      // 单帧直出时，出现后第 1 帧和稳定后的第 4 帧应该几乎一样；
      // 如果还在缩放/淡入，两者会差很多（旧版实测相关系数只有 0.45）。
      const afterIndex = Math.min(centerFrames.length - 1, dropIndex + 1)
      const settledIndex = Math.min(centerFrames.length - 1, dropIndex + 4)
      const after = await frameBytes(centerFrames[afterIndex])
      const settled = await frameBytes(centerFrames[settledIndex])
      const mad = patchDiff(after, settled)
      info(`遮罩: 下降 ${dropSize.toFixed(1)}，出现后帧差 ${mad.toFixed(2)}`)
      if (mad > 6) {
        fail(`遮罩出现后仍在变化（帧差 ${mad.toFixed(2)}），可能又出现了缩放/淡入动画`)
      }
    }
    await fs.rm(centerDir, { recursive: true, force: true })

    // ---------- 2. 工具栏上屏 ----------
    const selection = { x: 400, y: 300, width: 900, height: 550 }
    const toolbarWidth = 740
    const toolbarTop =
      selection.y + selection.height + 16 + 104 < viewport.height
        ? selection.y + selection.height + 16
        : Math.max(8, selection.y - 104)
    const toolbarLeft = Math.max(
      8,
      Math.min(
        selection.x + selection.width - toolbarWidth,
        viewport.width - toolbarWidth - 8
      )
    )
    const band = {
      x: Math.max(0, toolbarLeft - 12),
      y: Math.max(0, toolbarTop - 10),
      width: Math.min(toolbarWidth + 24, viewport.width - Math.max(0, toolbarLeft - 12)),
      height: 64
    }

    const toolbarVideo = path.join(TMP, 'toolbar.mp4')
    const toolbarRec = record(toolbarVideo, 4)
    await sleep(700)
    await app.evaluate(() => globalThis.__snapglassStartCapture && globalThis.__snapglassStartCapture())
    await sleep(700)

    // 放大镜必须在框选前出现，并且能取到有效颜色。
    const magnifierDisplay = await overlay.evaluate(() => {
      const panel = document.querySelector('.magnifier')
      return panel ? getComputedStyle(panel).display : 'missing'
    })
    if (magnifierDisplay !== 'flex') fail(`放大镜没有出现（${magnifierDisplay}）`)
    await overlay.mouse.move(selection.x, selection.y)
    await sleep(200)
    const colorText = (await overlay.locator('.magnifier-hex').textContent())?.trim() ?? ''
    if (!/^#[0-9A-F]{6}$/.test(colorText)) fail(`放大镜没有取到有效颜色（${colorText}）`)

    await overlay.mouse.down()
    for (let i = 1; i <= 12; i += 1) {
      await overlay.mouse.move(
        selection.x + (selection.width * i) / 12,
        selection.y + (selection.height * i) / 12
      )
      await sleep(16)
    }
    await overlay.evaluate(() => {
      const marker = document.createElement('div')
      marker.style.cssText =
        'position:fixed;left:0;top:0;width:120px;height:120px;background:#ff00ff;z-index:999999;pointer-events:none'
      document.body.appendChild(marker)
    })
    await overlay.mouse.up()
    await sleep(500)
    if ((await overlay.locator('.magnifier').count()) !== 0) {
      fail('进入编辑态后放大镜没有隐藏')
    }
    await sleep(700)
    await overlay.keyboard.press('Escape').catch(() => {})
    await waitExit(toolbarRec)

    const markerDir = path.join(TMP, 'marker')
    const markFrames = await extractFrames(
      toolbarVideo,
      markerDir,
      { x: 0, y: 0, width: 120, height: 120 },
      'm'
    )
    const toolbarDir = path.join(TMP, 'toolbar')
    const toolbarFrames = await extractFrames(toolbarVideo, toolbarDir, band, 't')

    let markerIndex = -1
    for (let i = 0; i < markFrames.length; i += 1) {
      const png = await frameBytes(markFrames[i])
      let magenta = 0
      for (let p = 0; p < png.data.length; p += png.channels) {
        if (png.data[p] > 200 && png.data[p + 1] < 60 && png.data[p + 2] > 200) magenta += 1
      }
      if (magenta > 2000) {
        markerIndex = i
        break
      }
    }
    if (markerIndex < 0) {
      fail('没有在录屏里找到松手标记')
    } else {
      const reference = await frameBytes(toolbarFrames[Math.min(toolbarFrames.length - 1, markerIndex + 20)])
      let toolbarIndex = -1
      for (let i = Math.max(0, markerIndex - 5); i < Math.min(toolbarFrames.length, markerIndex + 15); i += 1) {
        const frame = await frameBytes(toolbarFrames[i])
        if (patchDiff(frame, reference) < 6) {
          toolbarIndex = i
          break
        }
      }
      if (toolbarIndex < 0) {
        fail('松手后 15 帧内工具栏没有出现在屏幕上')
      } else {
        const delta = toolbarIndex - markerIndex
        info(`工具栏: 松手后 ${delta} 帧出现（${Math.round((delta / 30) * 1000)}ms）`)
        if (delta > 2) fail(`工具栏在松手后 ${delta} 帧才出现（应 ≤ 2 帧）`)
      }
    }
    await fs.rm(markerDir, { recursive: true, force: true })
    await fs.rm(toolbarDir, { recursive: true, force: true })

    if (problems.length === 0) {
      info('OVERLAY_VISUAL_OK')
    } else {
      console.error(`OVERLAY_VISUAL_FAIL: ${problems.length} problem(s)`)
    }
  } finally {
    await app.close().catch(() => {})
  }

  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {})
  process.exit(problems.length === 0 ? 0 : 1)
})().catch(async (error) => {
  console.error('OVERLAY_VISUAL_ERROR', error)
  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {})
  process.exit(1)
})
