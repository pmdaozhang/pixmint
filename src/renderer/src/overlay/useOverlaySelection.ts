import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { Rect, TextAnno, Tool } from '../../../shared/types'
import { normalizeRect, pointInRect } from '../../../shared/geometry'
import type { AnnotationCanvasHandle } from './AnnotationCanvas'
import { DEFAULT_OPTIONS, type OverlayOptions } from './options'
import {
  MIN_SELECTION,
  RESIZE_DIRS,
  annotationShiftForSelection,
  moveSelectionRect,
  resizeSelectionRect,
  type ResizeDir
} from './selection-geometry'

export type OverlayPhase = 'selecting' | 'editing'

interface OverlaySelectionOptions {
  annotationRef: { current: AnnotationCanvasHandle | null }
  brushCursorRef: { current: HTMLDivElement | null }
  hoverRect: Rect | null
  querySnap(point: { x: number; y: number }): void
  cancelSnap(): void
}

/**
 * 背景：选择、拖拽、缩放、工具状态和注释引用互相耦合，散在一个组件里很容易出现状态竞争。
 * 设计意图：集中管理选区状态和指针手势，主组件只负责窗口和导出。
 * 关键约束：点击窗口吸附区域要直接进入编辑；拖动超过阈值后必须取消 hover；缩放时同步移动注释。
 */
export function useOverlaySelection(options: OverlaySelectionOptions) {
  const { annotationRef, brushCursorRef, hoverRect, querySnap, cancelSnap } = options
  const [selection, setSelection] = useState<Rect | null>(null)
  const [phase, setPhase] = useState<OverlayPhase>('selecting')
  const [toolOptions, setToolOptions] = useState<OverlayOptions>(DEFAULT_OPTIONS)
  const [submenuOpen, setSubmenuOpen] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [selectionDragging, setSelectionDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [resizeDir, setResizeDir] = useState<ResizeDir | null>(null)
  // 同步记录拖拽方向，供放大镜在第一次 pointermove 时就拿到正确方向，
  // 不依赖 React state 提交时机。
  const resizeDirRef = useRef<ResizeDir | null>(null)
  const selectionRef = useRef<Rect | null>(null)
  // 选区整体移动时累计的标注补偿量，松手后同步到撤销/重做历史。
  const moveShiftRef = useRef({ x: 0, y: 0 })
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
  const selectionDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startRect: Rect
  } | null>(null)

  const updateSelection = useCallback((next: Rect | null) => {
    selectionRef.current = next
    setSelection(next)
  }, [])

  const resetSelection = useCallback(() => {
    updateSelection(null)
    setPhase('selecting')
    setToolOptions(DEFAULT_OPTIONS)
    setSubmenuOpen(false)
    setCanUndo(false)
    setCanRedo(false)
    selectionDragRef.current = null
    moveShiftRef.current = { x: 0, y: 0 }
    setSelectionDragging(false)
    setResizing(false)
    resizeDirRef.current = null
    setResizeDir(null)
  }, [updateSelection])

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
      toolOptions.tool !== 'mosaic' ||
      toolOptions.mosaicMode !== 'brush' ||
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

  const onSelectDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('.tooldock, .toolbar-position, .text-draft, .rec-bar-position')) {
      return
    }
    if (phase === 'editing') {
      if (toolOptions.tool !== 'move') return
      const current = selectionRef.current
      if (!current) return
      const p = point(event)
      if (!pointInRect(p, current)) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      selectionDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startRect: current
      }
      moveShiftRef.current = { x: 0, y: 0 }
      setSelectionDragging(true)
      return
    }
    const p = point(event)
    dragRef.current = {
      startX: p.x,
      startY: p.y,
      dragging: true,
      moved: false,
      hover: hoverRect
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    cancelSnap()
    updateSelection({ x: p.x, y: p.y, width: 0, height: 0 })
  }

  const onSelectMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const selectionDrag = selectionDragRef.current
    if (selectionDrag) {
      event.preventDefault()
      const next = moveSelectionRect(
        selectionDrag.startRect,
        event.clientX - selectionDrag.startX,
        event.clientY - selectionDrag.startY,
        window.innerWidth,
        window.innerHeight
      )
      // 整体移动选区时，标注要固定在原屏幕位置：画布跟着选区走，
      // 就把标注朝反方向平移同样的距离。
      // 标注的实时平移由 AnnotationCanvas 在 layout effect 里随选区原点变化完成，
      // 这里只累计补偿量，松手后同步到撤销/重做历史。
      const current = selectionRef.current
      if (current) {
        const { dx, dy } = annotationShiftForSelection(current, next)
        moveShiftRef.current.x += dx
        moveShiftRef.current.y += dy
      }
      updateSelection(next)
      return
    }
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
      cancelSnap()
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
    const selectionDrag = selectionDragRef.current
    if (selectionDrag) {
      selectionDragRef.current = null
      setSelectionDragging(false)
      const shift = moveShiftRef.current
      if (shift.x || shift.y) annotationRef.current?.shiftHistory(shift.x, shift.y)
      moveShiftRef.current = { x: 0, y: 0 }
      try {
        event.currentTarget.releasePointerCapture(selectionDrag.pointerId)
      } catch {
        // ignore
      }
      return
    }
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
      cancelSnap()
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
    setResizing(true)
    resizeDirRef.current = dir
    setResizeDir(dir)
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
      // 拖左边/上边控制点时选区原点会变化。实时平移由 AnnotationCanvas
      // 在 layout effect 里完成，这里只累计补偿量，松手后同步到撤销/重做历史。
      const { dx, dy } = annotationShiftForSelection(current, next)
      totalShiftX += dx
      totalShiftY += dy
      updateSelection(next)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      setResizing(false)
      resizeDirRef.current = null
      setResizeDir(null)
      if (totalShiftX || totalShiftY) {
        annotationRef.current?.shiftHistory(totalShiftX, totalShiftY)
      }
    }
    // 捕获阶段先更新选区，放大镜（冒泡阶段）再读 selectionRef 时拿到的就是最新值。
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, { once: true, capture: true })
  }

  const onToolClick = useCallback(
    (tool: Tool): void => {
      if (tool === 'move') {
        annotationRef.current?.cancelInteraction()
        setToolOptions((previous) => ({ ...previous, tool }))
        setSubmenuOpen(false)
        return
      }
      if (toolOptions.tool === tool) {
        // 第二次点击同一个工具 = 取消选中，回到默认的移动/十字状态。
        annotationRef.current?.cancelInteraction()
        setToolOptions((previous) => ({ ...previous, tool: 'move' }))
        setSubmenuOpen(false)
        return
      }
      annotationRef.current?.cancelInteraction()
      setToolOptions((previous) => ({ ...previous, tool }))
      setSubmenuOpen(true)
    },
    [annotationRef, toolOptions.tool]
  )

  const onTextInputStart = useCallback((annotation?: TextAnno): void => {
    setToolOptions((previous) => ({
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

  const setOptions = useCallback((patch: Partial<OverlayOptions>) => {
    setToolOptions((previous) => ({ ...previous, ...patch }))
  }, [])

  const onHistoryChange = useCallback((undo: boolean, redo: boolean): void => {
    setCanUndo(undo)
    setCanRedo(redo)
  }, [])

  const closeSubmenu = useCallback(() => setSubmenuOpen(false), [])

  return {
    selection,
    phase,
    options: toolOptions,
    submenuOpen,
    canUndo,
    canRedo,
    selectionDragging,
    resizing,
    resizeDir,
    resizeDirRef,
    selectionRef,
    updateSelection,
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
    isDragging: () => dragRef.current.dragging || selectionDragRef.current !== null
  }
}
