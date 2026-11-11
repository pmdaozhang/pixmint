import { useCallback, useEffect, useRef, type JSX, type RefObject } from 'react'
import type { OverlayInit } from '@shared/types'
import { clampSourceRect, pixelAt, toHex, toRgbLabel, type RgbColor } from './color-picker'

const ZOOM = 10
const PANEL_WIDTH = 160
const PANEL_HEIGHT = 120
const SOURCE_WIDTH = PANEL_WIDTH / ZOOM
const SOURCE_HEIGHT = PANEL_HEIGHT / ZOOM
const CURSOR_OFFSET = 18

interface Props {
  init: OverlayInit
  imageCanvasRef: RefObject<HTMLCanvasElement | null>
  onCopied: (hex: string) => void
}

/**
 * 框选前的像素放大镜 + 实时取色。
 *
 * 背景：选区需要精确到像素，但用户看不到鼠标下方到底是哪几个像素；
 * 逐次调用 getImageData 又会把 GPU 读回放到鼠标事件里，拖慢跟随。
 * 设计意图：从冻结截图里一次性取出整屏像素快照，之后所有取色都是内存索引；
 * 放大镜直接用 drawImage + 关闭平滑，呈现实心像素块。
 * 关键约束：面板 pointer-events: none，不能影响框选；Ctrl+C 只在框选阶段接管，
 * 进入编辑阶段后卸载，不能抢走“复制截图”的快捷键。
 */
export function Magnifier({ init, imageCanvasRef, onCopied }: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const swatchRef = useRef<HTMLSpanElement | null>(null)
  const hexRef = useRef<HTMLSpanElement | null>(null)
  const rgbRef = useRef<HTMLSpanElement | null>(null)
  const snapshotRef = useRef<ImageData | null>(null)
  const scratchRef = useRef<HTMLCanvasElement | null>(null)
  const colorRef = useRef<RgbColor | null>(null)

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

  const ensureSnapshot = useCallback((): ImageData | null => {
    if (snapshotRef.current) return snapshotRef.current
    const source = imageCanvasRef.current
    if (!source || !source.width || !source.height) return null
    const context = source.getContext('2d')
    if (!context) return null
    try {
      snapshotRef.current = context.getImageData(0, 0, source.width, source.height)
    } catch {
      snapshotRef.current = null
    }
    return snapshotRef.current
  }, [imageCanvasRef])

  const update = useCallback(
    (clientX: number, clientY: number, sample: 'none' | 'direct' | 'snapshot'): void => {
      const root = rootRef.current
      const canvas = canvasRef.current
      const source = imageCanvasRef.current
      if (!root || !canvas || !source || !source.width || !source.height) return

      const scaleX = init.imageWidth / init.bounds.width
      const scaleY = init.imageHeight / init.bounds.height
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

      const cellWidth = PANEL_WIDTH / rect.width
      const cellHeight = PANEL_HEIGHT / rect.height
      context.strokeStyle = 'rgba(0, 0, 0, 0.18)'
      context.lineWidth = 1
      context.beginPath()
      for (let i = 1; i < rect.width; i += 1) {
        const x = Math.round(i * cellWidth) + 0.5
        context.moveTo(x, 0)
        context.lineTo(x, PANEL_HEIGHT)
      }
      for (let j = 1; j < rect.height; j += 1) {
        const y = Math.round(j * cellHeight) + 0.5
        context.moveTo(0, y)
        context.lineTo(PANEL_WIDTH, y)
      }
      context.stroke()

      const cellX = Math.min(rect.width - 1, Math.max(0, pixelX - rect.x))
      const cellY = Math.min(rect.height - 1, Math.max(0, pixelY - rect.y))
      context.strokeStyle = 'rgba(2, 133, 255, 0.95)'
      context.lineWidth = 2
      context.strokeRect(
        cellX * cellWidth + 1,
        cellY * cellHeight + 1,
        Math.max(1, cellWidth - 2),
        Math.max(1, cellHeight - 2)
      )

      root.style.display = 'flex'
      const panelWidth = root.offsetWidth || PANEL_WIDTH + 10
      const panelHeight = root.offsetHeight || PANEL_HEIGHT + 34
      let left = clientX + CURSOR_OFFSET
      let top = clientY + CURSOR_OFFSET
      if (left + panelWidth + 8 > window.innerWidth) left = clientX - panelWidth - CURSOR_OFFSET
      if (top + panelHeight + 8 > window.innerHeight) top = clientY - panelHeight - CURSOR_OFFSET
      root.style.left = `${Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8))}px`
      root.style.top = `${Math.max(8, Math.min(top, window.innerHeight - panelHeight - 8))}px`

      if (sample === 'none') return
      const color =
        sample === 'snapshot'
          ? (() => {
              const snapshot = ensureSnapshot()
              return snapshot
                ? pixelAt(snapshot.data, snapshot.width, snapshot.height, pixelX, pixelY)
                : sampleDirect(pixelX, pixelY)
            })()
          : sampleDirect(pixelX, pixelY)
      colorRef.current = color
      if (!color) return
      const hex = toHex(color)
      if (swatchRef.current) swatchRef.current.style.background = hex
      if (hexRef.current) hexRef.current.textContent = hex
      if (rgbRef.current) rgbRef.current.textContent = toRgbLabel(color)
    },
    [ensureSnapshot, imageCanvasRef, init, sampleDirect]
  )

  useEffect(() => {
    const hide = (): void => {
      if (rootRef.current) rootRef.current.style.display = 'none'
    }
    const onMove = (event: PointerEvent): void => update(event.clientX, event.clientY, 'snapshot')
    const onOut = (event: PointerEvent): void => {
      if (!event.relatedTarget) hide()
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerout', onOut, true)
    // 遮罩一出现就把放大镜放到 F1 时的光标位置，并用 1×1 直读先给出颜色；
    // 整屏像素快照等第一次移动再做，避免在揭示首帧时读回整张画布。
    if (init.cursor) update(init.cursor.x, init.cursor.y, 'direct')
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerout', onOut, true)
    }
  }, [init, update])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'c') return
      const color = colorRef.current
      if (!color) return
      event.preventDefault()
      // 同阶段还有 useOverlayKeyboard 的监听；框选阶段它本来就会直接 return，
      // 这里用 immediate 阻断，保证以后顺序变化也不会误触发“复制截图”。
      event.stopImmediatePropagation()
      const hex = toHex(color)
      void window.snapglass.clipboard.writeText(hex)
      onCopied(hex)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCopied])

  return (
    <div ref={rootRef} className="magnifier" style={{ display: 'none' }}>
      <canvas ref={canvasRef} className="magnifier-zoom" />
      <div className="magnifier-info">
        <span ref={swatchRef} className="magnifier-swatch" />
        <span ref={hexRef} className="magnifier-hex">
          --
        </span>
        <span ref={rgbRef} className="magnifier-rgb" />
        <span className="magnifier-hint">Ctrl+C</span>
      </div>
    </div>
  )
}
