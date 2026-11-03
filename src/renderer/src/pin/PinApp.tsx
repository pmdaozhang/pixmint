import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { OcrTextBlock, PinInit, Rect, TextAnno, Tool } from '@shared/types'
import { Icon } from '../components/Icon'
import { AnnotationCanvas, type AnnotationCanvasHandle } from '../overlay/AnnotationCanvas'
import { DEFAULT_OPTIONS, type OverlayOptions } from '../overlay/options'
import { Toolbar } from '../overlay/Toolbar'
import { layoutPinTextLines } from './pin-text'
import './pin.css'

type PinTextState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export function PinApp(): JSX.Element {
  const [init, setInit] = useState<PinInit | null>(null)
  const [ignore, setIgnore] = useState(false)
  const [toast, setToast] = useState('')
  const [dragging, setDragging] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [editing, setEditing] = useState(false)
  const [options, setOptions] = useState<OverlayOptions>(DEFAULT_OPTIONS)
  const [submenuOpen, setSubmenuOpen] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 })
  const [textBlocks, setTextBlocks] = useState<OcrTextBlock[]>([])
  const [textState, setTextState] = useState<PinTextState>('idle')
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)
  const suppressDoubleClickRef = useRef(false)
  const annotationRef = useRef<AnnotationCanvasHandle | null>(null)
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const ocrCacheRef = useRef<{ imageUrl: string; blocks: OcrTextBlock[] } | null>(null)

  useEffect(() => {
    window.snapglass.pin.ready().then(setInit)
  }, [])

  useEffect(() => {
    if (!init) {
      setImageUrl('')
      return
    }
    const copy = new Uint8Array(init.imageBytes)
    const blob = new Blob([copy.buffer], { type: 'image/png' })
    setImageUrl(URL.createObjectURL(blob))
  }, [init])

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    }
  }, [imageUrl])

  const flash = useCallback((message: string): void => {
    setToast(message)
    window.setTimeout(() => setToast(''), 1500)
  }, [])

  /**
   * 背景：编辑模式需要比普通钉图多出工具栏高度，窗口尺寸由主进程控制。
   * 设计意图：进入时扩展、退出时恢复，图片本体保持原尺寸不变。
   * 关键约束：扩展失败不能进入编辑，避免工具栏被裁掉。
   */
  const enterEdit = useCallback(async (): Promise<void> => {
    if (!init || editing) return
    const layout = await window.snapglass.pin.setEditMode(true)
    if (!layout) {
      flash('无法进入编辑模式')
      return
    }
    setOptions(DEFAULT_OPTIONS)
    setSubmenuOpen(false)
    setCanUndo(false)
    setCanRedo(false)
    setEditing(true)
  }, [editing, init])

  const exitEdit = useCallback(async (): Promise<void> => {
    await window.snapglass.pin.setEditMode(false)
    setEditing(false)
    setSubmenuOpen(false)
    setCanUndo(false)
    setCanRedo(false)
  }, [])

  const confirmEdit = useCallback(async (): Promise<void> => {
    if (!init || !naturalSize.width || !naturalSize.height) return
    const image = new Image()
    image.src = imageUrl
    await image.decode().catch(() => undefined)
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) {
      flash('生成编辑图片失败')
      return
    }
    context.drawImage(image, 0, 0)
    const annotations = annotationRef.current?.getCanvas()
    if (annotations) context.drawImage(annotations, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png')
    })
    if (!blob) {
      flash('生成编辑图片失败')
      return
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const ok = await window.snapglass.pin.commitEdit(bytes)
    if (!ok) {
      flash('保存编辑失败')
      return
    }
    const copy = new Uint8Array(bytes)
    const nextUrl = URL.createObjectURL(new Blob([copy.buffer], { type: 'image/png' }))
    setImageUrl(nextUrl)
    await exitEdit()
  }, [exitEdit, imageUrl, init, naturalSize])

  const onToolClick = useCallback(
    (tool: Tool): void => {
      if (tool === 'move') {
        annotationRef.current?.cancelInteraction()
        setOptions((previous) => ({ ...previous, tool }))
        setSubmenuOpen(false)
        return
      }
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

  const onHistoryChange = useCallback((undo: boolean, redo: boolean): void => {
    setCanUndo(undo)
    setCanRedo(redo)
  }, [])

  const onTextInputStart = useCallback((annotation?: TextAnno): void => {
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

  useEffect(() => {
    if (!imageUrl) {
      setNaturalSize({ width: 0, height: 0 })
      return
    }
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.src = imageUrl
    return () => {
      cancelled = true
    }
  }, [imageUrl])

  useEffect(() => {
    if (!editing || !imageUrl) return
    let cancelled = false
    const image = new Image()
    image.src = imageUrl
    image.onload = () => {
      if (cancelled) return
      const canvas = baseCanvasRef.current
      if (!canvas) return
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) return
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)
    }
    return () => {
      cancelled = true
    }
  }, [editing, imageUrl])

  const measureView = useCallback((): void => {
    const image = imageRef.current
    if (!image) return
    setViewSize({ width: image.clientWidth, height: image.clientHeight })
  }, [])

  useEffect(() => {
    if (!imageUrl || editing) {
      setViewSize({ width: 0, height: 0 })
      return
    }
    measureView()
    const image = imageRef.current
    if (!image) return
    const observer = new ResizeObserver(measureView)
    observer.observe(image)
    return () => observer.disconnect()
  }, [editing, imageUrl, measureView])

  useEffect(() => {
    if (!init || !imageUrl || editing) {
      setTextBlocks([])
      setTextState('idle')
      return
    }
    const cached = ocrCacheRef.current
    if (cached?.imageUrl === imageUrl) {
      setTextBlocks(cached.blocks)
      setTextState(cached.blocks.length > 0 ? 'ready' : 'empty')
      return
    }
    let cancelled = false
    setTextBlocks([])
    setTextState('loading')
    window.snapglass.pin
      .recognizeText()
      .then((result) => {
        if (cancelled) return
        const blocks = result?.blocks ?? []
        ocrCacheRef.current = { imageUrl, blocks }
        setTextBlocks(blocks)
        setTextState(blocks.length > 0 ? 'ready' : 'empty')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.warn('PIN_TEXT_OCR_FAILED', error)
        setTextBlocks([])
        setTextState('error')
      })
    return () => {
      cancelled = true
    }
  }, [editing, imageUrl, init])

  const textLayout = useMemo(
    () => layoutPinTextLines(textBlocks, naturalSize, viewSize),
    [naturalSize, textBlocks, viewSize]
  )

  const selectAllPinText = useCallback((): boolean => {
    const layer = textLayerRef.current
    if (!layer || textLayout.length === 0) return false
    const range = document.createRange()
    range.selectNodeContents(layer)
    const selection = window.getSelection()
    if (!selection) return false
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }, [textLayout.length])

  const selectedPinText = useCallback((): string => {
    const layer = textLayerRef.current
    const selection = window.getSelection()
    if (!layer || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      return ''
    }
    const anchor = selection.anchorNode
    const focus = selection.focusNode
    if (!anchor || !focus || !layer.contains(anchor) || !layer.contains(focus)) return ''
    return selection.toString()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (editing) {
        if (event.key === 'Escape') {
          event.preventDefault()
          void exitEdit()
        }
        return
      }
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'a') {
        if (selectAllPinText()) event.preventDefault()
        return
      }
      if (modifier && event.key.toLowerCase() === 'c') {
        const text = selectedPinText()
        if (!text) return
        event.preventDefault()
        void window.snapglass.clipboard
          .writeText(text)
          .then(() => flash('已复制选中文字'))
          .catch((error: unknown) => {
            console.warn('PIN_TEXT_COPY_FAILED', error)
            flash('复制文字失败')
          })
        return
      }
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault()
        void enterEdit()
        return
      }
      if (event.key === 'Escape') {
        window.snapglass.pin.close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    editing,
    enterEdit,
    exitEdit,
    flash,
    selectAllPinText,
    selectedPinText
  ])

  if (!init) return <div className="pin-empty" />

  const imageBox: Rect = { x: 0, y: 0, width: init.width, height: init.height }

  return (
    <div
      className={`pin-root${dragging ? ' dragging' : ''}${editing ? ' editing' : ''}`}
      data-pin-text-state={textState}
      onPointerDown={(event) => {
        if (editing || event.button !== 0) return
        if ((event.target as HTMLElement).closest('.pin-actions, .pin-text-line')) return
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { startX: event.screenX, startY: event.screenY, moved: false }
        setDragging(true)
        window.snapglass.pin.dragStart()
      }}
      onPointerMove={(event) => {
        if (editing) return
        const drag = dragRef.current
        if (!drag) return
        if (Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) > 2) {
          drag.moved = true
        }
        if (drag.moved) window.snapglass.pin.dragMove(event.movementX, event.movementY)
      }}
      onPointerUp={(event) => {
        if (editing) return
        const drag = dragRef.current
        if (!drag) return
        dragRef.current = null
        setDragging(false)
        window.snapglass.pin.dragEnd()
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          // pointer capture 可能已释放
        }
        if (drag.moved) {
          suppressDoubleClickRef.current = true
          window.setTimeout(() => {
            suppressDoubleClickRef.current = false
          }, 260)
        }
      }}
      onWheel={(event) => {
        if (editing) return
        event.preventDefault()
        void window.snapglass.pin.zoom(event.deltaY < 0 ? 1 : -1)
      }}
      onDoubleClick={async (event) => {
        if (editing) return
        if ((event.target as HTMLElement).closest('.pin-actions, .pin-text-line')) return
        if (suppressDoubleClickRef.current) return
        const next = await window.snapglass.pin.toggleIgnore()
        setIgnore(next)
        flash(next ? '鼠标穿透已开启，可从托盘恢复' : '鼠标穿透已关闭')
      }}
      onContextMenu={(event) => {
        if (editing) return
        event.preventDefault()
        window.snapglass.pin.contextMenu()
      }}
    >
      {editing ? (
        <div className="pin-edit">
          <div
            className="pin-edit-image"
            style={{ width: init.width, height: init.height }}
          >
            <canvas ref={baseCanvasRef} className="pin-base" />
            {naturalSize.width > 0 && (
              <AnnotationCanvas
                ref={annotationRef}
                imageWidth={naturalSize.width}
                imageHeight={naturalSize.height}
                bounds={imageBox}
                imageCanvasRef={baseCanvasRef}
                selection={imageBox}
                options={options}
                onTextInputStart={onTextInputStart}
                onHistoryChange={onHistoryChange}
              />
            )}
          </div>
          <div className="pin-edit-toolbar">
            <Toolbar
              options={options}
              setOptions={(patch) => setOptions((previous) => ({ ...previous, ...patch }))}
              submenuOpen={submenuOpen}
              onToolClick={onToolClick}
              onAction={() => undefined}
              onUndo={() => annotationRef.current?.undo()}
              onRedo={() => annotationRef.current?.redo()}
              canUndo={canUndo}
              canRedo={canRedo}
              variant="pin"
              onConfirm={() => {
                void confirmEdit()
              }}
            />
          </div>
        </div>
      ) : (
        imageUrl && (
          <div className="pin-image-wrap">
            <img
              ref={imageRef}
              className="pin-image"
              src={imageUrl}
              alt=""
              draggable={false}
              onLoad={measureView}
            />
            {textLayout.length > 0 && (
              <div ref={textLayerRef} className="pin-text-layer">
                {textLayout.map((line) => (
                  <span
                    key={line.id}
                    className="pin-text-line"
                    style={{
                      left: line.left,
                      top: line.top,
                      width: line.width,
                      height: line.height,
                      fontSize: line.fontSize,
                      lineHeight: `${line.height}px`
                    }}
                  >
                    {line.text}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      )}
      {!editing && textState === 'loading' && (
        <span className="pin-text-status">识别文字中…</span>
      )}
      {!editing && textState === 'error' && (
        <span className="pin-text-status">文字识别不可用</span>
      )}
      {!editing && (
        <div className="pin-actions">
          <button
            title="复制"
            onClick={(event) => {
              event.stopPropagation()
              void window.snapglass.pin.copy().then(() => flash('已复制'))
            }}
          >
            <Icon name="copy" size={14} />
          </button>
          <button
            title="保存"
            onClick={(event) => {
              event.stopPropagation()
              void window.snapglass.pin
                .save()
                .then((filePath) => flash(filePath ? '已保存' : '保存失败'))
            }}
          >
            <Icon name="save" size={14} />
          </button>
          <button
            title="关闭"
            onClick={(event) => {
              event.stopPropagation()
              window.snapglass.pin.close()
            }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {ignore && <span className="pin-badge">鼠标穿透</span>}
      {toast && <span className="pin-toast">{toast}</span>}
    </div>
  )
}
