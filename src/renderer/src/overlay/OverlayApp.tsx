import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import type {
  OverlayAction,
  OverlayInit,
  Rect,
  RecorderMode,
  RecorderOptions,
  Settings,
  TextAnno,
  Tool
} from '@shared/types'
import { normalizeRect } from '@shared/geometry'
import { AnnotationCanvas, type AnnotationCanvasHandle } from './AnnotationCanvas'
import { DimAround } from './DimAround'
import { RecorderBar } from './RecorderBar'
import { RecorderSession } from './RecorderSession'
import {
  MIN_SELECTION,
  RESIZE_DIRS,
  clampWindowRect,
  resizeSelectionRect,
  type ResizeDir
} from './selection-geometry'
import { Toolbar } from './Toolbar'
import { DEFAULT_OPTIONS, type OverlayOptions } from './options'
import './overlay.css'

type Phase = 'selecting' | 'editing'
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
  const [init, setInit] = useState<OverlayInit | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [phase, setPhase] = useState<Phase>('selecting')
  const [options, setOptions] = useState<OverlayOptions>(DEFAULT_OPTIONS)
  const [submenuOpen, setSubmenuOpen] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [imageReady, setImageReady] = useState(false)
  const [hoverRect, setHoverRect] = useState<Rect | null>(null)
  // 首次框选前就按接近实际宽度定位，避免量宽前把工具条推到屏幕外造成“延迟出现”。
  const [toolbarWidth, setToolbarWidth] = useState(740)
  const [recorderMode, setRecorderMode] = useState<RecorderMode | null>(null)
  const [recorderOptions, setRecorderOptions] =
    useState<RecorderOptions>(DEFAULT_RECORDER_OPTIONS)
  const [recordPhase, setRecordPhase] = useState<RecordPhase>('idle')
  const [countdownNumber, setCountdownNumber] = useState(0)
  // 倒计时结束后先撤掉冻结截图，等合成器提交两帧再真正开录，避免首帧录进截图界面。
  const [captureClean, setCaptureClean] = useState(false)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const annotationRef = useRef<AnnotationCanvasHandle | null>(null)
  const brushCursorRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef<RecorderSession | null>(null)
  const recorderModeRef = useRef<RecorderMode | null>(null)
  const recordPhaseRef = useRef<RecordPhase>('idle')
  const recorderOptionsRef = useRef<RecorderOptions>(DEFAULT_RECORDER_OPTIONS)
  const pendingRecordModeRef = useRef<RecorderMode | null>(null)
  const recordCancelledRef = useRef(false)
  const autoCopiedRef = useRef(false)
  const initTokenRef = useRef(0)
  const selectionRef = useRef<Rect | null>(null)
  const snapQueryIdRef = useRef(0)
  const lastSnapAtRef = useRef(0)
  const lastSnapPointRef = useRef<{ x: number; y: number } | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const snapBusyRef = useRef(false)
  const dragRef = useRef<{
    startX: number
    startY: number
    dragging: boolean
    moved: boolean
    hover: Rect | null
  }>({
    startX: 0,
    startY: 0,
    dragging: false,
    moved: false,
    hover: null
  })

  const updateSelection = useCallback((next: Rect | null) => {
    selectionRef.current = next
    setSelection(next)
  }, [])

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

  const applyInit = useCallback((data: OverlayInit) => {
    const token = ++initTokenRef.current
    setPreparing(true)
    setImageReady(false)
    updateSelection(null)
    snapQueryIdRef.current += 1
    lastSnapPointRef.current = null
    lastPointerRef.current = null
    snapBusyRef.current = false
    setHoverRect(null)
    resetRecorderState()
    pendingRecordModeRef.current = data.pendingRecorderMode ?? null
    setPhase('selecting')
    setOptions(DEFAULT_OPTIONS)
    setSubmenuOpen(false)
    setCanUndo(false)
    setCanRedo(false)
    autoCopiedRef.current = false
    setToast('')
    setError('')
    const media = window.matchMedia('(prefers-color-scheme: dark)').matches
    const theme =
      data.settings.theme === 'system' ? (media ? 'dark' : 'light') : data.settings.theme
    document.documentElement.dataset.theme = theme
    // 先把图片解码完再提交 init，保证覆盖层显示时第一帧就是新截图。
    const image = new Image()
    const commit = (): void => {
      if (initTokenRef.current !== token) return
      setInit(data)
      setPreparing(false)
      setImageReady(true)
    }
    image.onload = commit
    image.onerror = commit
    image.src = data.imageDataUrl
  }, [resetRecorderState, updateSelection])

  const applyPrepare = useCallback((settings: Settings) => {
    initTokenRef.current += 1
    setPreparing(true)
    setImageReady(false)
    setInit(null)
    updateSelection(null)
    snapQueryIdRef.current += 1
    lastSnapPointRef.current = null
    lastPointerRef.current = null
    snapBusyRef.current = false
    setHoverRect(null)
    resetRecorderState()
    pendingRecordModeRef.current = null
    setPhase('selecting')
    setOptions(DEFAULT_OPTIONS)
    setSubmenuOpen(false)
    setCanUndo(false)
    setCanRedo(false)
    setToast('')
    setError('')
    autoCopiedRef.current = false
    const media = window.matchMedia('(prefers-color-scheme: dark)').matches
    const theme =
      settings.theme === 'system' ? (media ? 'dark' : 'light') : settings.theme
    document.documentElement.dataset.theme = theme
  }, [resetRecorderState, updateSelection])

  const applyReset = useCallback(() => {
    initTokenRef.current += 1
    setPreparing(false)
    setImageReady(false)
    setInit(null)
    updateSelection(null)
    snapQueryIdRef.current += 1
    lastSnapPointRef.current = null
    lastPointerRef.current = null
    snapBusyRef.current = false
    setHoverRect(null)
    resetRecorderState()
    pendingRecordModeRef.current = null
    setPhase('selecting')
    setOptions(DEFAULT_OPTIONS)
    setSubmenuOpen(false)
    setCanUndo(false)
    setCanRedo(false)
    setToast('')
    setError('')
    autoCopiedRef.current = false
  }, [resetRecorderState, updateSelection])

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
    // 等两帧，确保新截图已经真正绘制到窗口 surface 上再通知主进程显示。
    first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
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
    setSubmenuOpen(false)
  }, [])

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
    if (!mode || !init || !selection || recordPhaseRef.current !== 'idle') return
    if (selection.width < 64 || selection.height < 64) {
      showToast('选区太小，至少需要 64 × 64')
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
      const { sourceId } = await withTimeout(
        window.snapglass.recorder.begin({
          mode,
          displayId: init.displayId,
          selection,
          options
        }),
        9_000,
        '录制初始化超时，请重试'
      )
      if (recordCancelledRef.current) return

      const session = new RecorderSession(init, selection, options, {
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
      await withTimeout(session.prepare(sourceId), 9_000, '录制初始化超时，请重试')
      if (recordCancelledRef.current) return

      setRecordPhase('countdown')
      recordPhaseRef.current = 'countdown'
      window.snapglass.recorder.state({
        phase: 'countdown',
        elapsedMs: 0,
        message: '3 秒后开始'
      })
      for (let remain = 3; remain > 0; remain -= 1) {
        if (recordCancelledRef.current) return
        setCountdownNumber(remain)
        await wait(700)
      }
      if (recordCancelledRef.current) return
      setCountdownNumber(0)
      setCaptureClean(true)
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

  const onHistoryChange = useCallback((undo: boolean, redo: boolean) => {
    setCanUndo(undo)
    setCanRedo(redo)
  }, [])

  const onToolClick = useCallback(
    (tool: Tool) => {
      if (options.tool === tool) {
        setSubmenuOpen((open) => !open)
        return
      }
      annotationRef.current?.cancelInteraction()
      setOptions((previous) => ({ ...previous, tool }))
      setSubmenuOpen(true)
    },
    [options.tool]
  )

  const onTextInputStart = useCallback((annotation?: TextAnno) => {
    setOptions((previous) => ({
      ...previous,
      tool: 'text',
      ...(annotation
        ? {
            textB: annotation.bold,
            textI: annotation.italic,
            textU: annotation.underline,
            fontSize: annotation.fontSize,
            fontFamily: annotation.fontFamily,
            color: annotation.style.color
          }
        : {})
    }))
    setSubmenuOpen(true)
  }, [])

  const buildSelectionPng = useCallback(
    (includeAnnotations: boolean): string | null => {
      if (!init || !selection || !imageRef.current) return null
      const image = imageRef.current
      if (!image.complete) return null
      const scaleX = init.imageWidth / init.bounds.width
      const scaleY = init.imageHeight / init.bounds.height
      const outWidth = Math.max(1, Math.round(selection.width * scaleX))
      const outHeight = Math.max(1, Math.round(selection.height * scaleY))
      const canvas = document.createElement('canvas')
      canvas.width = outWidth
      canvas.height = outHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
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
      return canvas.toDataURL('image/png')
    },
    [init, selection]
  )

  const exportImage = useCallback(
    (action: OverlayAction, autoTranslate = false) => {
      if (!init || !selection) return
      const pngDataUrl = buildSelectionPng(action !== 'ocr')
      if (!pngDataUrl) return
      window.snapglass.overlay.complete({
        action,
        displayId: init.displayId,
        selection,
        pngDataUrl,
        autoTranslate
      })
    },
    [init, selection, buildSelectionPng]
  )

  /**
   * 背景：大选区自动复制时，同步 toDataURL 会在渲染线程里编码整张 PNG。
   * 设计意图：改用异步 toBlob + FileReader，把编码从交互关键路径上挪开，
   * 避免框选刚结束就把全屏覆盖层卡住。
   * 关键约束：自动复制只做一次；失败只记录日志，不能阻断标注和录制。
   */
  const autoCopySelection = useCallback(async (): Promise<void> => {
    if (!init || !selection || !imageRef.current) return
    const image = imageRef.current
    if (!image.complete) return
    const scaleX = init.imageWidth / init.bounds.width
    const scaleY = init.imageHeight / init.bounds.height
    const outWidth = Math.max(1, Math.round(selection.width * scaleX))
    const outHeight = Math.max(1, Math.round(selection.height * scaleY))
    const canvas = document.createElement('canvas')
    canvas.width = outWidth
    canvas.height = outHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
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
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png')
    })
    if (!blob) return
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('读取自动复制图片失败'))
      reader.readAsDataURL(blob)
    })
    if (!dataUrl) return
    window.snapglass.overlay.autoCopy(dataUrl)
    showToast('截图已自动复制')
  }, [init, selection, showToast])

  useEffect(() => {
    if (phase !== 'editing' || !selection || !init || autoCopiedRef.current) return
    autoCopiedRef.current = true
    let cancelled = false
    // 延后一帧再编码，先让选区边框和遮罩完成首次绘制。
    const timer = window.setTimeout(() => {
      if (cancelled) return
      void autoCopySelection().catch((error: unknown) => {
        console.warn('AUTO_COPY_FAILED', error)
      })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [phase, selection, init, autoCopySelection])

  const onAction = useCallback(
    (action: 'ocr' | 'translate' | 'gif' | 'video' | 'copy' | 'pin' | 'save' | 'close') => {
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
    [exportImage, openRecorder]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        if (event.key === 'Escape') event.stopPropagation()
        return
      }
      if (recorderModeRef.current) {
        if (event.key === 'Escape') {
          event.preventDefault()
          if (recordPhaseRef.current === 'idle') setRecorderMode(null)
          else cancelRecording()
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        window.snapglass.overlay.cancel()
        return
      }
      if (phase !== 'editing' || !selection) return
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        exportImage('copy')
      } else if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        exportImage('save')
      } else if (event.key === 'F3') {
        event.preventDefault()
        exportImage('pin')
      } else if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) annotationRef.current?.redo()
        else annotationRef.current?.undo()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [phase, selection, exportImage, cancelRecording])

  const point = (event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const updateBrushCursor = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const cursor = brushCursorRef.current
    if (!cursor) return
    const target = event.target as HTMLElement | null
    if (
      phase !== 'editing' ||
      options.tool !== 'mosaic' ||
      options.mosaicMode !== 'brush' ||
      target?.closest('.tooldock')
    ) {
      cursor.style.display = 'none'
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    cursor.style.left = `${event.clientX - rect.left}px`
    cursor.style.top = `${event.clientY - rect.top}px`
    cursor.style.display = 'block'
  }

  const querySnap = (p: { x: number; y: number }): void => {
    if (!init) return
    lastPointerRef.current = p
    if (snapBusyRef.current) return
    const now = performance.now()
    const lastPoint = lastSnapPointRef.current
    if (lastPoint && Math.hypot(p.x - lastPoint.x, p.y - lastPoint.y) < 2) return
    if (now - lastSnapAtRef.current < 30) return
    lastSnapAtRef.current = now
    lastSnapPointRef.current = p
    const queryId = ++snapQueryIdRef.current
    snapBusyRef.current = true
    void window.snapglass.overlay
      .windowAt(p.x + init.bounds.x, p.y + init.bounds.y)
      .then((rect) => {
        if (queryId !== snapQueryIdRef.current) return
        setHoverRect(rect ? clampWindowRect(rect, init.bounds) : null)
      })
      .catch(() => {
        if (queryId === snapQueryIdRef.current) setHoverRect(null)
      })
      .finally(() => {
        snapBusyRef.current = false
        const latest = lastPointerRef.current
        if (latest && (Math.abs(latest.x - p.x) > 2 || Math.abs(latest.y - p.y) > 2)) {
          querySnap(latest)
        }
      })
  }

  const onSelectDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (phase === 'editing' || event.button !== 0) return
    const p = point(event)
    dragRef.current = {
      startX: p.x,
      startY: p.y,
      dragging: true,
      moved: false,
      hover: hoverRect
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    snapQueryIdRef.current += 1
    snapBusyRef.current = false
    lastPointerRef.current = null
    setHoverRect(null)
    updateSelection({ x: p.x, y: p.y, width: 0, height: 0 })
  }

  const onSelectMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    updateBrushCursor(event)
    if (phase === 'editing') return
    const p = point(event)
    if (!dragRef.current.dragging) {
      querySnap(p)
      return
    }
    const drag = dragRef.current
    if (!drag.moved && Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4) {
      drag.moved = true
      setHoverRect(null)
    }
    const rect = normalizeRect(drag.startX, drag.startY, p.x, p.y)
    updateSelection({
      x: Math.max(0, Math.min(rect.x, window.innerWidth)),
      y: Math.max(0, Math.min(rect.y, window.innerHeight)),
      width: Math.min(rect.width, window.innerWidth - Math.max(0, rect.x)),
      height: Math.min(rect.height, window.innerHeight - Math.max(0, rect.y))
    })
  }

  const onSelectUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    drag.dragging = false
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    if (!drag.moved && drag.hover) {
      updateSelection(drag.hover)
      drag.hover = null
      setHoverRect(null)
      setPhase('editing')
      return
    }
    const current = selectionRef.current
    if (!current) return
    if (current.width < MIN_SELECTION || current.height < MIN_SELECTION) {
      updateSelection(null)
      return
    }
    setPhase('editing')
  }

  const startResize = (
    event: ReactPointerEvent<HTMLSpanElement>,
    dir: ResizeDir
  ): void => {
    if (phase !== 'editing' || event.button !== 0) return
    const startRect = selectionRef.current
    if (!startRect) return
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startY = event.clientY
    let totalShiftX = 0
    let totalShiftY = 0

    const onMove = (moveEvent: PointerEvent): void => {
      const current = selectionRef.current
      if (!current) return
      const next = resizeSelectionRect(
        startRect,
        dir,
        moveEvent.clientX - startX,
        moveEvent.clientY - startY,
        window.innerWidth,
        window.innerHeight
      )
      const shiftX = next.x - current.x
      const shiftY = next.y - current.y
      if (shiftX || shiftY) {
        annotationRef.current?.shift(shiftX, shiftY)
        totalShiftX += shiftX
        totalShiftY += shiftY
      }
      updateSelection(next)
    }

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (totalShiftX || totalShiftY) {
        annotationRef.current?.shiftHistory(totalShiftX, totalShiftY)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  if (error) return <div className="overlay-error">{error}</div>
  if (preparing && !init) {
    return (
      <div className="overlay-preparing">
        <div className="prepare-pill">
          <span className="prepare-spinner" />
          正在截取屏幕…
        </div>
      </div>
    )
  }
  if (!init) return <div className="overlay-idle" />

  const toolbarTop = selection
    ? selection.y + selection.height + 12 + 110 < window.innerHeight
      ? selection.y + selection.height + 12
      : Math.max(8, selection.y - 112)
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
  const recorderModeActive = recorderMode !== null
  const hideFrozenImage =
    recorderModeActive &&
    (recordPhase === 'preparing' ||
      captureClean ||
      recordPhase === 'recording' ||
      recordPhase === 'paused' ||
      recordPhase === 'encoding')
  const showRecordingChrome = recorderModeActive && recordPhase !== 'result'
  const recorderLabel = recorderMode === 'gif' ? 'GIF' : '视频'
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
      className={`overlay-root${recorderModeActive ? ' recording' : ''}`}
      onPointerDown={onSelectDown}
      onPointerMove={onSelectMove}
      onPointerUp={onSelectUp}
      onPointerLeave={() => {
        if (brushCursorRef.current) brushCursorRef.current.style.display = 'none'
        if (phase === 'selecting' && !dragRef.current.dragging) {
          snapQueryIdRef.current += 1
          lastSnapPointRef.current = null
          lastPointerRef.current = null
          snapBusyRef.current = false
          setHoverRect(null)
        }
      }}
    >
      {!hideFrozenImage && (
        <img
          ref={imageRef}
          className="overlay-screen"
          src={init.imageDataUrl}
          alt=""
          draggable={false}
        />
      )}
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
          {showRecordingChrome && recordPhase !== 'preparing' && (
            <DimAround rect={selection} className="recording-dim" />
          )}
          {phase === 'editing' && !recorderModeActive && (
            <>
              <AnnotationCanvas
                ref={annotationRef}
                init={init}
                selection={selection}
                options={options}
                onTextInputStart={onTextInputStart}
                onHistoryChange={onHistoryChange}
              />
            </>
          )}
          {recorderMode && recordPhase === 'idle' && (
            <div className="rec-bar-position" style={{ left: recBarLeft, top: recBarTop }}>
              <RecorderBar
                mode={recorderMode}
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
                    ? `准备中 · ${recorderLabel}`
                    : recordPhase === 'idle' || recordPhase === 'countdown'
                      ? `待机 · ${recorderLabel}`
                    : recordPhase === 'recording' || recordPhase === 'paused'
                      ? `REC · ${recorderLabel}`
                      : recordPhase === 'encoding'
                        ? '正在生成'
                        : `待机 · ${recorderLabel}`}
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
                  正在生成…
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
            visibility: phase === 'editing' && selection ? 'visible' : 'hidden',
            pointerEvents: phase === 'editing' && selection ? 'auto' : 'none'
          }}
        >
          <Toolbar
            options={options}
            setOptions={(patch) => setOptions((previous) => ({ ...previous, ...patch }))}
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
