import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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
  Point,
  Rect,
  RectAnno,
  TextAnno
} from '@shared/types'
import {
  annotationBounds,
  appendMosaicBrushCells,
  canMoveAnnotationWithTool,
  cloneAnnotations,
  hitTestAnnotation,
  isInBorderBand,
  moveAnnotation
} from '@shared/annotation-utils'
import { layoutText } from '@shared/text-layout'
import { drawAnnotation } from './annotation/draw'
import {
  SPOTLIGHT_MASK_COLOR,
  type OverlayOptions
} from './options'
import { planSpotlightDraw, spotlightHoles } from './annotation/spotlight'

const FONT_SIZE_MIN = 14
const FONT_SIZE_MAX = 60

export interface AnnotationCanvasHandle {
  undo(): void
  redo(): void
  getCanvas(): HTMLCanvasElement | null
  shift(dx: number, dy: number): void
  shiftHistory(dx: number, dy: number): void
  cancelInteraction(): void
}

interface Props {
  imageWidth: number
  imageHeight: number
  bounds: Rect
  imageCanvasRef: RefObject<HTMLCanvasElement | null>
  selection: Rect
  options: OverlayOptions
  selectionDragging?: boolean
  moveCursor?: 'grab' | 'crosshair'
  onTextInputStart(annotation?: TextAnno): void
  onHistoryChange(canUndo: boolean, canRedo: boolean): void
  /** 文字超出截图选区时触发，由覆盖层弹 toast 提示 */
  onTextOverflow?(): void
  /** 滚轮调节文字字号（14–60） */
  onFontSizeChange?(size: number): void
  /** 双击空白区域（未命中任何标注）时触发，用于快速结束截图 */
  onEmptyDoubleClick?(): void
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
    {
      imageWidth,
      imageHeight,
      bounds,
      imageCanvasRef,
      selection,
      options,
      selectionDragging = false,
      moveCursor = 'crosshair',
      onTextInputStart,
      onHistoryChange,
      onTextOverflow,
      onFontSizeChange,
      onEmptyDoubleClick
    },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const backgroundCanvasRef = useRef<HTMLCanvasElement | null>(null)
    // 聚光灯亮区遮罩图：复用同一张画布，避免每次重绘都分配新 GPU 纹理。
    const spotlightMaskRef = useRef<HTMLCanvasElement | null>(null)
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
    // 编辑态：textarea 边框环带按下可整体移动输入框。
    const editorDragRef = useRef<{
      startX: number
      startY: number
      origX: number
      origY: number
    } | null>(null)
    const gestureRef = useRef<{ start: Point; points: Point[]; moved: boolean } | null>(null)
    const pendingLineRef = useRef<{ x1: number; y1: number } | null>(null)
    const textPendingRef = useRef<Point | null>(null)
    const textInputRef = useRef<HTMLTextAreaElement | null>(null)
    const editingTextIdRef = useRef<string | null>(null)
    const seqRef = useRef(0)
    const sizeRef = useRef({ width: selection.width, height: selection.height })
    const originRef = useRef({ x: selection.x, y: selection.y })
    const [textDraft, setTextDraft] = useState<TextDraft | null>(null)

    const dpr = window.devicePixelRatio || 1
    sizeRef.current = { width: selection.width, height: selection.height }
    const moveToolCursor =
      moveCursor === 'grab' ? (selectionDragging ? 'grabbing' : 'grab') : 'crosshair'
    const defaultCursor =
      options.tool === 'move'
        ? moveToolCursor
        : options.tool === 'text' || options.tool === 'seq'
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
    }, [options.tool, options.mosaicMode, selectionDragging])

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
      const plan = planSpotlightDraw(annotationsRef.current, tempRef.current, editingTextIdRef.current)
      // 顺序：非聚光灯标注 → 遮罩（洞外黑纱整张叠加）→ 聚光灯形状。
      // 顺序错了会直接出现“聚光灯被压暗”，见 annotation/spotlight.ts。
      for (const annotation of plan.base) {
        drawAnnotation(ctx, annotation, null, backgroundCanvasRef.current)
      }
      drawSpotlightMasks(ctx)
      for (const annotation of plan.spotlit) {
        drawAnnotation(ctx, annotation, null, backgroundCanvasRef.current)
      }
      // 遮罩改为「洞外黑纱」整张叠加（见 drawSpotlightMasks），亮区里的标注
      // 从未被擦掉，不需要任何重描补救层。
    }

    /**
     * 聚光灯是“全局压暗”效果：所有聚光灯形状的并集被挖空，其余区域盖一层半透明黑色。
     * 关键约束：
     * - 遮罩只作用于选区画布，不改变选区尺寸和导出分辨率。
     * - 黑纱和挖洞全部在遮罩画布上完成，再整张 source-over 叠到主画布：
     *   亮区完全透明、标注原样保留（2026-11-21 之前在主画布上挖洞，会把亮区
     *   内已画好的标注一起擦掉，只能靠半透明重描补救，用户看到“蒙白纱”）。
     * - 洞重叠处不会变暗：destination-out 对同一像素多擦一次结果不变。
     */
    const drawSpotlightMasks = (ctx: CanvasRenderingContext2D): void => {
      const holes = spotlightHoles(annotationsRef.current, tempRef.current)
      if (!holes.length) return
      const width = sizeRef.current.width
      const height = sizeRef.current.height
      const mask = spotlightMaskRef.current ?? document.createElement('canvas')
      spotlightMaskRef.current = mask
      mask.width = Math.max(1, Math.ceil(width))
      mask.height = Math.max(1, Math.ceil(height))
      const maskCtx = mask.getContext('2d')
      if (!maskCtx) return
      // 关键约束（2026-11-21 用户实测根因）：
      // 不能「先在主画布上盖全屏黑、再用 destination-out 挖洞」——那会把亮区里
      // 已画好的箭头/文字/序号一起擦掉，只能靠遮罩后的半透明重描补回来，
      // 看起来就像蒙了一层白纱。正确做法：全部操作在遮罩画布上完成——
      // 先铺满整屏黑纱，再用 destination-out 擦掉洞（擦的是遮罩画布自己的黑纱，
      // 碰不到主画布上的标注），最后整张 source-over 叠到主画布：
      // 洞内（亮区）完全透明、标注原样保留；洞外压暗 55%，这是聚光灯本意。
      maskCtx.clearRect(0, 0, mask.width, mask.height)
      maskCtx.save()
      maskCtx.fillStyle = SPOTLIGHT_MASK_COLOR
      maskCtx.fillRect(0, 0, mask.width, mask.height)
      maskCtx.globalCompositeOperation = 'destination-out'
      maskCtx.fillStyle = '#000'
      for (const hole of holes) {
        maskCtx.beginPath()
        if (hole.type === 'rect') {
          maskCtx.rect(hole.x, hole.y, hole.width, hole.height)
        } else {
          // 外扩用同一个中心、半径同加 pad（统一外扩），而不是直接把椭圆放大。
          maskCtx.ellipse(
            hole.x + hole.width / 2,
            hole.y + hole.height / 2,
            hole.width / 2,
            hole.height / 2,
            0,
            0,
            Math.PI * 2
          )
        }
        // 洞重叠处不会重新变黑：destination-out 对同一像素多擦一次结果不变。
        maskCtx.fill()
      }
      maskCtx.restore()
      ctx.drawImage(mask, 0, 0)
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

    /**
     * 导出用的标注合成：屏幕画布 + 聚光灯遮罩。
     * 屏幕上的暗场由 OverlayApp 的选区层负责，标注画布本身是透明的；
     * 但保存/复制/钉图必须带上聚光灯效果，所以导出时把遮罩画进来。
     * 关键约束：导出画布必须是「图片之上的黑色半透明层」，由调用方先铺底图再叠加。
     */
    const exportCanvasRef = useRef<HTMLCanvasElement | null>(null)
    const getExportCanvas = (): HTMLCanvasElement | null => {
      const source = canvasRef.current
      if (!source) return null
      const canvas = exportCanvasRef.current ?? document.createElement('canvas')
      exportCanvasRef.current = canvas
      // 关键：导出画布不能重设尺寸。同尺寸重新赋值 width 也会清空画布并重置合成状态，
      // 之前遮罩生效后边框消失就是踩在这里；只在尺寸真的变了时才重建。
      if (canvas.width !== source.width || canvas.height !== source.height) {
        canvas.width = source.width
        canvas.height = source.height
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (!spotlightHoles(annotationsRef.current, null).length) {
        ctx.drawImage(source, 0, 0)
        return canvas
      }
      // 显式重放绘制顺序，而不是直接叠源画布：
      // 源画布上遮罩盖在聚光灯形状之上，整体拷贝过去会连聚光灯边框一起压暗。
      // 导出里必须是「非聚光灯标注 → 遮罩 → 聚光灯形状」，与屏幕顺序一致。
      const plan = planSpotlightDraw(annotationsRef.current, null, null)
      ctx.save()
      ctx.scale(dpr, dpr)
      for (const annotation of plan.base) {
        drawAnnotation(ctx, annotation, null, backgroundCanvasRef.current)
      }
      drawSpotlightMasks(ctx)
      for (const annotation of plan.spotlit) {
        drawAnnotation(ctx, annotation, null, backgroundCanvasRef.current)
      }
      ctx.restore()
      return canvas
    }

    useImperativeHandle(
      ref,
      () => ({
        undo,
        redo,
        getCanvas: getExportCanvas,
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
    useLayoutEffect(() => {
      backgroundCanvasRef.current = null
      const width = Math.max(1, Math.round(selection.width))
      const height = Math.max(1, Math.round(selection.height))
      const offscreen = document.createElement('canvas')
      offscreen.width = width
      offscreen.height = height
      const offCtx = offscreen.getContext('2d')
      if (!offCtx) return
      backgroundCanvasRef.current = offscreen
      // 没有源图（编辑态预热阶段）时也要先把离屏画布分配出来，
      // 否则真正的第一次框选才会触发这块 GPU 资源分配，卡住整帧呈现。
      const source = imageCanvasRef.current
      if (source && source.width && source.height) {
        const scaleX = imageWidth / bounds.width
        const scaleY = imageHeight / bounds.height
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
      }
      redraw()
    }, [
      imageCanvasRef,
      imageWidth,
      imageHeight,
      bounds.width,
      bounds.height,
      selection.x,
      selection.y,
      selection.width,
      selection.height
    ])

    useLayoutEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = Math.max(1, Math.round(selection.width * dpr))
      canvas.height = Math.max(1, Math.round(selection.height * dpr))
      redraw()
    }, [selection.width, selection.height])

    /**
     * 背景：标注坐标是相对画布的，画布原点跟着选区走。
     * 设计意图：选区左上角变化时，在同一帧内把标注反向平移，保证标注固定在屏幕坐标上。
     * 关键约束：必须在 layout effect 里做，不能放在指针事件里同步 redraw，
     * 否则画布内容和元素位置会分属两帧，拖动时出现来回抖动。
     */
    useLayoutEffect(() => {
      const previous = originRef.current
      originRef.current = { x: selection.x, y: selection.y }
      const dx = previous.x - selection.x
      const dy = previous.y - selection.y
      if (!dx && !dy) return
      annotationsRef.current = annotationsRef.current.map((annotation) =>
        moveAnnotation(structuredClone(annotation), dx, dy)
      )
      if (tempRef.current) moveAnnotation(tempRef.current, dx, dy)
      setTextDraft((draft) => (draft ? { ...draft, x: draft.x + dx, y: draft.y + dy } : null))
      redraw()
    }, [selection.x, selection.y])

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
      if (options.tool === 'move') return moveToolCursor
      if (options.tool === 'mosaic' && options.mosaicMode === 'brush') return 'none'
      if (options.tool === 'text') {
        const index = hitIndex(point, 'text')
        if (index >= 0) {
          const annotation = annotationsRef.current[index]
          return annotation && isInBorderBand(point, annotationBounds(annotation))
            ? 'move'
            : 'text'
        }
        return 'text'
      }
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
      if (options.tool === 'move') return
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const point = pointFromEvent(event)
      const hit = hitIndex(point)
      // 正在编辑的文字草稿必须先落盘再处理新的按下（2026-11-21 用户实测：
      // 聚光灯下换位置输入第二段，第一段自动消失）。原本依赖 textarea 的
      // blur 触发 commitText，聚光灯开启时每次重绘都重建遮罩，blur 与重绘
      // 的先后被搅乱，草稿在切换瞬间被清空。这里在状态机入口直接提交，
      // 不再依赖任何时序。
      if (textDraft) commitText()
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
          spotlight: options.spotlight,
          style: styleNow()
        }
        redraw()
      }
    }

    const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (options.tool === 'move') {
        updateCursor(moveToolCursor)
        return
      }
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
      if (options.tool === 'move') return
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
      if (index < 0) {
        onEmptyDoubleClick?.()
        return
      }
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

    /** 滚轮调节字号：仅文字工具，范围 14–60，步长 2。 */
    const changeFontSize = (delta: number): void => {
      if (options.tool !== 'text') return
      const next = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, options.fontSize + delta))
      if (next !== options.fontSize) onFontSizeChange?.(next)
    }

    // React 的 onWheel 是 passive，无法 preventDefault；改用原生 non-passive 监听。
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const onWheel = (event: WheelEvent): void => {
        if (options.tool !== 'text') return
        event.preventDefault()
        changeFontSize(event.deltaY < 0 ? 2 : -2)
      }
      canvas.addEventListener('wheel', onWheel, { passive: false })
      return () => canvas.removeEventListener('wheel', onWheel)
    }, [options.tool, options.fontSize])

    useEffect(() => {
      const element = textInputRef.current
      if (!textDraft || !element) return
      const onWheel = (event: WheelEvent): void => {
        event.preventDefault()
        changeFontSize(event.deltaY < 0 ? 2 : -2)
      }
      element.addEventListener('wheel', onWheel, { passive: false })
      return () => element.removeEventListener('wheel', onWheel)
    }, [textDraft, options.tool, options.fontSize])

    const measureText = (text: string): number => {
      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) return text.length * options.fontSize
      ctx.save()
      ctx.font = `${options.textI ? 'italic ' : ''}${options.textB ? '700 ' : '400 '}${options.fontSize}px ${options.fontFamily}`
      const width = ctx.measureText(text).width
      ctx.restore()
      return width
    }

    /**
     * 输入框宽度随内容自适应，但最大不超过选区剩余宽度；高度随换行增长，
     * 最大不超过选区剩余高度。超出任一限制就拒绝本次输入并弹 toast。
     */
    const handleTextChange = (value: string): void => {
      if (!textDraft) return
      const maxWidth = Math.max(0, selection.width - textDraft.x)
      const maxHeight = Math.max(0, selection.height - textDraft.y)
      const layout = layoutText(value, measureText, options.fontSize, maxWidth, maxHeight)
      if (layout.overflow) {
        onTextOverflow?.()
        return
      }
      setTextDraft({ ...textDraft, value })
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
      const layout = layoutText(
        value,
        measureText,
        fontSize,
        Math.max(1, selection.width - textDraft.x),
        Number.POSITIVE_INFINITY
      )
      const measuredWidth = layout.width
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
          style={{ cursor, width: selection.width, height: selection.height }}
        />
        {textDraft && (
          <textarea
            ref={textInputRef}
            className="text-draft"
            autoFocus
            rows={1}
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              const px = event.clientX - rect.left
              const py = event.clientY - rect.top
              const onBand = isInBorderBand(
                { x: px, y: py },
                { x: 0, y: 0, width: rect.width, height: rect.height }
              )
              if (!onBand) {
                event.stopPropagation()
                return
              }
              // 边框环带：按下后拖动整框，不进入文本选择。
              event.preventDefault()
              event.stopPropagation()
              event.currentTarget.setPointerCapture(event.pointerId)
              editorDragRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                origX: textDraft.x,
                origY: textDraft.y
              }
            }}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              const px = event.clientX - rect.left
              const py = event.clientY - rect.top
              const drag = editorDragRef.current
              if (drag) {
                const nextX = Math.max(
                  0,
                  Math.min(selection.width - 8, drag.origX + event.clientX - drag.startX)
                )
                const nextY = Math.max(
                  0,
                  Math.min(selection.height - 8, drag.origY + event.clientY - drag.startY)
                )
                setTextDraft((draft) => (draft ? { ...draft, x: nextX, y: nextY } : draft))
                return
              }
              const onBand = isInBorderBand(
                { x: px, y: py },
                { x: 0, y: 0, width: rect.width, height: rect.height }
              )
              event.currentTarget.style.cursor = onBand ? 'move' : 'text'
            }}
            onPointerUp={(event) => {
              editorDragRef.current = null
              event.currentTarget.style.cursor = 'text'
            }}
            onPointerLeave={(event) => {
              if (!editorDragRef.current) event.currentTarget.style.cursor = 'text'
            }}
            value={textDraft.value}
            onChange={(event) => handleTextChange(event.target.value)}
            onBlur={(event) => {
              const next = event.relatedTarget as HTMLElement | null
              if (next?.closest('.tooldock')) return
              commitText()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
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
              maxWidth: Math.max(0, selection.width - textDraft.x),
              maxHeight: Math.max(0, selection.height - textDraft.y),
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
