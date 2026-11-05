import { app, BrowserWindow, screen } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RecorderMode } from '../../shared/types'
import { withTimeout } from '../../shared/async'
import { FAKE_SCREEN_PNG } from '../test-fixture'
import type { OcrManager } from '../windows/ocr'
import { loadRoute } from '../windows/load'
import type { OverlayManager } from '../windows/overlay'
import type { PlatformServices } from '../platform'
import type { SecretStore } from '../secret-store'
import type { SettingsStore } from '../settings-store'
import { recognizeImageDataUrl } from '../ocr'
import { overlayReadyTotal, resetOverlayReadyCount } from './counters'

/**
 * 背景：8 个 smoke / soak 运行器原先和业务代码混在 index.ts，
 * 让入口文件多出近 400 行只服务测试的代码。
 * 设计意图：集中到 runtime/smoke.ts，由 index.ts 按命令行开关调用。
 * 关键约束：这些函数全部会主动 app.exit()，只允许在自动化入口下调用。
 */

export interface SmokeContext {
  preloadPath: string
  settingsStore: SettingsStore
  secretStore: SecretStore
  overlayManager: OverlayManager
  ocrManager: OcrManager
  platformServices: PlatformServices
  startCapture: (mode?: RecorderMode) => Promise<void>
}

export function runSmokeTest(ctx: SmokeContext): void {
  const window = new BrowserWindow({
    width: 860,
    height: 660,
    show: false,
    webPreferences: {
      preload: ctx.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  let failed = false
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') {
      failed = true
      console.error('SMOKE_CONSOLE', event.message)
    }
  })
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    failed = true
    console.error('SMOKE_LOAD_FAIL', code, description, url)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    failed = true
    console.error('SMOKE_RENDER_GONE', details.reason, details.exitCode)
  })
  window.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      console.log(failed ? 'SMOKE_FAIL' : 'SMOKE_OK')
      app.exit(failed ? 1 : 0)
    }, 700)
  })
  loadRoute(window, 'settings')
  setTimeout(() => {
    console.error('SMOKE_TIMEOUT')
    app.exit(1)
  }, 12000)
}

export async function runCaptureSmoke(ctx: SmokeContext): Promise<void> {
  try {
    const captures = await withTimeout(
      ctx.platformServices.capture.captureAll(),
      8000,
      '屏幕捕获超时，请检查屏幕录制权限'
    )
    console.log('SMOKE_CAPTURES', captures.length)
    resetOverlayReadyCount()
    ctx.overlayManager.prewarm(
      captures.map((capture) => ({
        id: capture.displayId,
        bounds: capture.bounds,
        scaleFactor: capture.scaleFactor
      }))
    )
    await ctx.overlayManager.start(captures[0])
    await new Promise((resolve) => setTimeout(resolve, 1800))
    console.log('SMOKE_OVERLAY_READY', overlayReadyTotal())
    if (overlayReadyTotal() > 0) {
      console.log('SMOKE_CAPTURE_OK')
      app.exit(0)
    } else {
      console.error('SMOKE_CAPTURE_FAIL')
      app.exit(1)
    }
  } catch (error) {
    console.error('SMOKE_CAPTURE_ERROR', error)
    app.exit(1)
  }
}

export function runOverlaySmoke(ctx: SmokeContext, ocrImage = false): void {
  const display = screen.getPrimaryDisplay()
  const bounds = display.bounds
  let imageDataUrl = FAKE_SCREEN_PNG
  if (ocrImage) {
    const imagePath = join(app.getAppPath(), 'tests', 'fixtures', 'ocr-overlay.png')
    imageDataUrl = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`
  }
  const fake = {
    displayId: display.id,
    bounds,
    scaleFactor: 1,
    imageDataUrl,
    imageWidth: Math.round(bounds.width),
    imageHeight: Math.round(bounds.height)
  }
  console.log('OVERLAY_SMOKE_START', bounds.width, bounds.height)
  ctx.overlayManager.prewarm([{ id: display.id, bounds: display.bounds, scaleFactor: 1 }])
  const show = (): void => {
    ctx.ocrManager.closeAll()
    void ctx.overlayManager.start(fake)
  }
  ;(globalThis as { __snapglassShowOverlay?: () => void }).__snapglassShowOverlay = show
  ;(
    globalThis as {
      __snapglassOverlayActive?: () => boolean
    }
  ).__snapglassOverlayActive = () => ctx.overlayManager.isActive()
  ;(
    globalThis as {
      __snapglassStartCapture?: () => Promise<void>
    }
  ).__snapglassStartCapture = () => ctx.startCapture()
  setTimeout(() => {
    show()
  }, 1200)
}

export async function runFastCaptureSmoke(ctx: SmokeContext): Promise<void> {
  const display = screen.getPrimaryDisplay()
  ctx.overlayManager.prewarm([
    { id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor }
  ])
  // 等常驻 PowerShell 助手完成预热，模拟用户启动后按 F1 的状态。
  await new Promise((resolve) => setTimeout(resolve, 1200))
  for (let index = 0; index < 3; index += 1) {
    const started = Date.now()
    await ctx.startCapture()
    console.log('SMOKE_START_CAPTURE_MS', index, Date.now() - started)
    await new Promise((resolve) => setTimeout(resolve, 800))
    ctx.overlayManager.hideAll()
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  app.exit(0)
}

export async function runOcrFileSmoke(filePath: string): Promise<void> {
  try {
    const dataUrl = `data:image/png;base64,${readFileSync(filePath).toString('base64')}`
    const result = await recognizeImageDataUrl(dataUrl)
    console.log('OCR_FILE_TEXT', result.text)
    console.log('OCR_FILE_LINES', JSON.stringify(result.lines))
    app.exit(0)
  } catch (error) {
    console.error('OCR_FILE_ERROR', error)
    app.exit(1)
  }
}

export async function runOcrSmoke(
  ctx: SmokeContext,
  mode: 'ocr' | 'translate' = 'ocr'
): Promise<void> {
  try {
    const fixture =
      process.env.OCR_SMOKE_FIXTURE ?? join('tests', 'fixtures', 'ocr-word.png')
    const imagePath = join(app.getAppPath(), fixture)
    const dataUrl = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`
    const result = await recognizeImageDataUrl(dataUrl)
    console.log('OCR_SMOKE_TEXT', result.text)
    const settings = ctx.settingsStore.get()
    ctx.ocrManager.open({
      text: result.text,
      lines: result.lines,
      mode,
      autoTranslate: false,
      settings: { ...settings, hasTranslationKey: ctx.secretStore.hasTranslationKey() },
      hasTranslationKey: ctx.secretStore.hasTranslationKey()
    })
  } catch (error) {
    console.error('OCR_SMOKE_ERROR', error)
    app.exit(1)
  }
}

export async function runOcrSoak(): Promise<void> {
  const rawCount = Number(process.env.PIXMINT_SOAK_OCR_ITERATIONS ?? 100)
  const count = Number.isFinite(rawCount) ? Math.min(1000, Math.max(1, Math.round(rawCount))) : 100
  const imagePath = join(app.getAppPath(), 'tests', 'fixtures', 'ocr-word.png')
  const dataUrl = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`
  const durations: number[] = []
  // PaddleOCR 首次加载模型是固定成本，不计入后续循环的泄漏预算。
  const warmupStarted = Date.now()
  try {
    await recognizeImageDataUrl(dataUrl)
  } catch (error) {
    console.error('SOAK_OCR_WARMUP_ERROR', error)
  }
  const warmupMs = Date.now() - warmupStarted
  console.log('SOAK_OCR_WARMUP_MS', warmupMs)
  const memoryBefore = process.memoryUsage()
  // 背景：OCR 已移入 utilityProcess，只统计主进程 RSS 会漏掉子进程增长。
  // 设计意图：在循环前后各抓一次全进程指标，压测脚本按总和判定预算。
  const metricsBefore = processMetrics()
  // ONNX 前若干次会扩展 arena，这是每个进程一次性的成本，不等于泄漏。
  // 单独抓一份"预热完成"的快照，压测用它计算稳态增长。
  const seasoning = Math.min(count, Number(process.env.PIXMINT_SOAK_OCR_SEASONING ?? 100))
  let metricsSeasoned: ReturnType<typeof processMetrics> | null = null
  let failures = 0
  for (let index = 0; index < count; index += 1) {
    const started = Date.now()
    try {
      const result = await recognizeImageDataUrl(dataUrl)
      if (!result.text.trim()) failures += 1
    } catch (error) {
      failures += 1
      console.error('SOAK_OCR_ITERATION_ERROR', index, error)
    }
    durations.push(Date.now() - started)
    if (index + 1 === seasoning) metricsSeasoned = processMetrics()
    if ((index + 1) % 10 === 0) {
      console.log('SOAK_OCR_PROGRESS', index + 1, count)
    }
  }
  const memoryAfter = process.memoryUsage()
  const processes = processMetrics()
  console.log(
    'SOAK_OCR_RESULT',
    JSON.stringify({
      iterations: count,
      warmupMs,
      failures,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      maxMs: durations.length ? Math.max(...durations) : 0,
      seasoning,
      memoryBefore,
      memoryAfter,
      metricsBefore,
      metricsSeasoned,
      metricsAfter: processes,
      processes
    })
  )
  app.exit(failures === 0 ? 0 : 1)
}

export function runPrepareSmoke(ctx: SmokeContext): void {
  const display = screen.getPrimaryDisplay()
  const info = {
    id: display.id,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor
  }
  const fake = {
    displayId: display.id,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor,
    imageDataUrl: FAKE_SCREEN_PNG,
    imageWidth: Math.round(display.bounds.width),
    imageHeight: Math.round(display.bounds.height)
  }
  ctx.overlayManager.prewarm([info])
  setTimeout(() => ctx.overlayManager.prepare(info), 900)
  setTimeout(() => {
    void ctx.overlayManager.start(fake)
  }, 2600)
}

function processMetrics(): Array<{
  type: string
  pid: number
  cpuPercent: number
  workingSetKb: number
  privateKb: number
}> {
  return app.getAppMetrics().map((metric) => ({
    type: metric.type,
    pid: metric.pid,
    cpuPercent: metric.cpu.percentCPUUsage,
    workingSetKb: metric.memory.workingSetSize,
    privateKb: metric.memory.privateBytes ?? 0
  }))
}

function percentile(values: number[], target: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((target / 100) * sorted.length) - 1)
  )
  return sorted[index]
}
