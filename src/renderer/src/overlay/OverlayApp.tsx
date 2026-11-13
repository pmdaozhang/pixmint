import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import type {
  OverlayAction,
  OverlayInit,
  Rect,
  RecorderMode,
  RecorderOptions,
  Settings
} from '@shared/types'
import { AnnotationCanvas, type AnnotationCanvasHandle } from './AnnotationCanvas'
import { DimAround } from './DimAround'
import { Magnifier } from './Magnifier'
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

// 拖拽控制点时的鼠标样式；拖拽期间强制覆盖整个覆盖层，避免指针离开节点后变成手型。
const RESIZE_CURSOR: Record<string, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize'
}
const DEFAULT_RECORDER_OPTIONS: RecorderOptions = {
  mode: 'gif',
  fps: 15,
  size: '720',
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
  // 高度必须实测：二级菜单展开后工具条会变高，位置要跟着让开选区。
  const [toolbarHeight, setToolbarHeight] = useState(38)
  // 编辑态预热：用一个假选区把工具栏/缩放柄/标注画布完整挂载一次。
  // 窗口此时是全屏 alpha 0，用户不可见；预热结束后立刻复位。
  const [warmRect, setWarmRect] = useState<Rect | null>(null)
  const warmEditActiveRef = useRef(false)
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
    resizing,
    resizeDir,
    resizeDirRef,
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
  // init 已应用、会话尚未重置。窗口现在常驻显示，focus 事件不能把会话重新初始化。
  const sessionActiveRef = useRef(false)

  const applyInit = useCallback(
    (data: OverlayInit) => {
      awaitingInitRef.current = false
      sessionActiveRef.current = true
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
    const media = window.matchMedia('(prefers-color-scheme: dark)').matches
    const theme =
      settings.theme === 'system' ? (media ? 'dark' : 'light') : settings.theme
    document.documentElement.dataset.theme = theme
  }, [cancelSnap, resetRecorderState, resetSelection])

  const applyPrepare = useCallback(
    (settings: Settings) => {
      // 紧接着会收到 overlay:init，先标记住，避免窗口显示时重复加载。
      awaitingInitRef.current = true
      sessionActiveRef.current = false
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
  }, [cancelSnap, resetRecorderState, resetSelection])

  const applyReset = useCallback(() => {
    awaitingInitRef.current = false
    sessionActiveRef.current = false
    clearSessionImage(resetUiForReset, false)
  }, [clearSessionImage, resetUiForReset])

  useEffect(() => {
    const off = window.snapglass.overlay.onInit(applyInit)
    const offPrepare = window.snapglass.overlay.onPrepare(applyPrepare)
    const offReset = window.snapglass.overlay.onReset(applyReset)
    const offWarmEdit = window.snapglass.overlay.onWarmEdit((bounds) => {
      // 重复请求只回 ack，不重复挂载。
      if (warmEditActiveRef.current) {
        window.snapglass.overlay.warmEditDone()
        return
      }
      warmEditActiveRef.current = true
      setWarmRect({
        x: bounds.x,
        y: bounds.y,
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height))
      })
      // 两帧后标注画布和离屏画布已经完成创建与绘制；窗口 alpha 0，用户不可见。
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.snapglass.overlay.warmEditDone()
          warmEditActiveRef.current = false
          setWarmRect(null)
        })
      })
    })
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
      // 会话进行中（窗口常驻显示，focus 事件随时可能到来）不能重新初始化。
      if (sessionActiveRef.current) return
      if (warmEditActiveRef.current) return
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
      offWarmEdit()
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
      const rect = dock?.getBoundingClientRect()
      if (!rect) return
      if (rect.width > 0) setToolbarWidth(rect.width)
      if (rect.height > 0) setToolbarHeight(rect.height)
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

  const showColorCopied = useCallback(
    (hex: string) => {
      showToast(t(init?.settings.language, '已复制颜色 {color}', { color: hex }))
    },
    [init, showToast]
  )

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
      size: mode === 'video' ? '720' : 'original',
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
      size: recorderOptionsRef.current.size,
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
  // 预热态没有 init，但需要把工具栏和标注画布真正挂载并合成一次。
  if (!init && !warmRect) return <div className="overlay-idle" />

  // 预热态用假选区渲染编辑界面；窗口 alpha 0，用户看不到。
  const effectiveSelection = warmRect ?? selection
  const effectivePhase = warmRect ? 'editing' : phase
  const language = init?.settings.language
  const warmBounds = init?.bounds ?? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }

  const toolbarGap = 10
  const toolbarTop = effectiveSelection
    ? effectiveSelection.y + effectiveSelection.height + toolbarGap + toolbarHeight <
      window.innerHeight
      ? effectiveSelection.y + effectiveSelection.height + toolbarGap
      : Math.max(8, effectiveSelection.y - toolbarHeight - toolbarGap)
    : 0
  const toolbarLeft = effectiveSelection
    ? Math.max(
        8,
        Math.min(
          effectiveSelection.x + effectiveSelection.width - toolbarWidth,
          window.innerWidth - toolbarWidth - 8
        )
      )
    : 0
  const showRecordingChrome = recorderModeActive && recordPhase !== 'result'
  const recorderLabel = recorderMode === 'gif' ? 'GIF' : t(language, '视频')
  const recBarLeft = effectiveSelection
    ? effectiveSelection.x + effectiveSelection.width / 2
    : 0
  const recBarTop = effectiveSelection
    ? effectiveSelection.y + effectiveSelection.height + 12 + 56 <= window.innerHeight
      ? effectiveSelection.y + effectiveSelection.height + 12
      : Math.max(8, effectiveSelection.y - 68)
    : 0

  const resizeCursor = resizing && resizeDir ? RESIZE_CURSOR[resizeDir] : undefined
  return (
    <div
      className={`overlay-root${effectivePhase === 'selecting' ? ' selecting' : ''}${
        selectionDragging ? ' dragging-selection' : ''
      }${resizing ? ' resizing' : ''}${
        recorderModeActive ? ' recording' : ''
      }`}
      style={
        resizeCursor
          ? ({ '--resize-cursor': resizeCursor } as CSSProperties)
          : undefined
      }
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
      {!recorderModeActive && !effectiveSelection && !hoverRect && <div className="pre-dim" />}
      {!recorderModeActive && effectivePhase === 'selecting' && hoverRect && (
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
      {effectiveSelection && (
        <>
          {!recorderModeActive && (
            <>
              <DimAround rect={effectiveSelection} />
              <div
                className="selection"
                style={{
                  left: effectiveSelection.x,
                  top: effectiveSelection.y,
                  width: effectiveSelection.width,
                  height: effectiveSelection.height
                }}
              >
                {effectivePhase === 'selecting' && (
                  <span className="selection-size">
                    {Math.round(effectiveSelection.width)} × {Math.round(effectiveSelection.height)}
                  </span>
                )}
                {effectivePhase === 'editing' &&
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
            <DimAround rect={effectiveSelection} className="recording-dim" />
          )}
          {effectivePhase === 'editing' && !recorderModeActive && (
            <>
              <AnnotationCanvas
                ref={annotationRef}
                imageWidth={init?.imageWidth ?? 1}
                imageHeight={init?.imageHeight ?? 1}
                bounds={warmBounds}
                imageCanvasRef={imageCanvasRef}
                selection={effectiveSelection}
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
                language={language ?? 'zh-CN'}
                size={recorderOptions.size}
                mic={recorderOptions.mic}
                systemAudio={recorderOptions.systemAudio}
                onSizeChange={(size) =>
                  setRecorderOptions((previous) => ({ ...previous, size }))
                }
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
                left: effectiveSelection.x,
                top: effectiveSelection.y,
                width: effectiveSelection.width,
                height: effectiveSelection.height
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
                    ? t(language, '准备中 · {label}', { label: recorderLabel })
                    : recordPhase === 'idle' || recordPhase === 'countdown'
                      ? t(language, '待机 · {label}', { label: recorderLabel })
                    : recordPhase === 'recording' || recordPhase === 'paused'
                      ? `REC · ${recorderLabel}`
                      : recordPhase === 'encoding'
                        ? t(language, '正在生成')
                        : t(language, '待机 · {label}', { label: recorderLabel })}
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
                  {t(language, '正在生成…')}
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
            left: effectivePhase === 'editing' && effectiveSelection ? toolbarLeft : 0,
            top: effectivePhase === 'editing' && effectiveSelection ? toolbarTop : 0,
            // 用 opacity 而不是 visibility 隐藏：覆盖层首次显示时就把工具栏画好，
            // 避免第一次框选后等一次可见绘制（实测多出约 80ms）。
            opacity: effectivePhase === 'editing' && effectiveSelection ? 1 : 0,
            visibility: 'visible',
            pointerEvents: effectivePhase === 'editing' && effectiveSelection ? 'auto' : 'none'
          }}
          aria-hidden={!(effectivePhase === 'editing' && effectiveSelection)}
        >
          <Toolbar
            options={options}
            setOptions={setOptions}
            language={language ?? 'zh-CN'}
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
      {init && imageReady && !recorderModeActive && (
        <Magnifier
          init={init}
          imageCanvasRef={imageCanvasRef}
          language={init.settings.language}
          onCopied={showColorCopied}
          // 框选阶段常驻跟随；编辑阶段只在拖拽控制点时跟随。
          active={(effectivePhase === 'selecting' && !warmRect) || resizing}
          // 编辑阶段不接管取色快捷键，避免抢走复制截图。
          interactiveKeys={effectivePhase === 'selecting' && !warmRect}
          // 拖控制点时把放大镜限制在选区外侧，不遮挡截图内容。
          avoidRectRef={selectionRef}
          resizeDirRef={resizeDirRef}
        />
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
