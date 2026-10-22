import type {
  GifDoneMeta,
  OverlayInit,
  Rect,
  RecorderOptions,
  RecorderStatePatch,
  VideoDoneMeta
} from '@shared/types'
import {
  MAX_GIF_DURATION_MS,
  MAX_VIDEO_DURATION_MS,
  estimateVideoBitrate,
  fitGifOutputSize,
  fitOutputSize,
  gifFrameDelay,
  pickVideoMime
} from '@shared/recording'

export interface RecorderSessionCallbacks {
  onState(patch: RecorderStatePatch): void
  onGifDone(bytes: Uint8Array, meta: GifDoneMeta): void
  onVideoBegin(meta: VideoDoneMeta): Promise<void>
  onVideoChunk(chunk: ArrayBuffer): void
  onVideoDone(meta: VideoDoneMeta): void
  onError(message: string): void
}

interface WorkerDone {
  bytes: ArrayBuffer
  frameCount: number
}

function delayPromise(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/**
 * 背景：视频开始前必须先让主进程打开临时写入流，但 IPC/磁盘异常时 Promise 可能不返回。
 * 设计意图：给关键等待加超时，保证界面能回到可操作状态，而不是永远停在倒计时。
 * 关键约束：超时只负责拒绝 Promise，实际资源清理由调用方 dispose。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * 负责一次录制的采集、裁切、抽帧、编码和清理。
 * 覆盖层只负责交互和状态展示，避免把 MediaRecorder/Worker 细节塞进 React 组件。
 */
export class RecorderSession {
  private readonly init: OverlayInit
  private readonly selection: Rect
  private readonly options: RecorderOptions
  private readonly callbacks: RecorderSessionCallbacks

  private stream: MediaStream | null = null
  private combinedStream: MediaStream | null = null
  private audioStreams: MediaStream[] = []
  private video: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private videoTrack: CanvasCaptureMediaStreamTrack | null = null
  private worker: Worker | null = null
  private mediaRecorder: MediaRecorder | null = null
  private drawTimer: number | null = null
  private gifTimer: number | null = null
  private stateTimer: number | null = null
  private startedAt = 0
  private accumulatedMs = 0
  private paused = false
  private recording = false
  private stopping = false
  private cancelled = false
  private gifFramePending = false
  private lastGifFrameAt = 0
  private nextGifFrameAt = 0
  private workerError: Error | null = null
  private gifFirstFrameDataUrl = ''
  private chunkChain: Promise<void> = Promise.resolve()
  private videoMeta: VideoDoneMeta | null = null
  private gifDone: { resolve(value: WorkerDone): void; reject(error: Error): void } | null = null
  private systemAudioUnavailable = false
  private outputWidth = 2
  private outputHeight = 2

  constructor(
    init: OverlayInit,
    selection: Rect,
    options: RecorderOptions,
    callbacks: RecorderSessionCallbacks
  ) {
    this.init = init
    this.selection = selection
    this.options = options
    this.callbacks = callbacks
  }

  async prepare(sourceId: string): Promise<void> {
    const videoConstraints = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxFrameRate: Math.max(30, this.options.fps),
        maxWidth: Math.max(2, this.init.imageWidth),
        maxHeight: Math.max(2, this.init.imageHeight)
      }
    }
    const videoOnly = { audio: false, video: videoConstraints } as unknown as MediaStreamConstraints
    const wantsSystemAudio = this.options.mode === 'video' && this.options.systemAudio
    if (wantsSystemAudio) {
      try {
        // 系统音和视频必须一次 getUserMedia 取得；第二次桌面捕获会让渲染进程崩溃。
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          },
          video: videoConstraints
        } as unknown as MediaStreamConstraints)
        if (this.stream.getAudioTracks().length === 0) {
          this.systemAudioUnavailable = true
        }
      } catch (error) {
        console.warn('SYSTEM_AUDIO_CAPTURE_FAILED', error)
        this.systemAudioUnavailable = true
        this.stream = await navigator.mediaDevices.getUserMedia(videoOnly)
      }
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia(videoOnly)
    }
    if (this.cancelled) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
      throw new Error('录制已取消')
    }
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.style.cssText =
      'position:fixed;left:-10000px;top:-10000px;width:2px;height:2px;opacity:0;pointer-events:none'
    const metadata = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('屏幕画面加载超时')), 6000)
      video.onloadedmetadata = (): void => {
        window.clearTimeout(timer)
        resolve()
      }
      video.onerror = (): void => {
        window.clearTimeout(timer)
        reject(new Error('无法读取屏幕画面，请检查屏幕录制权限'))
      }
    })
    video.srcObject = this.stream
    document.body.appendChild(video)
    this.video = video
    await metadata
    if (this.cancelled) throw new Error('录制已取消')
    await video.play()
    if (this.cancelled) throw new Error('录制已取消')

    const scaleX = video.videoWidth / this.init.bounds.width
    const scaleY = video.videoHeight / this.init.bounds.height
    const physicalWidth = Math.max(2, Math.round(this.selection.width * scaleX))
    const physicalHeight = Math.max(2, Math.round(this.selection.height * scaleY))
    const output =
      this.options.mode === 'gif'
        ? fitGifOutputSize(physicalWidth, physicalHeight)
        : fitOutputSize(physicalWidth, physicalHeight, this.options.size)
    this.outputWidth = output.width
    this.outputHeight = output.height
    console.log('RECORDER_PREPARE', {
      selection: `${Math.round(this.selection.width)}x${Math.round(this.selection.height)}`,
      physical: `${physicalWidth}x${physicalHeight}`,
      output: `${this.outputWidth}x${this.outputHeight}`,
      dpr: window.devicePixelRatio,
      mode: this.options.mode
    })

    const canvas = document.createElement('canvas')
    canvas.width = this.outputWidth
    canvas.height = this.outputHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: this.options.mode === 'gif' })
    if (!ctx) throw new Error('无法创建录制画布')
    this.canvas = canvas
    this.ctx = ctx
    this.drawFrame()

    if (this.options.mode === 'video') {
      await this.prepareVideoRecorder()
    }
  }

  async start(): Promise<void> {
    if (this.recording) return
    this.recording = true
    this.paused = false
    this.startedAt = performance.now()
    this.accumulatedMs = 0
    console.log('RECORDER_START_BEGIN', this.options.mode)
    // 等待采集流交付第一帧新画面，避免 GIF 首帧仍是倒计时期间的冻结截图。
    await this.waitForFreshFrame()
    if (this.cancelled) return
    console.log('RECORDER_FRESH_FRAME', this.options.mode)

    if (this.options.mode === 'gif') {
      this.workerError = null
      this.lastGifFrameAt = 0
      this.drawFrame()
      this.gifFirstFrameDataUrl = this.canvas?.toDataURL('image/png') ?? ''
      this.worker = new Worker(new URL('./gif-worker.ts', import.meta.url), {
        type: 'module'
      })
      this.worker.onmessage = (event: MessageEvent): void => {
        const message = event.data as
          | { type: 'ready' }
          | { type: 'frame'; frameCount: number }
          | { type: 'done'; bytes: ArrayBuffer; frameCount: number }
          | { type: 'error'; message: string }
        if (message.type === 'frame') {
          this.gifFramePending = false
          // 编码完成后立刻排下一帧，避免“固定定时器 + 编码时间”串行导致低帧率。
          this.scheduleGifFrame()
          return
        }
        if (message.type === 'done') {
          this.gifDone?.resolve({ bytes: message.bytes, frameCount: message.frameCount })
          this.gifDone = null
          return
        }
        if (message.type === 'error') {
          const error = new Error(message.message)
          this.workerError = error
          this.gifDone?.reject(error)
          this.gifDone = null
        }
      }
      this.worker.postMessage({
        type: 'init',
        width: this.outputWidth,
        height: this.outputHeight,
        fps: this.options.fps
      })
    } else {
      if (!this.videoMeta || !this.mediaRecorder) throw new Error('视频录制器尚未准备好')
      await withTimeout(
        this.callbacks.onVideoBegin(this.videoMeta),
        5_000,
        '视频写入初始化超时，请重试'
      )
      console.log('RECORDER_VIDEO_STREAM_READY')
      this.mediaRecorder.start(1000)
      console.log('RECORDER_MEDIA_STARTED', this.mediaRecorder.state)
      this.videoTrack?.requestFrame()
    }

    if (this.options.mode === 'video') {
      this.drawTimer = window.setInterval(() => {
        if (this.paused) return
        this.drawFrame()
        // 静止画面下 captureStream 可能不再产出帧，手动 requestFrame 保证视频轨持续。
        this.videoTrack?.requestFrame()
      }, 1000 / 30)
    } else {
      this.nextGifFrameAt = performance.now()
      this.scheduleGifFrame()
    }

    this.stateTimer = window.setInterval(() => this.tick(), 100)
    this.callbacks.onState({
      phase: 'recording',
      elapsedMs: 0,
      width: this.outputWidth,
      height: this.outputHeight
    })
    console.log('RECORDER_STATE_RECORDING_SENT', this.options.mode)
  }

  pause(): void {
    if (this.options.mode !== 'video' || !this.recording || this.paused) return
    this.accumulatedMs += performance.now() - this.startedAt
    this.paused = true
    this.mediaRecorder?.pause()
    this.callbacks.onState({ phase: 'paused', elapsedMs: this.elapsedMs() })
  }

  resume(): void {
    if (this.options.mode !== 'video' || !this.recording || !this.paused) return
    this.paused = false
    this.startedAt = performance.now()
    this.mediaRecorder?.resume()
    this.callbacks.onState({ phase: 'recording', elapsedMs: this.elapsedMs() })
  }

  async stop(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    const elapsed = this.elapsedMs()
    this.recording = false
    this.clearTimers()
    this.callbacks.onState({ phase: 'encoding', elapsedMs: elapsed })

    try {
      if (this.options.mode === 'gif') {
        const done = await this.finishGif()
        this.callbacks.onGifDone(new Uint8Array(done.bytes), {
          width: this.outputWidth,
          height: this.outputHeight,
          fps: this.options.fps,
          durationMs: elapsed,
          frameCount: done.frameCount,
          firstFrameDataUrl: this.gifFirstFrameDataUrl
        })
      } else {
        await this.finishVideo(elapsed)
      }
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error.message : String(error))
    } finally {
      this.disposeMedia()
    }
  }

  cancel(): void {
    this.cancelled = true
    this.recording = false
    this.clearTimers()
    this.gifDone?.reject(new Error('录制已取消'))
    this.gifDone = null
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop()
      } catch {
        // ignore
      }
    }
    this.disposeMedia()
  }

  dispose(): void {
    this.cancelled = true
    this.recording = false
    this.clearTimers()
    this.disposeMedia()
  }

  elapsedMs(): number {
    if (!this.recording) return Math.round(this.accumulatedMs)
    const running = this.paused ? 0 : performance.now() - this.startedAt
    return Math.round(this.accumulatedMs + running)
  }

  private tick(): void {
    if (!this.recording) return
    const elapsed = this.elapsedMs()
    this.callbacks.onState({ elapsedMs: elapsed })
    const max = this.options.mode === 'gif' ? MAX_GIF_DURATION_MS : MAX_VIDEO_DURATION_MS
    if (elapsed >= max) {
      this.callbacks.onState({
        message: this.options.mode === 'gif' ? '已达 1 分钟上限' : '已达 10 分钟上限'
      })
      void this.stop()
    }
  }

  /**
   * 背景：屏幕采集流在 start 时可能还停留在倒计时/冻结画面。
   * 设计意图：等待一次新的 video 帧再绘制首帧，保证 GIF 和视频从实时画面开始。
   * 关键约束：最多等待 250ms，旧版 Chromium 没有 requestVideoFrameCallback 时直接超时放行。
   */
  private async waitForFreshFrame(): Promise<void> {
    const video = this.video
    if (!video) return
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      const candidate = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: () => void) => number
      }
      if (candidate.requestVideoFrameCallback) {
        candidate.requestVideoFrameCallback(finish)
      }
      window.setTimeout(finish, 250)
    })
    this.drawFrame()
  }

  private drawFrame(): void {
    if (!this.ctx || !this.video || this.video.readyState < 2) return
    const scaleX = this.video.videoWidth / this.init.bounds.width
    const scaleY = this.video.videoHeight / this.init.bounds.height
    this.ctx.drawImage(
      this.video,
      this.selection.x * scaleX,
      this.selection.y * scaleY,
      this.selection.width * scaleX,
      this.selection.height * scaleY,
      0,
      0,
      this.outputWidth,
      this.outputHeight
    )
  }

  private pushGifFrame(): void {
    if (!this.worker || !this.ctx || this.gifFramePending) return
    const now = performance.now()
    const delay = gifFrameDelay(now, this.lastGifFrameAt, 1000 / this.options.fps)
    this.lastGifFrameAt = now
    const image = this.ctx.getImageData(0, 0, this.outputWidth, this.outputHeight)
    const buffer = image.data.buffer
    this.gifFramePending = true
    this.worker.postMessage(
      { type: 'frame', data: buffer, delay },
      [buffer]
    )
  }

  /**
   * 背景：固定 setInterval 会在编码未完成时跳过帧，编码完成后又要等下一次 tick，
   * 实际帧率被“采集间隔 + 编码时间”叠加拖慢。
   * 设计意图：用自调度 setTimeout，按目标帧间隔排下一帧；编码完成后立即续排，
   * 让实际帧率尽量接近 15 FPS，同时保留真实时间 delay。
   * 关键约束：同一时间只允许一个待编码帧；停止/取消时必须清掉 gifTimer。
   */
  private scheduleGifFrame(): void {
    if (this.gifTimer !== null || !this.recording || this.paused) return
    const interval = 1000 / this.options.fps
    if (this.nextGifFrameAt <= 0) this.nextGifFrameAt = performance.now()
    const delay = Math.max(0, this.nextGifFrameAt - performance.now())
    this.gifTimer = window.setTimeout(() => {
      this.gifTimer = null
      if (!this.recording || this.paused) return
      if (this.gifFramePending) return
      const now = performance.now()
      this.drawFrame()
      this.pushGifFrame()
      this.nextGifFrameAt += interval
      // 编码长时间落后时不要无限追赶，直接以当前时间为新起点。
      if (this.nextGifFrameAt < now - interval * 4) this.nextGifFrameAt = now
      if (!this.gifFramePending) this.scheduleGifFrame()
    }, delay)
  }

  private finishGif(): Promise<WorkerDone> {
    if (!this.worker) return Promise.reject(new Error('GIF 编码器未启动'))
    if (this.workerError) return Promise.reject(this.workerError)
    return new Promise<WorkerDone>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.gifDone = null
        reject(new Error('GIF 编码超时'))
      }, 30_000)
      this.gifDone = {
        resolve: (value) => {
          window.clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          window.clearTimeout(timer)
          reject(error)
        }
      }
      this.worker?.postMessage({ type: 'finish' })
    })
  }

  private async prepareVideoRecorder(): Promise<void> {
    if (!this.canvas) throw new Error('录制画布未准备好')
    const mime = pickVideoMime((candidate) => MediaRecorder.isTypeSupported(candidate))
    if (!mime) throw new Error('当前系统不支持视频录制编码')

    const audioTracks: MediaStreamTrack[] = []
    const notes: string[] = []
    if (this.options.mic) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false
        })
        this.audioStreams.push(mic)
        audioTracks.push(...mic.getAudioTracks())
      } catch {
        notes.push('麦克风不可用')
      }
    }
    if (this.options.systemAudio) {
      const systemTracks = this.stream?.getAudioTracks() ?? []
      if (systemTracks.length > 0 && !this.systemAudioUnavailable) {
        audioTracks.push(...systemTracks)
      } else {
        notes.push('系统音不可用')
      }
    }

    // 离屏 canvas 在长时间 captureStream 时可能停止出帧；挂到 DOM 并保持极低可见度。
    this.canvas.style.cssText =
      'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1'
    document.body.appendChild(this.canvas)
    const canvasStream = this.canvas.captureStream(0)
    const videoTrack = canvasStream.getVideoTracks()[0]
    this.videoTrack = videoTrack as CanvasCaptureMediaStreamTrack
    this.combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioTracks
    ])
    const hasAudio = audioTracks.length > 0
    this.videoMeta = {
      mimeType: mime.mimeType,
      extension: mime.extension,
      width: this.outputWidth,
      height: this.outputHeight,
      fps: 30,
      durationMs: 0,
      mic: this.options.mic,
      systemAudio: this.options.systemAudio,
      hasAudio,
      note: notes.length ? notes.join('；') : undefined
    }
    const recorder = new MediaRecorder(this.combinedStream, {
      mimeType: mime.mimeType,
      videoBitsPerSecond: estimateVideoBitrate(this.outputWidth, this.outputHeight, 30),
      audioBitsPerSecond: 128_000
    })
    console.log('RECORDER_MEDIA', {
      mimeType: mime.mimeType,
      output: `${this.outputWidth}x${this.outputHeight}`,
      bitrate: estimateVideoBitrate(this.outputWidth, this.outputHeight, 30),
      hasAudio
    })
    recorder.ondataavailable = (event: BlobEvent): void => {
      if (!event.data.size || this.cancelled) return
      this.chunkChain = this.chunkChain.then(async () => {
        if (this.cancelled) return
        const chunk = await event.data.arrayBuffer()
        if (!this.cancelled) this.callbacks.onVideoChunk(chunk)
      })
    }
    recorder.onerror = (event): void => {
      console.error('RECORDER_MEDIA_ERROR', event)
      this.callbacks.onError('视频录制失败')
    }
    this.mediaRecorder = recorder
  }

  private async finishVideo(elapsed: number): Promise<void> {
    const recorder = this.mediaRecorder
    if (!recorder) throw new Error('视频录制器未启动')
    await new Promise<void>((resolve) => {
      if (recorder.state === 'inactive') {
        resolve()
        return
      }
      recorder.addEventListener('stop', () => resolve(), { once: true })
      recorder.stop()
    })
    await this.chunkChain
    await delayPromise(30)
    if (!this.videoMeta) throw new Error('视频元数据缺失')
    this.callbacks.onVideoDone({ ...this.videoMeta, durationMs: elapsed })
  }

  private clearTimers(): void {
    if (this.drawTimer !== null) {
      window.clearInterval(this.drawTimer)
      this.drawTimer = null
    }
    if (this.gifTimer !== null) {
      window.clearTimeout(this.gifTimer)
      this.gifTimer = null
    }
    if (this.stateTimer !== null) {
      window.clearInterval(this.stateTimer)
      this.stateTimer = null
    }
  }

  private disposeMedia(): void {
    this.clearTimers()
    this.worker?.terminate()
    this.worker = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.combinedStream?.getTracks().forEach((track) => track.stop())
    this.combinedStream = null
    for (const audio of this.audioStreams) {
      audio.getTracks().forEach((track) => track.stop())
    }
    this.audioStreams = []
    if (this.video) {
      this.video.pause()
      this.video.srcObject = null
      this.video.remove()
      this.video = null
    }
    if (this.canvas?.parentNode) this.canvas.parentNode.removeChild(this.canvas)
    this.canvas = null
    this.ctx = null
    this.videoTrack = null
    this.mediaRecorder = null
    this.lastGifFrameAt = 0
    this.nextGifFrameAt = 0
  }
}
