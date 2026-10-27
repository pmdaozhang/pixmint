import { app, screen } from 'electron'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  LongCaptureProgress,
  LongCaptureResult,
  Rect
} from '../shared/types'
import {
  framesAreSimilar,
  LongCaptureStitcher,
  matchVerticalOverlap,
  type FrameImage
} from '../shared/long-capture'
import { encodePng, frameFromDataUrl } from './long-capture/image'
import { ScrollDriver } from './long-capture/scroll-driver'
import type { ScrollTarget } from '../shared/scroll-target'
import { fastCapture } from './fast-capture'
import { logDiagnostic } from './diagnostics'

const MAX_HEIGHT = 30_000
const MAX_PIXELS = 30_000_000
const MAX_FRAMES = 80
const SETTLE_MS = 180
const STABLE_DELAY_MS = 70
const STABLE_ATTEMPTS = 6
const START_NOTCHES = 1
const MAX_NOTCHES = 12
const NO_MATCH_LIMIT = 3

export interface LongCaptureStartOptions {
  display: Electron.Display
  /** 相对显示器左上角的选区（DIP）。 */
  selection: Rect
  onProgress?: (progress: LongCaptureProgress) => void
  onComplete?: (result: LongCaptureResult) => void
  onError?: (message: string) => void
  onTarget?: (target: ScrollTarget) => void
  maxHeight?: number
  maxPixels?: number
  maxFrames?: number
  captureRect?: CaptureRectFn
}

type CaptureRectFn = (rect: Rect) => Promise<string | null>

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function mapScrollError(error?: string): string {
  switch (error) {
    case 'error:foreground':
      return '无法激活目标窗口，请先点击目标窗口再试'
    case 'error:sendinput':
      return '无法发送滚动事件'
    case 'error:cursor':
      return '无法移动鼠标到目标窗口'
    case 'error:window':
      return '目标窗口已关闭'
    default:
      return '滚动目标窗口失败'
  }
}

/**
 * 长截图主进程会话。
 *
 * 背景：滚动、逐帧采集、匹配和拼接必须串行，任何一步都不能和覆盖层/录制并发。
 * 设计意图：用单一会话状态机管理动画、暂停、完成、取消和临时文件。
 * 关键约束：调用前必须先隐藏覆盖层；进度 HUD 不得覆盖选区，否则会被截进长图。
 */
export class LongCaptureManager {
  private readonly driver: ScrollDriver
  private running = false
  private paused = false
  private cancelled = false
  private finishRequested = false
  private resumeWaiters: Array<() => void> = []
  private currentProgress: LongCaptureProgress = {
    phase: 'idle',
    screens: 0,
    height: 0
  }
  private result: LongCaptureResult | null = null
  private resultFilePath = ''
  private progressListener?: (progress: LongCaptureProgress) => void

  constructor(driver?: ScrollDriver) {
    this.driver = driver ?? new ScrollDriver()
  }

  getProgress(): LongCaptureProgress {
    return { ...this.currentProgress }
  }

  getResult(): LongCaptureResult | null {
    return this.result ? { ...this.result } : null
  }

  pause(): void {
    if (!this.running || this.paused) return
    this.paused = true
    this.setProgress({
      phase: 'paused',
      screens: this.currentProgress.screens,
      height: this.currentProgress.height,
      message: '长截图已暂停'
    })
  }

  resume(): void {
    if (!this.running || !this.paused) return
    this.paused = false
    const waiters = this.resumeWaiters.splice(0)
    for (const resolve of waiters) resolve()
  }

  finish(): void {
    if (!this.running) return
    this.finishRequested = true
    this.paused = false
    const waiters = this.resumeWaiters.splice(0)
    for (const resolve of waiters) resolve()
  }

  cancel(): void {
    if (!this.running) return
    this.cancelled = true
    this.paused = false
    const waiters = this.resumeWaiters.splice(0)
    for (const resolve of waiters) resolve()
  }

  dispose(): void {
    this.cancel()
    this.driver.dispose()
  }

  async start(options: LongCaptureStartOptions): Promise<LongCaptureResult | null> {
    if (this.running) throw new Error('长截图已在运行')
    if (options.selection.width < 120 || options.selection.height < 120) {
      throw new Error('长截图选区太小')
    }

    this.running = true
    this.paused = false
    this.cancelled = false
    this.finishRequested = false
    this.result = null
    this.resultFilePath = ''
    this.progressListener = options.onProgress
    this.currentProgress = { phase: 'preparing', screens: 0, height: 0 }

    const maxHeight = options.maxHeight ?? MAX_HEIGHT
    const maxPixels = options.maxPixels ?? MAX_PIXELS
    const maxFrames = options.maxFrames ?? MAX_FRAMES
    const captureRect =
      options.captureRect ?? ((rect: Rect) => fastCapture.capture(rect, 2000))
    const absolute = {
      x: options.display.bounds.x + options.selection.x,
      y: options.display.bounds.y + options.selection.y,
      width: options.selection.width,
      height: options.selection.height
    }
    const physical = screen.dipToScreenRect(null, absolute)
    const centerX = physical.x + physical.width / 2
    const centerY = physical.y + physical.height / 2
    await this.driver.warmUp()
    const cursor = await this.driver.getCursor()

    try {
      this.setProgress({
        phase: 'preparing',
        screens: 0,
        height: 0,
        message: '正在准备长截图'
      })

      const target = await this.driver.findTarget(centerX, centerY)
      if (!target) throw new Error('没有找到可滚动窗口，请确认选区落在窗口内容上')
      options.onTarget?.(target)

      const firstDataUrl = await captureRect(physical)
      if (!firstDataUrl) throw new Error('无法截取长截图选区')
      const first = frameFromDataUrl(firstDataUrl)

      let previous: FrameImage = first
      let stitcher: LongCaptureStitcher | null = null
      let headerHeight = 0
      let notches = START_NOTCHES
      let pixelsPerNotch = 0
      let screens = 1
      let noMatchCount = 0
      let limitReached = false
      let overlapLost = false

      for (let index = 0; index < maxFrames; index += 1) {
        await this.waitForResume()
        if (this.cancelled || this.finishRequested) break

        const currentHeight = stitcher?.currentHeight ?? first.height
        const scrollHeight = Math.max(1, previous.height - headerHeight)
        const targetOffset = Math.round(scrollHeight * 0.7)
        if (pixelsPerNotch > 0) {
          notches = clamp(
            Math.round(targetOffset / pixelsPerNotch),
            1,
            MAX_NOTCHES
          )
        }

        this.setProgress({
          phase: 'scrolling',
          screens,
          height: currentHeight,
          message: `正在滚动第 ${screens + 1} 屏`
        })
        const scroll = await this.driver.scroll(target, centerX, centerY, -notches)
        if (!scroll.ok) throw new Error(mapScrollError(scroll.error))

        await delay(SETTLE_MS)
        const still = await this.driver.findTarget(centerX, centerY)
        if (!still || still.hwnd !== target.hwnd) {
          throw new Error('目标窗口已切换，长截图已停止')
        }
        options.onTarget?.(still)

        this.setProgress({
          phase: 'capturing',
          screens,
          height: currentHeight,
          message: '正在截取下一屏'
        })
        const next = await this.captureStableFrame(captureRect, physical)
        if (!next) throw new Error('截取长截图帧失败')

        this.setProgress({
          phase: 'matching',
          screens,
          height: currentHeight,
          message: '正在匹配重叠区域'
        })
        const match = matchVerticalOverlap(previous, next, {
          headerHeight: stitcher ? headerHeight : undefined,
          expectedOffset: pixelsPerNotch > 0 ? targetOffset : undefined
        })

        if (!match) {
          noMatchCount += 1
          const unchanged = framesAreSimilar(previous, next, {
            stepX: 4,
            stepY: 2
          })
          if (unchanged) {
            notches = Math.min(MAX_NOTCHES, notches + 1)
          } else if (stitcher) {
            overlapLost = true
            break
          }
          if (noMatchCount >= NO_MATCH_LIMIT) {
            if (stitcher) {
              overlapLost = true
              break
            }
            throw new Error(
              unchanged
                ? '目标窗口没有滚动，请确认选区落在可滚动内容上'
                : '无法找到重叠区域，可能滚动过快'
            )
          }
          continue
        }

        if (!stitcher) {
          headerHeight = match.headerHeight
          stitcher = new LongCaptureStitcher({ maxHeight, maxPixels })
          stitcher.initialize(previous, headerHeight)
        }
        const appended = stitcher.append(next, match)
        if (appended.appended === 0) {
          limitReached = true
          break
        }
        if (appended.truncated) limitReached = true

        pixelsPerNotch = match.offset / Math.max(1, notches)
        previous = next
        screens += 1
        noMatchCount = 0

        this.setProgress({
          phase: 'capturing',
          screens,
          height: stitcher.currentHeight,
          message: limitReached
            ? '已达到长截图上限'
            : `已截取 ${screens} 屏`
        })
        logDiagnostic(
          'long-capture',
          `frame ${screens} offset=${match.offset} confidence=${match.confidence.toFixed(3)} header=${headerHeight}`
        )
        if (limitReached) break
      }

      if (this.cancelled) {
        this.cleanupResultFile()
        this.setProgress({
          phase: 'cancelled',
          screens: 0,
          height: 0,
          message: '长截图已取消'
        })
        return null
      }

      if (!stitcher) {
        stitcher = new LongCaptureStitcher({ maxHeight, maxPixels })
        stitcher.initialize(first, 0)
      }

      this.setProgress({
        phase: 'capturing',
        screens,
        height: stitcher.currentHeight,
        message: '正在编码长图'
      })
      const frame = stitcher.getFrame()
      const png = encodePng(frame)
      const filePath = join(
        app.getPath('temp'),
        `pixmint-long-${process.pid}-${Date.now()}.png`
      )
      writeFileSync(filePath, png)
      this.resultFilePath = filePath
      const result: LongCaptureResult = {
        width: frame.width,
        height: frame.height,
        bytes: png.length,
        filePath
      }
      this.result = result

      this.setProgress({
        phase: 'finished',
        screens,
        height: frame.height,
        message: overlapLost
          ? '长截图已停止，已保留当前结果'
          : limitReached
            ? '已达到长截图上限，已保留当前结果'
            : '长截图已完成'
      })
      try {
        options.onComplete?.(result)
      } catch {
        // 完成回调异常不应把成功结果改成失败
      }
      logDiagnostic(
        'long-capture',
        `finished ${frame.width}x${frame.height} screens=${screens} bytes=${png.length}`
      )
      return this.result
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error)
      logDiagnostic('long-capture', `failed: ${message}`, 'error')
      this.setProgress({
        phase: 'error',
        screens: this.currentProgress.screens,
        height: this.currentProgress.height,
        error: message,
        message
      })
      try {
        options.onError?.(message)
      } catch {
        // 错误回调异常不应覆盖原始错误
      }
      return null
    } finally {
      if (cursor) {
        await this.driver.restore(cursor.x, cursor.y).catch(() => undefined)
      }
      this.running = false
      this.paused = false
      this.finishRequested = false
      this.resumeWaiters = []
      this.progressListener = undefined
    }
  }

  private async waitForResume(): Promise<void> {
    if (!this.paused) return
    await new Promise<void>((resolve) => {
      this.resumeWaiters.push(resolve)
    })
  }

  /**
   * 背景：滚轮动画未结束时截帧会得到 268/289 之类的中间偏移，重复拼接。
   * 设计意图：连续两帧近似相同才认为滚动稳定；最多等待 6 轮，避免动画永远不停。
   * 关键约束：这是主进程串行调用，单帧等待不会阻塞其他窗口。
   */
  private async captureStableFrame(
    captureRect: CaptureRectFn,
    rect: Rect
  ): Promise<FrameImage | null> {
    let previous: FrameImage | null = null
    for (let attempt = 0; attempt < STABLE_ATTEMPTS; attempt += 1) {
      const dataUrl = await captureRect(rect)
      if (!dataUrl) return null
      const frame = frameFromDataUrl(dataUrl)
      if (
        previous &&
        framesAreSimilar(previous, frame, { stepX: 4, stepY: 2 })
      ) {
        return frame
      }
      previous = frame
      await delay(STABLE_DELAY_MS)
    }
    return previous
  }

  private setProgress(progress: LongCaptureProgress): void {
    this.currentProgress = { ...progress }
    try {
      this.progressListener?.(this.currentProgress)
    } catch {
      // 统计/日志回调失败不应影响会话
    }
  }

  private cleanupResultFile(): void {
    if (!this.resultFilePath) return
    try {
      if (existsSync(this.resultFilePath)) unlinkSync(this.resultFilePath)
    } catch {
      // 临时文件清理失败不应覆盖原始错误
    }
    this.resultFilePath = ''
  }
}

export const longCaptureManager = new LongCaptureManager()
