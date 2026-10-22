import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { PinInit, Rect, TextAnno, Tool } from '@shared/types'
import { Icon } from '../components/Icon'
import { AnnotationCanvas, type AnnotationCanvasHandle } from '../overlay/AnnotationCanvas'
import { DEFAULT_OPTIONS, type OverlayOptions } from '../overlay/options'
import { Toolbar } from '../overlay/Toolbar'
import './pin.css'

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
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)
  const suppressDoubleClickRef = useRef(false)
  const annotationRef = useRef<AnnotationCanvasHandle | null>(null)
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null)

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

  const flash = (message: string): void => {
    setToast(message)
    window.setTimeout(() => setToast(''), 1500)
  }

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
      setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight })
    }
    return () => {
      cancelled = true
    }
  }, [editing, imageUrl])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'Space' && !event.repeat) {
        if (editing) return
        event.preventDefault()
        void enterEdit()
        return
      }
      if (event.key === 'Escape') {
        if (editing) {
          event.preventDefault()
          void exitEdit()
        } else {
          window.snapglass.pin.close()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, enterEdit, exitEdit])

  if (!init) return <div className="pin-empty" />

  const imageBox: Rect = { x: 0, y: 0, width: init.width, height: init.height }

  return (
    <div
      className={`pin-root${dragging ? ' dragging' : ''}${editing ? ' editing' : ''}`}
      onPointerDown={(event) => {
        if (editing || event.button !== 0) return
        if ((event.target as HTMLElement).closest('.pin-actions')) return
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
        if ((event.target as HTMLElement).closest('.pin-actions')) return
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
        imageUrl && <img className="pin-image" src={imageUrl} alt="" draggable={false} />
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
