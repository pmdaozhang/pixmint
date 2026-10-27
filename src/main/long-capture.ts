import { app, clipboard, dialog, nativeImage, screen } from 'electron'
import { copyFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  LongCapturePreviewInfo,
  LongCaptureProgress,
  LongCaptureResult,
  Rect
} from '../shared/types'
import {
  cropFrameHorizontal,
  framesAreSimilar,
  LongCaptureStitcher,
  matchVerticalOverlap,
  type OverlapMatch,
  trimCaptureEdgeRow,
  type FrameImage
} from '../shared/long-capture'
import { encodePng, frameFromDataUrl } from './long-capture/image'
import { ScrollDriver } from './long-capture/scroll-driver'
import type { ScrollTarget } from '../shared/scroll-target'
import { fastCapture } from './fast-capture'
import { logDiagnostic } from './diagnostics'
import { notify } from './image-utils'

const MAX_HEIGHT = 30_000
const MAX_PIXELS = 30_000_000
const MAX_FRAMES = 80
const SETTLE_MS = 180
const STABLE_DELAY_MS = 70
const STABLE_ATTEMPTS = 6
const START_NOTCHES = 1
const MAX_NOTCHES = 12
const START_WHEEL_DELTA = START_NOTCHES * 120
const MIN_WHEEL_DELTA = 60
const MAX_WHEEL_DELTA = MAX_NOTCHES * 120
const MATCH_EDGE_MARGIN = 24
const MAX_UIA_STEPS = 40
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
 * 首屏滚动可能被应用放大（例如一次滚轮滚半页），默认 22% 重叠下限会直接判失败。
 * 首屏允许一次更宽松的 5% 重叠重试；后续帧仍用默认阈值，避免误匹配。
 */
function findOverlap(
  previous: FrameImage,
  next: FrameImage,
  headerHeight: number | undefined,
  expectedOffset: number | undefined,
  allowLoose: boolean
): OverlapMatch | null {
  const primary = matchVerticalOverlap(previous, next, {
    headerHeight,
    expectedOffset
  })
  if (primary || !allowLoose) return primary
  return matchVerticalOverlap(previous, next, {
    headerHeight,
    expectedOffset,
    minOverlapRatio: 0.05,
    confidenceThreshold: 0.72,
    verificationThreshold: 0.78
  })
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
  private savedFilePath = ''
  private lastEncodeMs = 0
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

  getLastEncodeMs(): number {
    return this.lastEncodeMs
  }

  getPreviewInfo(): LongCapturePreviewInfo | null {
    if (!this.result || !this.resultFilePath) return null
    return {
      ...this.result,
      filePath: this.resultFilePath,
      mediaUrl: `snapglass-media://local?path=${encodeURIComponent(this.resultFilePath)}`
    }
  }

  isAllowedFile(filePath: string): boolean {
    return filePath === this.resultFilePath || filePath === this.savedFilePath
  }

  async saveResult(): Promise<string | null> {
    if (!this.result || !this.resultFilePath) return null
    const result = await dialog.showSaveDialog({
      title: '保存长截图',
      defaultPath: join(
        app.getPath('pictures'),
        `Pixmint-long-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
      ),
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) return null
    if (result.filePath !== this.resultFilePath) {
      copyFileSync(this.resultFilePath, result.filePath)
    }
    this.savedFilePath = result.filePath
    notify(`已保存：${result.filePath}`)
    return result.filePath
  }

  copyResult(): string {
    if (!this.resultFilePath) throw new Error('没有可复制的长截图')
    const image = nativeImage.createFromPath(this.resultFilePath)
    if (image.isEmpty()) throw new Error('无法读取长截图')
    clipboard.writeImage(image)
    return '已复制长截图到剪贴板'
  }

  deleteResult(): void {
    if (this.resultFilePath) {
      try {
        if (
          this.resultFilePath !== this.savedFilePath &&
          existsSync(this.resultFilePath)
        ) {
          unlinkSync(this.resultFilePath)
        }
      } catch {
        // 临时文件清理失败不应阻断关闭流程
      }
    }
    this.resultFilePath = ''
    this.savedFilePath = ''
    this.result = null
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
    this.deleteResult()
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
      const first = trimCaptureEdgeRow(frameFromDataUrl(firstDataUrl))

      let previous: FrameImage = first
      let previousMatch = cropFrameHorizontal(first, MATCH_EDGE_MARGIN)
      let stitcher: LongCaptureStitcher | null = null
      let headerHeight = 0
      let wheelDelta = START_WHEEL_DELTA
      let pixelsPerWheelUnit = 0
      let scrollMode: 'wheel' | 'uia' = 'wheel'
      let pixelsPerUiaStep = 0
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
        this.setProgress({
          phase: 'scrolling',
          screens,
          height: currentHeight,
          message: `正在滚动第 ${screens + 1} 屏`
        })
        let appliedScrollSteps = 0
        let scrolled = false
        if (scrollMode === 'uia') {
          const steps =
            pixelsPerUiaStep > 0
              ? clamp(
                  Math.round(targetOffset / pixelsPerUiaStep),
                  1,
                  MAX_UIA_STEPS
                )
              : 1
          const uia = await this.driver.scrollUia(
            target,
            centerX,
            centerY,
            steps
          )
          if (uia.ok) {
            appliedScrollSteps = steps
            scrolled = true
          } else {
            scrollMode = 'wheel'
          }
        }
        if (!scrolled) {
          if (pixelsPerWheelUnit > 0) {
            wheelDelta = clamp(
              Math.round(targetOffset / pixelsPerWheelUnit),
              MIN_WHEEL_DELTA,
              MAX_WHEEL_DELTA
            )
          }
          const scroll = await this.driver.scrollDelta(
            target,
            centerX,
            centerY,
            -wheelDelta
          )
          if (!scroll.ok) throw new Error(mapScrollError(scroll.error))
          appliedScrollSteps = wheelDelta
        }

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
        let next = await this.captureStableFrame(captureRect, physical)
        if (!next) throw new Error('截取长截图帧失败')
        let nextMatch = cropFrameHorizontal(next, MATCH_EDGE_MARGIN)

        this.setProgress({
          phase: 'matching',
          screens,
          height: currentHeight,
          message: '正在匹配重叠区域'
        })
        let match = findOverlap(
          previousMatch,
          nextMatch,
          stitcher ? headerHeight : undefined,
          pixelsPerWheelUnit > 0 ? targetOffset : undefined,
          !stitcher
        )

        if (!match) {
          noMatchCount += 1
          const unchanged = framesAreSimilar(previousMatch, nextMatch, {
            stepX: 4,
            stepY: 2
          })
          if (unchanged) {
            wheelDelta = Math.min(MAX_WHEEL_DELTA, wheelDelta + 60)
          } else if (stitcher) {
            overlapLost = true
            break
          } else if (noMatchCount === 1) {
            // 首屏一次滚轮滚过选区大部分高度时，回滚到起点并用半格滚轮重试。
            const back = await this.driver.scrollDelta(
              target,
              centerX,
              centerY,
              wheelDelta
            )
            if (!back.ok) throw new Error(mapScrollError(back.error))
            await delay(SETTLE_MS)
            const backFrame = await this.captureStableFrame(captureRect, physical)
            if (
              !backFrame ||
              !framesAreSimilar(
                previousMatch,
                cropFrameHorizontal(backFrame, MATCH_EDGE_MARGIN),
                { stepX: 4, stepY: 2 }
              )
            ) {
              throw new Error(
                '滚动幅度过大且无法回到起点，请框选更高的区域后重试'
              )
            }
            // 优先用 UI Automation 的小步滚动；它不依赖滚轮 delta 的累积规则。
            const uia = await this.driver.scrollUia(
              target,
              centerX,
              centerY,
              1
            )
            let uiaMoved = false
            if (uia.ok) {
              await delay(SETTLE_MS)
              const uiaFrame = await this.captureStableFrame(captureRect, physical)
              if (uiaFrame) {
                const uiaMatchFrame = cropFrameHorizontal(
                  uiaFrame,
                  MATCH_EDGE_MARGIN
                )
                uiaMoved = !framesAreSimilar(previousMatch, uiaMatchFrame, {
                  stepX: 4,
                  stepY: 2
                })
                const uiaMatch = findOverlap(
                  previousMatch,
                  uiaMatchFrame,
                  undefined,
                  Math.round(scrollHeight * 0.08),
                  true
                )
                if (uiaMatch) {
                  scrollMode = 'uia'
                  pixelsPerUiaStep = uiaMatch.offset
                  appliedScrollSteps = 1
                  next = uiaFrame
                  nextMatch = uiaMatchFrame
                  match = uiaMatch
                  logDiagnostic(
                    'long-capture',
                    `first match retry uia offset=${uiaMatch.offset}`
                  )
                }
              }
            }
            if (!match) {
              if (uiaMoved) {
                throw new Error(
                  '滚动幅度过大，无法找到重叠区域；请框选更高的区域或关闭单页滚动后重试'
                )
              }
              wheelDelta = Math.max(
                MIN_WHEEL_DELTA,
                Math.round(wheelDelta / 2)
              )
              const half = await this.driver.scrollDelta(
                target,
                centerX,
                centerY,
                -wheelDelta
              )
              if (!half.ok) throw new Error(mapScrollError(half.error))
              await delay(SETTLE_MS)
              const retry = await this.captureStableFrame(captureRect, physical)
              if (!retry) throw new Error('截取长截图帧失败')
              const retryMatchFrame = cropFrameHorizontal(
                retry,
                MATCH_EDGE_MARGIN
              )
              const retryMatch = findOverlap(
                previousMatch,
                retryMatchFrame,
                undefined,
                Math.round(scrollHeight * 0.35),
                true
              )
              if (!retryMatch) {
                const halfMoved = !framesAreSimilar(
                  previousMatch,
                  retryMatchFrame,
                  { stepX: 4, stepY: 2 }
                )
                if (halfMoved) {
                  throw new Error(
                    '滚动幅度过大，无法找到重叠区域；请框选更高的区域或关闭单页滚动后重试'
                  )
                }
                const keys = await this.driver.scrollKeys(
                  target,
                  centerX,
                  centerY,
                  0x28
                )
                if (!keys.ok) throw new Error(mapScrollError(keys.error))
                await delay(SETTLE_MS)
                const keyFrame = await this.captureStableFrame(
                  captureRect,
                  physical
                )
                if (!keyFrame) throw new Error('截取长截图帧失败')
                const keyMatchFrame = cropFrameHorizontal(
                  keyFrame,
                  MATCH_EDGE_MARGIN
                )
                const keyMatch = findOverlap(
                  previousMatch,
                  keyMatchFrame,
                  undefined,
                  Math.round(scrollHeight * 0.3),
                  true
                )
                if (!keyMatch) {
                  throw new Error(
                    '滚动幅度过大，无法找到重叠区域；请框选更高的区域或关闭单页滚动后重试'
                  )
                }
                next = keyFrame
                nextMatch = keyMatchFrame
                match = keyMatch
                logDiagnostic(
                  'long-capture',
                  `first match retry keyscroll offset=${keyMatch.offset}`
                )
              } else {
                next = retry
                nextMatch = retryMatchFrame
                match = retryMatch
                appliedScrollSteps = wheelDelta
                logDiagnostic(
                  'long-capture',
                  `first match retry wheelDelta=${wheelDelta} offset=${retryMatch.offset}`
                )
              }
            }
          }
          if (!match && noMatchCount >= NO_MATCH_LIMIT) {
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
          if (!match) continue
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

        if (scrollMode === 'uia') {
          pixelsPerUiaStep = match.offset / Math.max(1, appliedScrollSteps)
        } else {
          pixelsPerWheelUnit = match.offset / Math.max(1, appliedScrollSteps)
        }
        previous = next
        previousMatch = nextMatch
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
      const encodeStarted = Date.now()
      const png = encodePng(frame)
      this.lastEncodeMs = Date.now() - encodeStarted
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
        `finished ${frame.width}x${frame.height} screens=${screens} bytes=${png.length} encode=${this.lastEncodeMs}ms`
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
      const frame = trimCaptureEdgeRow(frameFromDataUrl(dataUrl))
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
