import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject
} from 'react'
import type {
  Annotation,
  AnnoStyle,
  LineAnno,
  MosaicAnno,
  OverlayInit,
  Point,
  Rect,
  TextAnno
} from '@shared/types'
import {
  appendMosaicBrushCells,
  canMoveAnnotationWithTool,
  cloneAnnotations,
  hitTestAnnotation,
  moveAnnotation
} from '@shared/annotation-utils'
import { drawAnnotation } from './annotation/draw'
import type { OverlayOptions } from './options'

export interface AnnotationCanvasHandle {
  undo(): void
  redo(): void
  getCanvas(): HTMLCanvasElement | null
  shift(dx: number, dy: number): void
  shiftHistory(dx: number, dy: number): void
  cancelInteraction(): void
}

interface Props {
  init: OverlayInit
  imageCanvasRef: RefObject<HTMLCanvasElement | null>
  selection: Rect
  options: OverlayOptions
  onTextInputStart(annotation?: TextAnno): void
  onHistoryChange(canUndo: boolean, canRedo: boolean): void
}

interface TextDraft {
  x: number
  y: number
  value: string
  annotationId?: string
  source?: TextAnno
}

export const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, Props>(
  function AnnotationCanvas(
    { init, imageCanvasRef, selection, options, onTextInputStart, onHistoryChange },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const backgroundCanvasRef = useRef<HTMLCanvasElement | null>(null)
    const annotationsRef = useRef<Annotation[]>([])
    const tempRef = useRef<Annotation | null>(null)
    const historyRef = useRef<Annotation[][]>([])
    const redoRef = useRef<Annotation[][]>([])
    const drawingRef = useRef(false)
    const movingRef = useRef<{ index: number; start: Point; original: Annotation } | null>(null)
    const textDragRef = useRef<{
      index: number
      start: Point
      original: Annotation
      moved: boolean
    } | null>(null)
    const gestureRef = useRef<{ start: Point; points: Point[]; moved: boolean } | null>(null)
    const pendingLineRef = useRef<{ x1: number; y1: number } | null>(null)
    const textPendingRef = useRef<Point | null>(null)
    const textInputRef = useRef<HTMLInputElement | null>(null)
    const editingTextIdRef = useRef<string | null>(null)
    const seqRef = useRef(0)
    const sizeRef = useRef({ width: selection.width, height: selection.height })
    const [textDraft, setTextDraft] = useState<TextDraft | null>(null)

    const dpr = window.devicePixelRatio || 1
    sizeRef.current = { width: selection.width, height: selection.height }
    const defaultCursor =
      options.tool === 'text' || options.tool === 'seq'
        ? 'text'
        : options.tool === 'mosaic' && options.mosaicMode === 'brush'
          ? 'none'
          : 'crosshair'
    const defaultCursorRef = useRef(defaultCursor)
    defaultCursorRef.current = defaultCursor
    const cursorRef = useRef(defaultCursor)
    const [cursor, setCursor] = useState(defaultCursor)

    const updateCursor = (next: string): void => {
      if (cursorRef.current === next) return
      cursorRef.current = next
      setCursor(next)
    }

    useEffect(() => {
      updateCursor(defaultCursorRef.current)
    }, [options.tool, options.mosaicMode])

    useEffect(() => {
      if (!textDraft) return
      const timer = window.setTimeout(() => textInputRef.current?.focus(), 0)
      return () => window.clearTimeout(timer)
    }, [textDraft])

    const styleNow = (): AnnoStyle => {
      const lineW =
        options.tool === 'shape'
          ? options.widths.shape
          : options.tool === 'arrow'
            ? options.widths.arrow
            : options.widths.pen
      return {
        color: options.color,
        lineW,
        lineStyle: options.lineStyle,
        arrowMode: options.arrowMode
      }
    }

    const redraw = (): void => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, sizeRef.current.width, sizeRef.current.height)
      for (const annotation of annotationsRef.current) {
        if (annotation.type === 'text' && annotation.id === editingTextIdRef.current) continue
        drawAnnotation(ctx, annotation, null, backgroundCanvasRef.current)
      }
      if (tempRef.current) {
        drawAnnotation(ctx, tempRef.current, null, backgroundCanvasRef.current)
      }
    }

    const notifyHistory = (): void => {
      onHistoryChange(historyRef.current.length > 0, redoRef.current.length > 0)
    }

    const snapshot = (): Annotation[] => cloneAnnotations(annotationsRef.current)

    const pushHistory = (): void => {
      historyRef.current.push(snapshot())
      if (historyRef.current.length > 60) historyRef.current.shift()
      redoRef.current = []
      notifyHistory()
    }

    const commit = (next: Annotation[]): void => {
      pushHistory()
      annotationsRef.current = next
      tempRef.current = null
      redraw()
      notifyHistory()
    }

    const undo = (): void => {
      const previous = historyRef.current.pop()
      if (!previous) return
      redoRef.current.push(snapshot())
      annotationsRef.current = previous
      tempRef.current = null
      redraw()
      notifyHistory()
    }

    const redo = (): void => {
      const next = redoRef.current.pop()
      if (!next) return
      historyRef.current.push(snapshot())
      annotationsRef.current = next
      tempRef.current = null
      redraw()
      notifyHistory()
    }

    const cancelInteraction = (): void => {
      drawingRef.current = false
      movingRef.current = null
      textDragRef.current = null
      gestureRef.current = null
      pendingLineRef.current = null
      textPendingRef.current = null
      tempRef.current = null
      updateCursor(defaultCursorRef.current)
      redraw()
    }

    const shift = (dx: number, dy: number): void => {
      if (!dx && !dy) return
      annotationsRef.current = annotationsRef.current.map((annotation) =>
        moveAnnotation(structuredClone(annotation), dx, dy)
      )
      if (tempRef.current) moveAnnotation(tempRef.current, dx, dy)
      setTextDraft((draft) =>
        draft ? { ...draft, x: draft.x + dx, y: draft.y + dy } : null
      )
      redraw()
    }

    const shiftHistory = (dx: number, dy: number): void => {
      if (!dx && !dy) return
      const shiftSnapshots = (snapshots: Annotation[][]): Annotation[][] =>
        snapshots.map((snapshot) =>
          snapshot.map((annotation) => moveAnnotation(structuredClone(annotation), dx, dy))
        )
      historyRef.current = shiftSnapshots(historyRef.current)
      redoRef.current = shiftSnapshots(redoRef.current)
    }

    useImperativeHandle(
      ref,
      () => ({
        undo,
        redo,
        getCanvas: () => canvasRef.current,
        shift,
        shiftHistory,
        cancelInteraction
      }),
      []
    )

    /**
     * 背景：马赛克需要选区内的原始像素，而且切到其他工具后旧马赛克仍要能重绘。
     * 设计意图：选区确定后始终保留一份按选区裁剪的背景画布，只做 drawImage，
     * 不再复制整屏 ImageData；成本低，同时避免切工具后马赛克退化成虚线框。
     * 关键约束：选区变化时重建背景画布，保证像素化坐标与当前画布一致。
     */
    useEffect(() => {
      backgroundCanvasRef.current = null
      const source = imageCanvasRef.current
      if (!source || !source.width || !source.height) return
      const scaleX = init.imageWidth / init.bounds.width
      const scaleY = init.imageHeight / init.bounds.height
      const width = Math.max(1, Math.round(selection.width))
      const height = Math.max(1, Math.round(selection.height))
      const offscreen = document.createElement('canvas')
      offscreen.width = width
      offscreen.height = height
      const offCtx = offscreen.getContext('2d')
      if (!offCtx) return
      offCtx.drawImage(
        source,
        selection.x * scaleX,
        selection.y * scaleY,
        selection.width * scaleX,
        selection.height * scaleY,
        0,
        0,
        width,
        height
      )
      backgroundCanvasRef.current = offscreen
      redraw()
    }, [
      imageCanvasRef,
      init.imageWidth,
      init.imageHeight,
      init.bounds.width,
      init.bounds.height,
      selection.x,
      selection.y,
      selection.width,
      selection.height
    ])

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = Math.max(1, Math.round(selection.width * dpr))
      canvas.height = Math.max(1, Math.round(selection.height * dpr))
      canvas.style.width = `${selection.width}px`
      canvas.style.height = `${selection.height}px`
      redraw()
    }, [selection.width, selection.height])

    const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
      const rect = event.currentTarget.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    const hitIndex = (point: Point, tool = options.tool): number => {
      const annotations = annotationsRef.current
      for (let i = annotations.length - 1; i >= 0; i -= 1) {
        if (
          canMoveAnnotationWithTool(annotations[i], tool) &&
          hitTestAnnotation(annotations[i], point)
        ) {
          return i
        }
      }
      return -1
    }

    const cursorForPoint = (point: Point): string => {
      if (options.tool === 'mosaic' && options.mosaicMode === 'brush') return 'none'
      if (options.tool === 'text') return hitIndex(point, 'text') >= 0 ? 'move' : 'text'
      if (options.tool === 'seq') return 'text'
      if (options.tool === 'shape' || options.tool === 'arrow') {
        return hitIndex(point) >= 0 ? 'move' : 'crosshair'
      }
      return 'crosshair'
    }

    const beginTextEdit = (annotation: TextAnno): void => {
      editingTextIdRef.current = annotation.id
      onTextInputStart(annotation)
      setTextDraft({
        x: annotation.x,
        y: annotation.y,
        value: annotation.text,
        annotationId: annotation.id,
        source: annotation
      })
      redraw()
    }

    const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const point = pointFromEvent(event)
      const hit = hitIndex(point)
      if (options.tool === 'text') {
        if (hit >= 0) {
          textDragRef.current = {
            index: hit,
            start: point,
            original: structuredClone(annotationsRef.current[hit]),
            moved: false
          }
          updateCursor('move')
          return
        }
        editingTextIdRef.current = null
        textPendingRef.current = point
        return
      }
      if (options.tool === 'seq') {
        commit([
          ...annotationsRef.current,
          {
            id: crypto.randomUUID(),
            type: 'seq',
            x: point.x,
            y: point.y,
            n: ++seqRef.current,
            style: styleNow()
          }
        ])
        return
      }
      if (pendingLineRef.current) {
        const start = pendingLineRef.current
        pendingLineRef.current = null
        tempRef.current = null
        const length = Math.hypot(point.x - start.x1, point.y - start.y1)
        if (length >= 4) {
          commit([
            ...annotationsRef.current,
            {
              id: crypto.randomUUID(),
              type: 'arrow',
              x1: start.x1,
              y1: start.y1,
              x2: point.x,
              y2: point.y,
              style: styleNow()
            }
          ])
        } else {
          redraw()
        }
        return
      }
      if (hit >= 0) {
        pushHistory()
        movingRef.current = {
          index: hit,
          start: point,
          original: structuredClone(annotationsRef.current[hit])
        }
        updateCursor('move')
        return
      }
      drawingRef.current = true
      if (options.tool === 'arrow') {
        gestureRef.current = { start: point, points: [point], moved: false }
      } else if (options.tool === 'mosaic') {
        const mosaic: MosaicAnno = {
          id: crypto.randomUUID(),
          type: 'mosaic',
          x1: point.x,
          y1: point.y,
          x2: point.x,
          y2: point.y,
          mode: options.mosaicMode,
          size: options.mosaicSize,
          brushSize: options.mosaicBrushSize,
          cells: options.mosaicMode === 'brush' ? [{ x: point.x, y: point.y }] : [],
          style: styleNow()
        }
        tempRef.current = mosaic
        redraw()
      } else {
        tempRef.current = {
          id: crypto.randomUUID(),
          type: options.shapeKind,
          x1: point.x,
          y1: point.y,
          x2: point.x,
          y2: point.y,
          fill: false,
          style: styleNow()
        }
        redraw()
      }
    }

    const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      const point = pointFromEvent(event)
      if (movingRef.current) {
        const moving = movingRef.current
        const next = cloneAnnotations(annotationsRef.current)
        const moved = structuredClone(moving.original)
        moveAnnotation(moved, point.x - moving.start.x, point.y - moving.start.y)
        next[moving.index] = moved
        annotationsRef.current = next
        updateCursor('move')
        redraw()
        return
      }
      if (textDragRef.current) {
        const drag = textDragRef.current
        if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 4) {
          drag.moved = true
          pushHistory()
          updateCursor('move')
        }
        if (drag.moved) {
          const next = cloneAnnotations(annotationsRef.current)
          const moved = structuredClone(drag.original)
          moveAnnotation(moved, point.x - drag.start.x, point.y - drag.start.y)
          next[drag.index] = moved
          annotationsRef.current = next
          redraw()
        }
        return
      }
      if (gestureRef.current) {
        const gesture = gestureRef.current
        if (!gesture.moved && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 4) {
          gesture.moved = true
        }
        if (gesture.moved) {
          const last = gesture.points[gesture.points.length - 1]
          if (Math.hypot(point.x - last.x, point.y - last.y) > 1.5) gesture.points.push(point)
          const line: LineAnno = {
            id: crypto.randomUUID(),
            type: 'pen',
            x1: gesture.start.x,
            y1: gesture.start.y,
            x2: point.x,
            y2: point.y,
            points: gesture.points.slice(),
            style: styleNow()
          }
          tempRef.current = line
          redraw()
        }
        return
      }
      if (pendingLineRef.current) {
        const start = pendingLineRef.current
        tempRef.current = {
          id: crypto.randomUUID(),
          type: 'arrow',
          x1: start.x1,
          y1: start.y1,
          x2: point.x,
          y2: point.y,
          style: styleNow()
        }
        redraw()
        return
      }
      if (!drawingRef.current || !tempRef.current) {
        updateCursor(cursorForPoint(point))
        return
      }
      const temp = tempRef.current
      if (temp.type === 'rect' || temp.type === 'ellipse' || temp.type === 'mosaic') {
        temp.x2 = point.x
        temp.y2 = point.y
        if (temp.type === 'mosaic' && temp.mode === 'brush') {
          const last = temp.cells[temp.cells.length - 1]
          if (last) appendMosaicBrushCells(temp.cells, last, point, temp.size)
          else temp.cells.push({ x: point.x, y: point.y })
        }
        redraw()
      }
    }

    const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // pointer capture 可能已释放
      }
      if (movingRef.current) {
        movingRef.current = null
        redraw()
        return
      }
      if (textDragRef.current) {
        const drag = textDragRef.current
        textDragRef.current = null
        if (drag.moved) {
          redraw()
          updateCursor(defaultCursorRef.current)
          return
        }
        const annotation = annotationsRef.current[drag.index]
        if (annotation?.type === 'text') beginTextEdit(annotation)
        return
      }
      if (textPendingRef.current) {
        const point = textPendingRef.current
        textPendingRef.current = null
        editingTextIdRef.current = null
        onTextInputStart()
        setTextDraft({ x: point.x, y: point.y, value: '' })
        return
      }
      if (gestureRef.current) {
        const gesture = gestureRef.current
        gestureRef.current = null
        drawingRef.current = false
        if (gesture.moved) {
          const temp = tempRef.current
          tempRef.current = null
          if (temp && temp.type === 'pen' && temp.points && temp.points.length > 1) {
            commit([...annotationsRef.current, temp])
          } else {
            redraw()
          }
        } else {
          pendingLineRef.current = { x1: gesture.start.x, y1: gesture.start.y }
          tempRef.current = {
            id: crypto.randomUUID(),
            type: 'arrow',
            x1: gesture.start.x,
            y1: gesture.start.y,
            x2: gesture.start.x,
            y2: gesture.start.y,
            style: styleNow()
          }
          redraw()
        }
        return
      }
      if (!drawingRef.current || !tempRef.current) return
      drawingRef.current = false
      const temp = tempRef.current
      tempRef.current = null
      if (temp.type === 'mosaic') {
        if (temp.mode === 'rect') {
          const rect = {
            x: Math.min(temp.x1, temp.x2),
            y: Math.min(temp.y1, temp.y2),
            width: Math.abs(temp.x2 - temp.x1),
            height: Math.abs(temp.y2 - temp.y1)
          }
          if (rect.width > 4 && rect.height > 4) {
            commit([...annotationsRef.current, temp])
            return
          }
        } else {
          // 补上最后一个鼠标位置，保证快速拖动的末端也被覆盖。
          const last = temp.cells[temp.cells.length - 1]
          if (last && Math.hypot(temp.x2 - last.x, temp.y2 - last.y) > 0.5) {
            temp.cells.push({ x: temp.x2, y: temp.y2 })
          }
          if (temp.cells.length > 0) {
            commit([...annotationsRef.current, temp])
            return
          }
        }
        redraw()
        return
      }
      if (temp.type !== 'rect' && temp.type !== 'ellipse') {
        redraw()
        return
      }
      const width = Math.abs(temp.x2 - temp.x1)
      const height = Math.abs(temp.y2 - temp.y1)
      if (width > 4 || height > 4) commit([...annotationsRef.current, temp])
      else redraw()
    }

    const handleDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>): void => {
      const rect = event.currentTarget.getBoundingClientRect()
      const index = hitIndex(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        options.tool
      )
      if (index < 0) return
      const annotation = annotationsRef.current[index]
      if (annotation.type === 'text') {
        beginTextEdit(annotation)
        return
      }
      pushHistory()
      annotationsRef.current = annotationsRef.current.filter((_, i) => i !== index)
      redraw()
      notifyHistory()
    }

    const commitText = (): void => {
      if (!textDraft) return
      const value = textDraft.value.trim()
      setTextDraft(null)
      const editingId = editingTextIdRef.current
      editingTextIdRef.current = null
      if (!value) {
        redraw()
        return
      }
      const fontSize = options.fontSize
      const fontFamily = options.fontFamily
      const bold = options.textB
      const italic = options.textI
      const measure = canvasRef.current?.getContext('2d')
      let measuredWidth: number | undefined
      if (measure) {
        measure.save()
        measure.font = `${italic ? 'italic ' : ''}${bold ? '700 ' : '400 '}${fontSize}px ${fontFamily}`
        measuredWidth = measure.measureText(value).width
        measure.restore()
      }
      if (editingId) {
        pushHistory()
        annotationsRef.current = annotationsRef.current.map((annotation) =>
          annotation.id === editingId && annotation.type === 'text'
            ? {
                ...annotation,
                text: value,
                width: measuredWidth,
                fontSize: options.fontSize,
                fontFamily: options.fontFamily,
                bold: options.textB,
                italic: options.textI,
                underline: options.textU,
                style: { ...annotation.style, color: options.color }
              }
            : annotation
        )
        redraw()
        notifyHistory()
        return
      }
      commit([
        ...annotationsRef.current,
        {
          id: crypto.randomUUID(),
          type: 'text',
          x: textDraft.x,
          y: textDraft.y,
          text: value,
          width: measuredWidth,
          fontSize: options.fontSize,
          fontFamily: options.fontFamily,
          bold: options.textB,
          italic: options.textI,
          underline: options.textU,
          style: styleNow()
        }
      ])
    }

    return (
      <div className="anno-wrap" style={{ left: selection.x, top: selection.y }}>
        <canvas
          ref={canvasRef}
          className="anno-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => {
            if (!drawingRef.current && !movingRef.current && !textDragRef.current) {
              updateCursor(defaultCursorRef.current)
            }
          }}
          onDoubleClick={handleDoubleClick}
          onContextMenu={(event) => {
            event.preventDefault()
            if (pendingLineRef.current) {
              pendingLineRef.current = null
              tempRef.current = null
              redraw()
            }
          }}
          style={{ cursor }}
        />
        {textDraft && (
          <input
            ref={textInputRef}
            className="text-draft"
            autoFocus
            onPointerDown={(event) => event.stopPropagation()}
            value={textDraft.value}
            onChange={(event) => setTextDraft({ ...textDraft, value: event.target.value })}
            onBlur={(event) => {
              const next = event.relatedTarget as HTMLElement | null
              if (next?.closest('.tooldock')) return
              commitText()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
                commitText()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setTextDraft(null)
                editingTextIdRef.current = null
                redraw()
              }
            }}
            style={{
              left: textDraft.x,
              top: textDraft.y,
              color: options.color,
              fontSize: options.fontSize,
              fontFamily: options.fontFamily,
              fontWeight: options.textB ? 700 : 400,
              fontStyle: options.textI ? 'italic' : 'normal',
              textDecoration: options.textU ? 'underline' : 'none'
            }}
          />
        )}
      </div>
    )
  }
)
