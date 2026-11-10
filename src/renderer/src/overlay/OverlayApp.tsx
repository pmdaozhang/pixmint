import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type {
  OverlayAction,
  OverlayInit,
  RecorderMode,
  RecorderOptions,
  Settings
} from '@shared/types'
import { AnnotationCanvas, type AnnotationCanvasHandle } from './AnnotationCanvas'
import { DimAround } from './DimAround'
import { RecorderBar } from './RecorderBar'
import { RecorderSession } from './RecorderSession'
import { RESIZE_DIRS } from './selection-geometry'
import { Toolbar } from './Toolbar'
import { t } from '@shared/i18n'
import { useOverlayImageSession } from './useOverlayImageSession'
import { useOverlayKeyboard } from './useOverlayKeyboard'
import { useOverlaySelection } from './useOverlaySelection'
import { useWindowSnapQuery } from './useWindowSnapQuery'
import './overlay.css'

type RecordPhase =
  | 'idle'
  | 'preparing'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'encoding'
  | 'result'
const DEFAULT_RECORDER_OPTIONS: RecorderOptions = {
  mode: 'gif',
  fps: 15,
  size: 'original',
  countdown: 3,
  mic: true,
  systemAudio: false
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer = 0
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer))
}

export function OverlayApp(): JSX.Element {
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  // 首次框选前就按接近实际宽度定位，避免量宽前把工具条推到屏幕外造成“延迟出现”。
  const [toolbarWidth, setToolbarWidth] = useState(740)
  const [recorderMode, setRecorderMode] = useState<RecorderMode | null>(null)
  const [recorderOptions, setRecorderOptions] =
    useState<RecorderOptions>(DEFAULT_RECORDER_OPTIONS)
  const [recordPhase, setRecordPhase] = useState<RecordPhase>('idle')
  const [countdownNumber, setCountdownNumber] = useState(0)
  // 倒计时结束后先撤掉冻结截图，等合成器提交两帧再真正开录，避免首帧录进截图界面。
  const [captureClean, setCaptureClean] = useState(false)
  const {
    init,
    imageReady,
    canvasRef: imageCanvasRef,
    load: loadSessionImage,
    clear: clearSessionImage
  } = useOverlayImageSession()
  const { hoverRect, querySnap, cancelSnap } = useWindowSnapQuery(init)
  const annotationRef = useRef<AnnotationCanvasHandle | null>(null)
  const brushCursorRef = useRef<HTMLDivElement | null>(null)
  const exportCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const sessionRef = useRef<RecorderSession | null>(null)
  const recorderModeRef = useRef<RecorderMode | null>(null)
  const recordPhaseRef = useRef<RecordPhase>('idle')
  const recorderOptionsRef = useRef<RecorderOptions>(DEFAULT_RECORDER_OPTIONS)
  const pendingRecordModeRef = useRef<RecorderMode | null>(null)
  const recordCancelledRef = useRef(false)
  const autoCopiedRef = useRef(false)
  // 诊断：记录最后一次 pointerup 时间，用于量“松手 → 工具栏首帧”的耗时。
  const lastPointerUpAtRef = useRef(0)

  const {
    selection,
    phase,
    options,
    submenuOpen,
    canUndo,
    canRedo,
    selectionDragging,
    selectionRef,
    resetSelection,
    setOptions,
    onSelectDown,
    onSelectMove,
    onSelectUp,
    startResize,
    onToolClick,
    onTextInputStart,
    onHistoryChange,
    closeSubmenu,
    isDragging
  } = useOverlaySelection({
    annotationRef,
    brushCursorRef,
    hoverRect,
    querySnap,
    cancelSnap
  })

  const resetRecorderState = useCallback(() => {
    sessionRef.current?.dispose()
    sessionRef.current = null
    recordCancelledRef.current = false
    setRecorderMode(null)
    setRecordPhase('idle')
    recordPhaseRef.current = 'idle'
    setCountdownNumber(0)
    setCaptureClean(false)
  }, [])

  useEffect(() => {
    recorderModeRef.current = recorderMode
  }, [recorderMode])

  useEffect(() => {
    recordPhaseRef.current = recordPhase
  }, [recordPhase])

  useEffect(() => {
    recorderOptionsRef.current = recorderOptions
  }, [recorderOptions])

  const resetUiForInit = useCallback((data: OverlayInit) => {
    resetSelection()
    cancelSnap()
    resetRecorderState()
    pendingRecordModeRef.current = data.pendingRecorderMode ?? null
    autoCopiedRef.current = false
    setToast('')
    setError('')
    const media = window.matchMedia('(prefers-color-scheme: dark)').matches
    const theme =
      data.settings.theme === 'system' ? (media ? 'dark' : 'light') : data.settings.theme
    document.documentElement.dataset.theme = theme
  }, [cancelSnap, resetRecorderState, resetSelection])

  // 主进程在新会话里会紧接着发送 overlay:init；窗口显示时的可见性回调
  // 不能抢先再加载一次图片，否则同一次 F1 会解码两遍 PNG。
  const awaitingInitRef = useRef(false)

  const applyInit = useCallback(
    (data: OverlayInit) => {
      awaitingInitRef.current = false
      loadSessionImage(data, () => resetUiForInit(data))
    },
    [loadSessionImage, resetUiForInit]
  )

  const resetUiForPrepare = useCallback((settings: Settings) => {
    resetSelection()
    cancelSnap()
    resetRecorderState()
    pendingRecordModeRef.current = null
    setToast('')
    setError('')
    autoCopiedRef.current = false
    const media = window.matchMedia('(prefers-color-scheme: dark)').matches
    const theme =
      settings.theme === 'system' ? (media ? 'dark' : 'light') : settings.theme
    document.documentElement.dataset.theme = theme
  }, [cancelSnap, resetRecorderState, resetSelection])

  const applyPrepare = useCallback(
    (settings: Settings) => {
      // 紧接着会收到 overlay:init，先标记住，避免窗口显示时重复加载。
      awaitingInitRef.current = true
      // 截图期间窗口是隐藏的，这里只重置状态，不再进入“准备中”遮罩。
      clearSessionImage(() => resetUiForPrepare(settings), false)
    },
    [clearSessionImage, resetUiForPrepare]
  )

  const resetUiForReset = useCallback(() => {
    resetSelection()
    cancelSnap()
    resetRecorderState()
    pendingRecordModeRef.current = null
    setToast('')
    setError('')
    autoCopiedRef.current = false
  }, [cancelSnap, resetRecorderState, resetSelection])

  const applyReset = useCallback(() => {
    awaitingInitRef.current = false
    clearSessionImage(resetUiForReset, false)
  }, [clearSessionImage, resetUiForReset])

  useEffect(() => {
    const off = window.snapglass.overlay.onInit(applyInit)
    const offPrepare = window.snapglass.overlay.onPrepare(applyPrepare)
    const offReset = window.snapglass.overlay.onReset(applyReset)
    window.snapglass.overlay.rendererReady()
    window.snapglass.overlay
      .ready()
      .then((data) => {
        if (data) applyInit(data)
      })
      .catch((reason: unknown) => setError(String(reason)))
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      // 主进程刚 prepare 过，init 马上就到；这里重复加载会多解码一次 PNG。
      if (awaitingInitRef.current) return
      // 录制期间控制条会抢焦点，不能让覆盖层重新初始化并丢掉选区。
      if (recorderModeRef.current) return
      if (selectionRef.current) return
      void window.snapglass.overlay.ready().then((data) => {
        if (data) applyInit(data)
      })
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      off()
      offPrepare()
      offReset()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [applyInit, applyPrepare, applyReset])

  useEffect(() => {
    if (!init || !imageReady) return
    let first = 0
    let second = 0
    const prepareStartedAt = performance.now()
    // 等两帧，确保新截图已经真正绘制到窗口 surface 上再通知主进程显示。
    first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        const paintMs = performance.now() - prepareStartedAt
        if (paintMs > 300) {
          console.warn('OVERLAY_PREPARED_SLOW', Math.round(paintMs))
        }
        window.snapglass.overlay.prepared()
      })
    })
    return () => {
      window.cancelAnimationFrame(first)
      window.cancelAnimationFrame(second)
    }
  }, [init, imageReady])

  /**
   * 背景：全屏透明覆盖层如果渲染线程卡住，会继续拦截鼠标，桌面看起来像死机。
   * 设计意图：用主进程看门狗检测心跳，超时后强制鼠标穿透并隐藏覆盖层。
   * 关键约束：心跳必须短小且不依赖任何重型绘制；渲染线程被同步任务堵住时会自然停跳。
   */
  useEffect(() => {
    if (!init) return
    const sendHeartbeat = (): void => window.snapglass.overlay.heartbeat()
    sendHeartbeat()
    const timer = window.setInterval(sendHeartbeat, 500)
    return () => window.clearInterval(timer)
  }, [init])

  useEffect(() => {
    if (!init || recorderMode) return
    const measure = (): void => {
      const dock = document.querySelector('.tooldock')
      const width = dock?.getBoundingClientRect().width ?? 0
      if (width > 0) setToolbarWidth(width)
    }
    measure()
    const dock = document.querySelector('.tooldock')
    if (!dock) return
    const observer = new ResizeObserver(measure)
    observer.observe(dock)
    return () => observer.disconnect()
  }, [init, recorderMode, submenuOpen])

  // 诊断：渲染线程长任务。覆盖层窗口常驻，从挂载起全程监听；
  // >300ms 的长任务会同时拖慢遮罩出现和工具栏绘制。
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 300) {
            console.warn('OVERLAY_LONGTASK', Math.round(entry.duration), entry.name)
          }
        }
      })
      observer.observe({ entryTypes: ['longtask'] })
      return () => observer.disconnect()
    } catch {
      return undefined
    }
  }, [])

  // 诊断：框选松手 → 工具栏首帧真正绘制的耗时。正常应在百毫秒内；
  // 若超过 300ms，说明渲染线程被长任务/GC 堵住或合成器出问题。
  useEffect(() => {
    const onUp = (): void => {
      lastPointerUpAtRef.current = performance.now()
    }
    window.addEventListener('pointerup', onUp, true)
    return () => window.removeEventListener('pointerup', onUp, true)
  }, [])

  useEffect(() => {
    if (phase !== 'editing') return
    const upAt = lastPointerUpAtRef.current
    if (!upAt) return
    let first = 0
    let second = 0
    first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        const paintMs = performance.now() - upAt
        if (paintMs > 300) {
          console.warn('OVERLAY_TOOLBAR_PAINT_SLOW', Math.round(paintMs))
        }
      })
    })
    return () => {
      window.cancelAnimationFrame(first)
      window.cancelAnimationFrame(second)
    }
  }, [phase])

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 1800)
  }, [])

  const openRecorder = useCallback((mode: RecorderMode) => {
    setRecorderMode(mode)
    setRecordPhase('idle')
    recordPhaseRef.current = 'idle'
    setCountdownNumber(0)
    setCaptureClean(false)
    setRecorderOptions((previous) => ({
      ...previous,
      mode,
      fps: mode === 'video' ? 30 : 15,
      size: 'original',
      countdown: 3,
      mic: mode === 'video' ? true : previous.mic,
      systemAudio: mode === 'video' ? false : previous.systemAudio
    }))
    closeSubmenu()
  }, [closeSubmenu])

  const cancelRecording = useCallback(() => {
    recordCancelledRef.current = true
    sessionRef.current?.cancel()
    sessionRef.current = null
    setRecorderMode(null)
    setRecordPhase('idle')
    recordPhaseRef.current = 'idle'
    setCountdownNumber(0)
    setCaptureClean(false)
    window.snapglass.recorder.dismiss()
  }, [])

  const retryRecording = useCallback(() => {
    sessionRef.current?.dispose()
    sessionRef.current = null
    recordCancelledRef.current = false
    setRecordPhase('idle')
    recordPhaseRef.current = 'idle'
    setCountdownNumber(0)
    setCaptureClean(false)
    if (!recorderModeRef.current) setRecorderMode('gif')
  }, [])

  const startRecording = useCallback(async () => {
    const mode = recorderModeRef.current
    if (!mode || !init || !selection || recordPhaseRef.current !== 'idle') {
      console.warn(
        'RECORDER_START_IGNORED',
        `mode=${String(mode)} init=${Boolean(init)} selection=${Boolean(selection)} phase=${recordPhaseRef.current}`
      )
      return
    }
    if (selection.width < 64 || selection.height < 64) {
      showToast(t(init?.settings?.language, '选区太小，至少需要 64 × 64'))
      return
    }
    const options: RecorderOptions = {
      ...recorderOptionsRef.current,
      mode,
      fps: mode === 'video' ? 30 : recorderOptionsRef.current.fps,
      size: 'original',
      countdown: 3
    }
    recordCancelledRef.current = false
    setCaptureClean(false)
    setRecordPhase('preparing')
    recordPhaseRef.current = 'preparing'
    try {
      const beginResult = await withTimeout(
        window.snapglass.recorder.begin({
          mode,
          displayId: init.displayId,
          selection,
          options
        }),
        9_000,
        t(init?.settings?.language, '录制初始化超时，请重试')
      )
      if (beginResult.denied) {
        // 主进程已隐藏覆盖层并打开购买窗，这里只收尾本地状态
        setRecordPhase('idle')
        recordPhaseRef.current = 'idle'
        setCountdownNumber(0)
        return
      }
      const { sourceId } = beginResult
      if (recordCancelledRef.current) return

      const session = new RecorderSession(init, selection, options, {
        language: init.settings.language,
        onState: (patch) => {
          window.snapglass.recorder.state(patch)
          if (patch.message) showToast(patch.message)
          if (patch.phase) {
            setRecordPhase(patch.phase)
            recordPhaseRef.current = patch.phase
            if (
              patch.phase === 'recording' ||
              patch.phase === 'paused' ||
              patch.phase === 'encoding'
            ) {
              setCaptureClean(true)
              setCountdownNumber(0)
            }
          }
        },
        onGifDone: (bytes, meta) => {
          window.snapglass.recorder.gifDone(bytes, meta)
          setRecordPhase('result')
        },
        onVideoBegin: (meta) => window.snapglass.recorder.videoBegin(meta),
        onVideoChunk: (chunk) => window.snapglass.recorder.videoChunk(chunk),
        onVideoDone: (meta) => {
          window.snapglass.recorder.videoDone(meta)
          setRecordPhase('result')
        },
        onError: (message) => {
          window.snapglass.recorder.videoFailed(message)
          setRecordPhase('idle')
          recordPhaseRef.current = 'idle'
          setCountdownNumber(0)
          setCaptureClean(false)
          showToast(message)
        }
      })
      sessionRef.current = session
      await withTimeout(session.prepare(sourceId), 9_000, t(init?.settings?.language, '录制初始化超时，请重试'))
      if (recordCancelledRef.current) return

      setRecordPhase('countdown')
      recordPhaseRef.current = 'countdown'
      window.snapglass.recorder.state({
        phase: 'countdown',
        elapsedMs: 0,
        message: t(init?.settings?.language, '3 秒后开始')
      })
      for (let remain = 3; remain > 0; remain -= 1) {
        if (recordCancelledRef.current) return
        setCountdownNumber(remain)
        await wait(700)
      }
      if (recordCancelledRef.current) return
      setCountdownNumber(0)
      // 两帧等待让透明覆盖层先完成一次合成，再开始采集第一帧。
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
      })
      if (recordCancelledRef.current) return
      await session.start()
    } catch (error) {
      if (recordCancelledRef.current) return
      const message = error instanceof Error ? error.message : String(error)
      sessionRef.current?.dispose()
      sessionRef.current = null
      recordCancelledRef.current = true
      setCaptureClean(false)
      setRecordPhase('idle')
      recordPhaseRef.current = 'idle'
      window.snapglass.recorder.videoFailed(message)
      showToast(message)
    }
  }, [init, selection, showToast])

  useEffect(() => {
    if (phase !== 'editing' || !selection) return
    const pending = pendingRecordModeRef.current
    if (!pending) return
    pendingRecordModeRef.current = null
    openRecorder(pending)
  }, [phase, selection, openRecorder])

  useEffect(() => {
    return window.snapglass.recorder.onCommand((command) => {
      if (command.type === 'stop') {
        if (recordPhaseRef.current === 'recording' || recordPhaseRef.current === 'paused') {
          void sessionRef.current?.stop()
        }
        return
      }
      if (command.type === 'cancel') {
        cancelRecording()
        return
      }
      if (command.type === 'pause') {
        sessionRef.current?.pause()
        return
      }
      if (command.type === 'resume') {
        sessionRef.current?.resume()
        return
      }
      if (command.type === 'retry') {
        retryRecording()
        return
      }
      if (command.type === 'open-mode') {
        openRecorder(command.mode)
      }
    })
  }, [cancelRecording, openRecorder, retryRecording])

  const drawSelection = useCallback(
    (includeAnnotations: boolean): HTMLCanvasElement | null => {
      if (!init || !selection || !imageCanvasRef.current) return null
      const image = imageCanvasRef.current
      if (!image.width || !image.height) return null
      const scaleX = init.imageWidth / init.bounds.width
      const scaleY = init.imageHeight / init.bounds.height
      const outWidth = Math.max(1, Math.round(selection.width * scaleX))
      const outHeight = Math.max(1, Math.round(selection.height * scaleY))
      let canvas = exportCanvasRef.current
      if (!canvas) {
        canvas = document.createElement('canvas')
        exportCanvasRef.current = canvas
      }
      if (canvas.width !== outWidth) canvas.width = outWidth
      if (canvas.height !== outHeight) canvas.height = outHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.clearRect(0, 0, outWidth, outHeight)
      ctx.drawImage(
        image,
        selection.x * scaleX,
        selection.y * scaleY,
        selection.width * scaleX,
        selection.height * scaleY,
        0,
        0,
        outWidth,
        outHeight
      )
      if (includeAnnotations) {
        const annotationCanvas = annotationRef.current?.getCanvas()
        if (annotationCanvas) ctx.drawImage(annotationCanvas, 0, 0, outWidth, outHeight)
      }
      return canvas
    },
    [init, selection]
  )

  const buildSelectionBytes = useCallback(
    async (includeAnnotations: boolean): Promise<Uint8Array | null> => {
      const canvas = drawSelection(includeAnnotations)
      if (!canvas) return null
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png')
      })
      if (!blob) return null
      return new Uint8Array(await blob.arrayBuffer())
    },
    [drawSelection]
  )

  const exportImage = useCallback(
    async (action: OverlayAction, autoTranslate = false): Promise<void> => {
      if (!init || !selection) return
      const pngBytes = await buildSelectionBytes(action !== 'ocr')
      if (!pngBytes) return
      window.snapglass.overlay.complete({
        action,
        displayId: init.displayId,
        selection,
        pngBytes,
        autoTranslate
      })
    },
    [init, selection, buildSelectionBytes]
  )

  /**
   * 背景：自动复制原先在渲染线程重新裁剪并编码整张 PNG，松手后立刻执行。
   * 实测一次大选区编码会占用渲染主线程 549ms，工具栏和标注都会跟着卡。
   * 设计意图：渲染层只上报选区矩形，主进程用已经截好的原图裁剪后写剪贴板，
   * 渲染线程零编码、零大体积 IPC；触发时间也推到工具栏首帧之后。
   * 关键约束：自动复制只做一次；会话重置时必须取消还没触发的计时。
   */
  const autoCopyTimerRef = useRef(0)
  const cancelPendingAutoCopy = useCallback(() => {
    if (!autoCopyTimerRef.current) return
    window.clearTimeout(autoCopyTimerRef.current)
    autoCopyTimerRef.current = 0
  }, [])

  const autoCopySelection = useCallback((): void => {
    const current = selectionRef.current
    if (!current) return
    window.snapglass.overlay.autoCopy(current)
    showToast(t(init?.settings?.language, '截图已自动复制'))
  }, [init, selectionRef, showToast])

  useEffect(() => {
    if (phase !== 'editing' || !selection || !init || autoCopiedRef.current) return
    autoCopiedRef.current = true
    // 延后到工具栏首帧画完之后，不和选区边框、工具条抢首帧。
    autoCopyTimerRef.current = window.setTimeout(() => {
      autoCopyTimerRef.current = 0
      autoCopySelection()
    }, 300)
  }, [phase, selection, init, autoCopySelection])

  useEffect(() => {
    if (phase === 'editing') return
    cancelPendingAutoCopy()
  }, [phase, cancelPendingAutoCopy])

  useEffect(() => () => cancelPendingAutoCopy(), [cancelPendingAutoCopy])

  const onAction = useCallback(
    (
      action:
        | 'ocr'
        | 'translate'
        | 'gif'
        | 'video'
        | 'copy'
        | 'pin'
        | 'save'
        | 'close'
    ) => {
      if (action === 'close') {
        window.snapglass.overlay.cancel()
        return
      }
      if (action === 'gif' || action === 'video') {
        openRecorder(action)
        return
      }
      if (action === 'ocr') {
        exportImage('ocr', false)
        return
      }
      if (action === 'translate') {
        exportImage('ocr', true)
        return
      }
      exportImage(action)
    },
    [closeSubmenu, exportImage, openRecorder]
  )

  useOverlayKeyboard({
    phase,
    selection,
    exportImage,
    cancelRecording,
    setRecorderMode,
    annotationRef,
    recorderModeRef,
    recordPhaseRef
  })

  const recorderModeActive = recorderMode !== null
  const hideFrozenImage =
    recorderModeActive &&
    (captureClean ||
      recordPhase === 'recording' ||
      recordPhase === 'paused' ||
      recordPhase === 'encoding')

  useEffect(() => {
    const canvas = imageCanvasRef.current
    if (canvas) canvas.style.visibility = init && !hideFrozenImage ? 'visible' : 'hidden'
  }, [init, hideFrozenImage, imageCanvasRef])

  if (error) return <div className="overlay-error">{error}</div>
  if (!init) return <div className="overlay-idle" />

  const toolbarTop = selection
    ? selection.y + selection.height + 16 + 104 < window.innerHeight
      ? selection.y + selection.height + 16
      : Math.max(8, selection.y - 104)
    : 0
  const toolbarLeft = selection
    ? Math.max(
        8,
        Math.min(
          selection.x + selection.width - toolbarWidth,
          window.innerWidth - toolbarWidth - 8
        )
      )
    : 0
  const showRecordingChrome = recorderModeActive && recordPhase !== 'result'
  const recorderLabel = recorderMode === 'gif' ? 'GIF' : t(init.settings.language, '视频')
  const recBarLeft = selection
    ? selection.x + selection.width / 2
    : 0
  const recBarTop = selection
    ? selection.y + selection.height + 12 + 56 <= window.innerHeight
      ? selection.y + selection.height + 12
      : Math.max(8, selection.y - 68)
    : 0

  return (
    <div
      className={`overlay-root${phase === 'selecting' ? ' selecting' : ''}${
        selectionDragging ? ' dragging-selection' : ''
      }${
        recorderModeActive ? ' recording' : ''
      }`}
      onPointerDown={onSelectDown}
      onPointerMove={onSelectMove}
      onPointerUp={onSelectUp}
      onDoubleClick={(event) => {
        if (phase !== 'editing' || !selection) return
        const target = event.target as HTMLElement
        // 工具条、录制条、文本输入框和标注画布各有自己的双击行为，不在这里处理
        if (
          target.closest(
            '.toolbar-position, .tooldock, .rec-ctrl, .gif-setup, .text-draft, .anno-canvas'
          )
        ) {
          return
        }
        event.preventDefault()
        onAction('copy')
      }}
      onPointerLeave={() => {
        if (brushCursorRef.current) brushCursorRef.current.style.display = 'none'
        if (phase === 'selecting' && !isDragging()) {
          cancelSnap()
        }
      }}
    >
      {!recorderModeActive && !selection && !hoverRect && <div className="pre-dim" />}
      {!recorderModeActive && phase === 'selecting' && hoverRect && (
        <>
          <DimAround rect={hoverRect} />
          <div
            className="window-snap"
            style={{
              left: hoverRect.x,
              top: hoverRect.y,
              width: hoverRect.width,
              height: hoverRect.height
            }}
          >
            <span
              className="window-snap-size"
              style={{ top: hoverRect.y < 26 ? 4 : -24 }}
            >
              {Math.round(hoverRect.width)} × {Math.round(hoverRect.height)}
            </span>
          </div>
        </>
      )}
      {selection && (
        <>
          {!recorderModeActive && (
            <>
              <DimAround rect={selection} />
              <div
                className="selection"
                style={{
                  left: selection.x,
                  top: selection.y,
                  width: selection.width,
                  height: selection.height
                }}
              >
                {phase === 'selecting' && (
                  <span className="selection-size">
                    {Math.round(selection.width)} × {Math.round(selection.height)}
                  </span>
                )}
                {phase === 'editing' &&
                  RESIZE_DIRS.map((dir) => (
                    <span
                      key={dir}
                      className={`resize-handle ${dir}`}
                      onPointerDown={(event) => startResize(event, dir)}
                    />
                  ))}
              </div>
            </>
          )}
          {showRecordingChrome && (
            <DimAround rect={selection} className="recording-dim" />
          )}
          {phase === 'editing' && !recorderModeActive && (
            <>
              <AnnotationCanvas
                ref={annotationRef}
                imageWidth={init.imageWidth}
                imageHeight={init.imageHeight}
                bounds={init.bounds}
                imageCanvasRef={imageCanvasRef}
                selection={selection}
                options={options}
                selectionDragging={selectionDragging}
                moveCursor="grab"
                onEmptyDoubleClick={() => onAction('copy')}
                onTextInputStart={onTextInputStart}
                onHistoryChange={onHistoryChange}
              />
            </>
          )}
          {recorderMode && recordPhase === 'idle' && (
            <div className="rec-bar-position" style={{ left: recBarLeft, top: recBarTop }}>
              <RecorderBar
                mode={recorderMode}
                language={init.settings.language}
                mic={recorderOptions.mic}
                systemAudio={recorderOptions.systemAudio}
                onMicToggle={() =>
                  setRecorderOptions((previous) => ({ ...previous, mic: !previous.mic }))
                }
                onSystemAudioToggle={() =>
                  setRecorderOptions((previous) => ({
                    ...previous,
                    systemAudio: !previous.systemAudio
                  }))
                }
                onStart={() => {
                  void startRecording()
                }}
                onCancel={() => {
                  if (recordPhaseRef.current === 'preparing') cancelRecording()
                  else setRecorderMode(null)
                }}
              />
            </div>
          )}
          {showRecordingChrome && (
            <div
              className={`recording-frame ${
                recordPhase === 'idle' ? 'standby' : recordPhase
              }`}
              style={{
                left: selection.x,
                top: selection.y,
                width: selection.width,
                height: selection.height
              }}
            >
              <span
                className={`recording-badge${
                  recordPhase === 'recording' || recordPhase === 'paused' ? ' live' : ''
                }`}
              >
                <i />
                <span>
                  {recordPhase === 'preparing'
                    ? t(init.settings.language, '准备中 · {label}', { label: recorderLabel })
                    : recordPhase === 'idle' || recordPhase === 'countdown'
                      ? t(init.settings.language, '待机 · {label}', { label: recorderLabel })
                    : recordPhase === 'recording' || recordPhase === 'paused'
                      ? `REC · ${recorderLabel}`
                      : recordPhase === 'encoding'
                        ? t(init.settings.language, '正在生成')
                        : t(init.settings.language, '待机 · {label}', { label: recorderLabel })}
                </span>
              </span>
              {recordPhase === 'countdown' && countdownNumber > 0 && (
                <div key={countdownNumber} className="recording-countdown">
                  {countdownNumber}
                </div>
              )}
              {recordPhase === 'encoding' && (
                <div className="recording-encoding">
                  <span className="prepare-spinner" />
                  {t(init.settings.language, '正在生成…')}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {!recorderModeActive && (
        <div
          className="toolbar-position"
          style={{
            left: phase === 'editing' && selection ? toolbarLeft : 0,
            top: phase === 'editing' && selection ? toolbarTop : 0,
            // 用 opacity 而不是 visibility 隐藏：覆盖层首次显示时就把工具栏画好，
            // 避免第一次框选后等一次可见绘制（实测多出约 80ms）。
            opacity: phase === 'editing' && selection ? 1 : 0,
            visibility: 'visible',
            pointerEvents: phase === 'editing' && selection ? 'auto' : 'none'
          }}
          aria-hidden={!(phase === 'editing' && selection)}
        >
          <Toolbar
            options={options}
            setOptions={setOptions}
            language={init.settings.language}
            submenuOpen={submenuOpen}
            onToolClick={onToolClick}
            onAction={onAction}
            onUndo={() => annotationRef.current?.undo()}
            onRedo={() => annotationRef.current?.redo()}
            canUndo={canUndo}
            canRedo={canRedo}
          />
        </div>
      )}
      {options.tool === 'mosaic' && options.mosaicMode === 'brush' && phase === 'editing' && (
        <div
          ref={brushCursorRef}
          className="mosaic-cursor"
          style={{ width: options.mosaicBrushSize, height: options.mosaicBrushSize }}
        />
      )}
      {toast && <div className="overlay-toast">{toast}</div>}
    </div>
  )
}
