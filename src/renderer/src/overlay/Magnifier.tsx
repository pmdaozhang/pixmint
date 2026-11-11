import { useCallback, useEffect, useRef, type JSX, type RefObject } from 'react'
import type { Language } from '@shared/i18n'
import { t } from '@shared/i18n'
import type { OverlayInit } from '@shared/types'
import { clampSourceRect, pixelAt, toHex, toRgbText, type RgbColor } from './color-picker'

const ZOOM = 10
const PANEL_WIDTH = 240
const PANEL_HEIGHT = 120
const SOURCE_WIDTH = PANEL_WIDTH / ZOOM
const SOURCE_HEIGHT = PANEL_HEIGHT / ZOOM
const CURSOR_OFFSET = 18

type ColorMode = 'rgb' | 'hex'

interface Props {
  init: OverlayInit
  imageCanvasRef: RefObject<HTMLCanvasElement | null>
  language?: Language
  onCopied: (value: string) => void
}

/**
 * 框选前的像素放大镜 + 实时取色。
 *
 * 视觉：白底放大区 + 蓝色十字线 + 中心像素边框；下方黑色信息区显示坐标、
 * 颜色值、操作提示（C 复制、Shift 切换 RGB/HEX）。
 *
 * 背景：选区需要精确到像素，但用户看不到鼠标下方到底是哪几个像素；
 * 逐次调用 getImageData 又会把 GPU 读回放到鼠标事件里，拖慢跟随。
 * 设计意图：从冻结截图里一次性取出整屏像素快照，之后所有取色都是内存索引；
 * 放大镜直接用 drawImage + 关闭平滑，呈现实心像素块。
 * 关键约束：面板 pointer-events: none，不能影响框选；取色快捷键只在框选阶段接管，
 * 进入编辑阶段后组件卸载，不能抢走“复制截图”的快捷键。
 */
export function Magnifier({ init, imageCanvasRef, language, onCopied }: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const swatchRef = useRef<HTMLSpanElement | null>(null)
  const valueRef = useRef<HTMLSpanElement | null>(null)
  const coordsRef = useRef<HTMLDivElement | null>(null)
  const snapshotRef = useRef<ImageData | null>(null)
  const scratchRef = useRef<HTMLCanvasElement | null>(null)
  const colorRef = useRef<RgbColor | null>(null)
  const modeRef = useRef<ColorMode>('rgb')

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
      applyColor(color)
    },
    [applyColor, ensureSnapshot, imageCanvasRef, init, sampleDirect]
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
  }, [applyColor, onCopied])

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
