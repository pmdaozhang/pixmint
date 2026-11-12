import { useCallback, useEffect, useRef, type JSX, type RefObject } from 'react'
import type { Language } from '@shared/i18n'
import { t } from '@shared/i18n'
import type { OverlayInit } from '@shared/types'
import { clampSourceRect, toHex, toRgbText, type RgbColor } from './color-picker'

const ZOOM = 10
const PANEL_WIDTH = 160
const PANEL_HEIGHT = 80
const SOURCE_WIDTH = PANEL_WIDTH / ZOOM
const SOURCE_HEIGHT = PANEL_HEIGHT / ZOOM
const CURSOR_OFFSET = 18
const EDGE_MARGIN = 8
const OUTSIDE_GAP = 12
const INSIDE_GAP = 12

interface PanelRect {
  x: number
  y: number
  width: number
  height: number
}

function clampPanel(left: number, top: number, width: number, height: number): {
  left: number
  top: number
} {
  return {
    left: Math.max(EDGE_MARGIN, Math.min(left, window.innerWidth - width - EDGE_MARGIN)),
    top: Math.max(EDGE_MARGIN, Math.min(top, window.innerHeight - height - EDGE_MARGIN))
  }
}

type EdgeSide = 'left' | 'right' | 'top' | 'bottom'

/**
 * 拖拽控制点时，只考虑控制点所在的那条边（角点考虑相邻两条边），
 * 永远不把放大镜挪到对面。面板必须始终贴着当前拖拽的节点。
 */
function resizeSidesFor(dir: string | null | undefined): EdgeSide[] {
  const sides: EdgeSide[] = []
  if (dir?.includes('w')) sides.push('left')
  if (dir?.includes('e')) sides.push('right')
  if (dir?.includes('n')) sides.push('top')
  if (dir?.includes('s')) sides.push('bottom')
  return sides.length > 0 ? sides : ['left', 'right', 'top', 'bottom']
}

/** 计算某一侧的落点；fits 表示沿该方向放得下（另一轴会夹取到窗口内）。 */
function placeOnSide(
  side: EdgeSide,
  clientX: number,
  clientY: number,
  width: number,
  height: number,
  rect: PanelRect
): { left: number; top: number; fits: boolean } {
  const top = Math.max(
    EDGE_MARGIN,
    Math.min(clientY - height / 2, window.innerHeight - height - EDGE_MARGIN)
  )
  const left = Math.max(
    EDGE_MARGIN,
    Math.min(clientX - width / 2, window.innerWidth - width - EDGE_MARGIN)
  )
  if (side === 'left') {
    const x = rect.x - width - OUTSIDE_GAP
    return { left: x, top, fits: x >= EDGE_MARGIN }
  }
  if (side === 'right') {
    const x = rect.x + rect.width + OUTSIDE_GAP
    return { left: x, top, fits: x + width <= window.innerWidth - EDGE_MARGIN }
  }
  if (side === 'top') {
    const y = rect.y - height - OUTSIDE_GAP
    return { left, top: y, fits: y >= EDGE_MARGIN }
  }
  const y = rect.y + rect.height + OUTSIDE_GAP
  return { left, top: y, fits: y + height <= window.innerHeight - EDGE_MARGIN }
}

/**
 * 外侧放不下时，把放大镜放进选区内部，但仍紧贴当前拖拽的控制点。
 * 水平方向贴住对应的左右边，垂直方向跟随节点；上下方向同理。
 * 这样靠近屏幕边缘时不会翻到对面，也不会离开正在拖的节点。
 */
function placeInsideSide(
  side: EdgeSide,
  clientX: number,
  clientY: number,
  width: number,
  height: number,
  rect: PanelRect
): { left: number; top: number; fits: boolean } {
  let left: number
  let top: number
  if (side === 'left') {
    // 贴在选区左边内侧，纵向跟随拖拽节点。
    left = rect.x + INSIDE_GAP
    if (left + width > rect.x + rect.width - INSIDE_GAP) {
      left = Math.max(rect.x + INSIDE_GAP, rect.x + rect.width - width - INSIDE_GAP)
    }
    top = clientY - height / 2
  } else if (side === 'right') {
    left = Math.max(
      rect.x + INSIDE_GAP,
      rect.x + rect.width - width - INSIDE_GAP
    )
    top = clientY - height / 2
  } else if (side === 'top') {
    left = clientX - width / 2
    top = rect.y + INSIDE_GAP
    if (top + height > rect.y + rect.height - INSIDE_GAP) {
      top = Math.max(rect.y + INSIDE_GAP, rect.y + rect.height - height - INSIDE_GAP)
    }
  } else {
    left = clientX - width / 2
    top = Math.max(
      rect.y + INSIDE_GAP,
      rect.y + rect.height - height - INSIDE_GAP
    )
  }
  const clamped = clampPanel(left, top, width, height)
  return { ...clamped, fits: true }
}

type ColorMode = 'rgb' | 'hex'

interface Props {
  init: OverlayInit
  imageCanvasRef: RefObject<HTMLCanvasElement | null>
  language?: Language
  onCopied: (value: string) => void
  /** 是否跟随鼠标刷新。编辑阶段只在拖拽选区控制点时开启。 */
  active?: boolean
  /** 是否接管 C / Shift 取色快捷键；编辑阶段必须关闭，避免抢走复制截图。 */
  interactiveKeys?: boolean
  /**
   * 拖拽控制点时传入当前选区的 ref：放大镜必须落在选区外面，不能挡住截图内容。
   * 用 ref 而不是 prop，保证 pointermove 里读到的是最新选区，不受 React 提交时机影响。
   */
  avoidRectRef?: RefObject<{ x: number; y: number; width: number; height: number } | null>
  /** 当前正在拖拽的控制点方向（n/s/e/w 组合），同样用 ref 避免首帧拿到旧值。 */
  resizeDirRef?: RefObject<string | null>
}

/**
 * 框选前的像素放大镜 + 实时取色。
 *
 * 视觉：白底放大区 + 蓝色十字线 + 中心像素边框；下方黑色信息区显示坐标、
 * 颜色值、操作提示（C 复制、Shift 切换 RGB/HEX）。
 *
 * 背景：选区需要精确到像素，但用户看不到鼠标下方到底是哪几个像素。
 * 设计意图：放大镜直接用 drawImage + 关闭平滑，呈现实心像素块；
 * 取色只读当前 1×1 像素，不再缓存整屏 ImageData，避免重复截图累积原生内存。
 * 关键约束：面板 pointer-events: none，不能影响框选；取色快捷键只在框选阶段接管，
 * 编辑阶段组件仍挂载（供拖拽控制点时跟随），但不能抢走“复制截图”的快捷键。
 */
export function Magnifier({
  init,
  imageCanvasRef,
  language,
  onCopied,
  active = true,
  interactiveKeys = true,
  avoidRectRef,
  resizeDirRef
}: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const swatchRef = useRef<HTMLSpanElement | null>(null)
  const valueRef = useRef<HTMLSpanElement | null>(null)
  const coordsRef = useRef<HTMLDivElement | null>(null)
  const scratchRef = useRef<HTMLCanvasElement | null>(null)
  const colorRef = useRef<RgbColor | null>(null)
  const modeRef = useRef<ColorMode>('rgb')
  // 一次拖拽内锁定放大镜停靠的一侧，避免拖拽过程中来回切换。
  const stickySideRef = useRef<EdgeSide | null>(null)
  const stickyDirRef = useRef<string | null>(null)
  // 指针事件监听只挂一次；激活状态用 ref 读取，避免每次选区变化都重新订阅。
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (!active) {
      stickySideRef.current = null
      stickyDirRef.current = null
      // 放大镜会跨会话常驻挂载（编辑阶段也保留，供拖拽控制点时使用），
      // 这里主动释放辅助画布，避免跨会话持有原生内存。
      scratchRef.current = null
      if (rootRef.current) rootRef.current.style.display = 'none'
    }
  }, [active])

  // 新一次截图会话必须丢掉上一次的停靠方向，避免沿用旧选区的位置。
  useEffect(() => {
    stickySideRef.current = null
    stickyDirRef.current = null
  }, [init])

  const applyColor = useCallback((color: RgbColor | null): void => {
    colorRef.current = color
    if (!color) return
    if (swatchRef.current) swatchRef.current.style.background = toHex(color)
    if (valueRef.current) {
      valueRef.current.textContent =
        modeRef.current === 'hex' ? toHex(color) : toRgbText(color)
    }
  }, [])

  /**
   * 单片像素直读：用于遮罩刚出现、鼠标还没移动时先拿到一个颜色。
   * 只复制 1×1，代价远小于整屏快照，不会拖慢揭示首帧。
   */
  const sampleDirect = useCallback(
    (pixelX: number, pixelY: number): RgbColor | null => {
      const source = imageCanvasRef.current
      if (!source || !source.width || !source.height) return null
      let scratch = scratchRef.current
      if (!scratch) {
        scratch = document.createElement('canvas')
        scratchRef.current = scratch
      }
      scratch.width = 1
      scratch.height = 1
      const context = scratch.getContext('2d', { willReadFrequently: true })
      if (!context) return null
      context.clearRect(0, 0, 1, 1)
      context.drawImage(source, pixelX, pixelY, 1, 1, 0, 0, 1, 1)
      try {
        const data = context.getImageData(0, 0, 1, 1).data
        return { r: data[0], g: data[1], b: data[2] }
      } catch {
        return null
      }
    },
    [imageCanvasRef]
  )

  const update = useCallback(
    (clientX: number, clientY: number, sample: 'none' | 'direct'): void => {
      const root = rootRef.current
      const canvas = canvasRef.current
      const source = imageCanvasRef.current
      if (!root || !canvas || !source || !source.width || !source.height) return

      // 以实际画布像素为准换算：真实截图里 canvas 尺寸等于 imageWidth/Height；
      // 兼容低分辨率回退和测试假图（canvas 可能比 imageWidth 小）。
      const scaleX = source.width / init.bounds.width
      const scaleY = source.height / init.bounds.height
      const pixelX = Math.floor(clientX * scaleX)
      const pixelY = Math.floor(clientY * scaleY)
      const rect = clampSourceRect(
        pixelX,
        pixelY,
        SOURCE_WIDTH,
        SOURCE_HEIGHT,
        source.width,
        source.height
      )

      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(PANEL_WIDTH * dpr)) {
        canvas.width = Math.round(PANEL_WIDTH * dpr)
      }
      if (canvas.height !== Math.round(PANEL_HEIGHT * dpr)) {
        canvas.height = Math.round(PANEL_HEIGHT * dpr)
      }
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.imageSmoothingEnabled = false
      context.clearRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT)
      context.drawImage(
        source,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        PANEL_WIDTH,
        PANEL_HEIGHT
      )

      // 蓝色十字线：覆盖鼠标所在的整行/整列像素，宽度就是一个像素格。
      const cellWidth = PANEL_WIDTH / rect.width
      const cellHeight = PANEL_HEIGHT / rect.height
      const cellX = Math.min(rect.width - 1, Math.max(0, pixelX - rect.x))
      const cellY = Math.min(rect.height - 1, Math.max(0, pixelY - rect.y))
      const markerX = cellX * cellWidth
      const markerY = cellY * cellHeight
      context.fillStyle = 'rgba(150, 192, 255, 0.62)'
      context.fillRect(markerX, 0, cellWidth, PANEL_HEIGHT)
      context.fillRect(0, markerY, PANEL_WIDTH, cellHeight)

      // 中心像素：黑边 + 外圈白边，保证在深浅背景上都看得清。
      context.lineWidth = 1
      context.strokeStyle = 'rgba(0, 0, 0, 0.85)'
      context.strokeRect(markerX + 0.5, markerY + 0.5, cellWidth - 1, cellHeight - 1)
      context.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      context.strokeRect(markerX - 0.5, markerY - 0.5, cellWidth + 1, cellHeight + 1)

      if (coordsRef.current) {
        coordsRef.current.textContent = `(${pixelX} , ${pixelY})`
      }

      root.style.display = 'flex'
      const panelWidth = root.offsetWidth || PANEL_WIDTH + 2
      const panelHeight = root.offsetHeight || PANEL_HEIGHT + 100
      // 只有正在拖拽控制点时（有方向）才启用“贴着节点”的约束；
      // 框选阶段仍沿用原来的跟随光标行为。
      const resizeDir = resizeDirRef?.current ?? null
      const avoidRect = resizeDir ? (avoidRectRef?.current ?? null) : null
      let left: number
      let top: number
      if (avoidRect) {
        const sides = resizeSidesFor(resizeDir)
        if (stickyDirRef.current !== resizeDir) {
          stickyDirRef.current = resizeDir
          stickySideRef.current = null
        }
        let placed: { left: number; top: number } | null = null
        const preferred = stickySideRef.current
        // 优先维持当前停靠的一侧；如果那一侧外侧放不下，只在同一控制点的
        // 相邻边里找，绝不换到对面。
        if (preferred) {
          const attempt = placeOnSide(
            preferred,
            clientX,
            clientY,
            panelWidth,
            panelHeight,
            avoidRect
          )
          if (attempt.fits) placed = attempt
        }
        if (!placed) {
          for (const side of sides) {
            const attempt = placeOnSide(
              side,
              clientX,
              clientY,
              panelWidth,
              panelHeight,
              avoidRect
            )
            if (attempt.fits) {
              placed = attempt
              stickySideRef.current = side
              break
            }
          }
        }
        // 外侧都放不下：进入选区内部，贴在同一个控制点旁边。
        if (!placed) {
          const side = preferred ?? sides[0]
          stickySideRef.current = side
          placed = placeInsideSide(
            side,
            clientX,
            clientY,
            panelWidth,
            panelHeight,
            avoidRect
          )
        }
        left = placed.left
        top = placed.top
      } else {
        left = clientX + CURSOR_OFFSET
        top = clientY + CURSOR_OFFSET
        if (left + panelWidth + 8 > window.innerWidth) left = clientX - panelWidth - CURSOR_OFFSET
        if (top + panelHeight + 8 > window.innerHeight) top = clientY - panelHeight - CURSOR_OFFSET
        const clamped = clampPanel(left, top, panelWidth, panelHeight)
        left = clamped.left
        top = clamped.top
      }
      root.style.left = `${left}px`
      root.style.top = `${top}px`

      if (sample === 'none') return
      // 只读当前 1×1 像素。早期实现会缓存整屏 ImageData 加速取色，但每张 1080p
      // 快照约 8MB 原生内存，放大镜常驻后会在重复截图中累积；1×1 读取代价足够低。
      applyColor(sampleDirect(pixelX, pixelY))
    },
    [applyColor, avoidRectRef, imageCanvasRef, init, resizeDirRef, sampleDirect]
  )

  useEffect(() => {
    const hide = (): void => {
      if (rootRef.current) rootRef.current.style.display = 'none'
    }
    const onMove = (event: PointerEvent): void => {
      // 非激活态（例如编辑阶段没有拖控制点）不跟随鼠标。
      if (!activeRef.current) return
      update(event.clientX, event.clientY, 'direct')
    }
    const onOut = (event: PointerEvent): void => {
      if (!event.relatedTarget) hide()
    }
    // 必须用冒泡阶段：覆盖层的 onPointerMove 会先同步更新 selectionRef，
    // 放大镜随后再读最新选区；用捕获阶段会读到上一帧的选区，导致位置落后于边框。
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerout', onOut, true)
    // 遮罩一出现就把放大镜放到 F1 时的光标位置，并用 1×1 直读先给出颜色；
    // 整屏像素快照等第一次移动再做，避免在揭示首帧时读回整张画布。
    if (activeRef.current && init.cursor) update(init.cursor.x, init.cursor.y, 'direct')
    return () => {
      // 添加时 pointermove 用的是冒泡阶段，移除必须保持一致，否则每次会话都会残留监听。
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerout', onOut, true)
    }
  }, [init, update])

  useEffect(() => {
    if (!interactiveKeys) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Shift') {
        // Shift 只在取色面板存在时切换显示格式。
        modeRef.current = modeRef.current === 'rgb' ? 'hex' : 'rgb'
        applyColor(colorRef.current)
        return
      }
      if (event.key.toLowerCase() !== 'c' || event.altKey) return
      const color = colorRef.current
      if (!color) return
      // 纯 C 或 Ctrl/Cmd+C 都复制当前显示的颜色。
      if (event.shiftKey) return
      event.preventDefault()
      // 同阶段还有 useOverlayKeyboard 的监听；框选阶段它本来就会直接 return，
      // 这里用 immediate 阻断，保证以后顺序变化也不会误触发“复制截图”。
      event.stopImmediatePropagation()
      const value = modeRef.current === 'hex' ? toHex(color) : toRgbText(color)
      void window.snapglass.clipboard.writeText(value)
      onCopied(value)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [applyColor, onCopied, interactiveKeys])

  return (
    <div ref={rootRef} className="magnifier" style={{ display: 'none' }}>
      <div className="magnifier-zoom-wrap">
        <canvas ref={canvasRef} className="magnifier-zoom" />
      </div>
      <div className="magnifier-info">
        <div ref={coordsRef} className="magnifier-coords">
          (0 , 0)
        </div>
        <div className="magnifier-color">
          <span ref={swatchRef} className="magnifier-swatch" />
          <span ref={valueRef} className="magnifier-value">
            --
          </span>
        </div>
        <div className="magnifier-hint">{t(language, '按 C 复制颜色值')}</div>
        <div className="magnifier-hint">{t(language, '按 Shift 切换 RGB/HEX')}</div>
      </div>
    </div>
  )
}
