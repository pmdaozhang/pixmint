import { useEffect, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import type { ArrowMode, LineStyle, Tool } from '@shared/types'
import { t, type Language } from '@shared/i18n'
import { Icon } from '../components/Icon'
import { drawArrowHead, strokePathStyled } from './annotation/draw'
import {
  FONT_CHOICES,
  LINE_STYLES,
  MOSAIC_BRUSH_MAX,
  MOSAIC_BRUSH_MIN,
  MOSAIC_DENSITY_MAX,
  MOSAIC_DENSITY_MIN,
  PALETTE,
  canUseFontChoice,
  mosaicDensityToSize,
  type OverlayOptions
} from './options'

interface Props {
  options: OverlayOptions
  setOptions(patch: Partial<OverlayOptions>): void
  submenuOpen: boolean
  onToolClick(tool: Tool): void
  onAction(
    action:
      | 'ocr'
      | 'translate'
      | 'gif'
      | 'video'
      | 'copy'
      | 'pin'
      | 'save'
      | 'close'
  ): void
  onUndo(): void
  onRedo(): void
  canUndo: boolean
  canRedo: boolean
  variant?: 'overlay' | 'pin'
  language?: Language
  onConfirm?: () => void
  /** 是否会员；免费用户只能使用默认字体 */
  isPro?: boolean
  /** 免费用户点击会员字体时打开购买窗 */
  onOpenPurchase?: () => void
  /** 聚光灯开关；次数用完的免费用户点击时由外层打开购买窗 */
  onToggleSpotlight?: () => void
}

const ARROW_MODES: Array<{ value: ArrowMode; label: string }> = [
  { value: 'single', label: '带箭头' },
  { value: 'none', label: '纯线条' },
  { value: 'double', label: '双箭头' }
]

function ArrowModeIcon({ mode }: { mode: ArrowMode }): JSX.Element {
  if (mode === 'none') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 12h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="m16 8.2 4 3.8-4 3.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {mode === 'double' && (
        <path
          d="M8 8.2 4 12l4 3.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

/**
 * 聚光灯图标（B 方案 · 参考图还原）：灯头 + 半透明光柱 + 完整椭圆光圈。
 * 线条按 21px 实尺寸调细：光圈笔画 1.3，光柱不加描边、只用半透明填充，
 * 避免缩小时糊成一团灰块。
 */
function SpotlightIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2.6" width="6" height="3" rx="1" fill="currentColor" />
      <path d="M8.4 6.2h7.2l4.2 9.4H4.2z" fill="currentColor" fillOpacity="0.48" />
      <ellipse
        cx="12"
        cy="16.6"
        rx="7.2"
        ry="2.8"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

function LineStylePreview({
  style,
  color,
  width = 58,
  height = 18
}: {
  style: LineStyle
  color: string
  width?: number
  height?: number
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const baseW = Math.max(2, Math.min(3.4, height / 5.5))
    const midY = height / 2
    const tipX = width - 3
    const lineEndX = tipX - Math.max(4, baseW * 2)
    strokePathStyled(
      ctx,
      [
        { x: 4, y: midY },
        { x: lineEndX, y: midY }
      ],
      style,
      baseW,
      color
    )
    drawArrowHead(ctx, 4, midY, tipX, midY, style, baseW * 0.75, color)
  }, [style, color, width, height])
  return <canvas ref={ref} className="line-style-preview" />
}

function LineStylePicker({
  value,
  color,
  language,
  onChange
}: {
  value: LineStyle
  color: string
  language: Language
  onChange(value: LineStyle): void
}): JSX.Element {
  const tr = (zh: string): string => t(language, zh)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div className="line-style-root" ref={rootRef}>
      <button
        className="ss-cell ss-drop"
        title={tr('线条样式')}
        onClick={() => setOpen((value) => !value)}
      >
        <LineStylePreview style={value} color={color} width={52} height={16} />
        <svg className="caret" viewBox="0 0 24 24" fill="none">
          <path
            d="M7 9.5l5 5 5-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="line-style-pop">
          {LINE_STYLES.map((style) => (
            <button
              key={style.value}
              className={`ss-cell${style.value === value ? ' on' : ''}`}
              title={tr(style.label)}
              onClick={() => {
                onChange(style.value)
                setOpen(false)
              }}
            >
              <LineStylePreview style={style.value} color={color} width={64} height={18} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ArrowModePicker({
  value,
  language,
  onChange
}: {
  value: ArrowMode
  language: Language
  onChange(value: ArrowMode): void
}): JSX.Element {
  const tr = (zh: string, vars?: Record<string, string | number>): string =>
    t(language, zh, vars)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  const currentLabel = ARROW_MODES.find((mode) => mode.value === value)?.label ?? '带箭头'
  return (
    <div className="arrow-mode-root" ref={rootRef}>
      <button
        className="ss-cell ss-drop arrow-mode-trigger"
        title={tr('线条端样式：{label}', { label: tr(currentLabel) })}
        aria-label={tr('线条端样式：{label}', { label: tr(currentLabel) })}
        onClick={() => setOpen((next) => !next)}
      >
        <ArrowModeIcon mode={value} />
        <svg className="caret" viewBox="0 0 24 24" fill="none">
          <path
            d="M7 9.5l5 5 5-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="line-style-pop arrow-mode-pop" role="menu">
          {ARROW_MODES.map((mode) => (
            <button
              key={mode.value}
              className={`ss-cell${mode.value === value ? ' on' : ''}`}
              title={tr(mode.label)}
              role="menuitemradio"
              aria-checked={mode.value === value}
              onClick={() => {
                onChange(mode.value)
                setOpen(false)
              }}
            >
              <ArrowModeIcon mode={mode.value} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FontPicker({
  value,
  isPro,
  language,
  onChange,
  onOpenPurchase
}: {
  value: string
  isPro: boolean
  language: Language
  onChange(family: string): void
  onOpenPurchase(): void
}): JSX.Element {
  const tr = (zh: string): string => t(language, zh)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  const current = FONT_CHOICES.find((choice) => choice.family === value) ?? FONT_CHOICES[0]
  return (
    <div className="font-picker" ref={rootRef}>
      <button
        className="mini-select font-select"
        title={tr('选择字体')}
        aria-label={tr('选择字体')}
        onClick={() => setOpen((next) => !next)}
      >
        <span className="font-picker-label" style={{ fontFamily: current.family }}>
          {current.label}
        </span>
        <svg className="caret" viewBox="0 0 24 24" fill="none">
          <path
            d="M7 9.5l5 5 5-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="font-pop" role="menu">
          {FONT_CHOICES.map((choice) => {
            const allowed = canUseFontChoice(choice, isPro)
            return (
              <button
                key={choice.id}
                role="menuitemradio"
                aria-checked={choice.family === value}
                className={`font-item${choice.family === value ? ' on' : ''}`}
                style={{ fontFamily: choice.family }}
                title={allowed ? choice.label : tr('该字体为会员专属，升级后可用')}
                onClick={() => {
                  if (!allowed) {
                    onOpenPurchase()
                    return
                  }
                  onChange(choice.family)
                  setOpen(false)
                }}
              >
                <span className="font-item-label">{choice.label}</span>
                {!allowed && <span className="font-lock">👑</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function WidthDot({
  value,
  color,
  onChange,
  title
}: {
  value: number
  color: string
  title: string
  onChange(value: number): void
}): JSX.Element {
  const size = 5 + value * 1.5
  return (
    <button
      className="ss-lead"
      title={title}
      onWheel={(event) => {
        event.preventDefault()
        const direction = event.deltaY < 0 ? 0.5 : -0.5
        onChange(Math.max(1, Math.min(10, value + direction)))
      }}
    >
      <i style={{ width: size, height: size, background: color }} />
    </button>
  )
}

function ColorPalette({
  color,
  onChange
}: {
  color: string
  onChange(value: string): void
}): JSX.Element {
  return (
    <div className="palette">
      <span className="current-color" style={{ background: color }} />
      <div className="swatches">
        {PALETTE.map((swatch) => (
          <button
            key={swatch}
            className={`swatch${swatch === color ? ' on' : ''}`}
            style={{ background: swatch }}
            title={swatch}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(swatch)}
          />
        ))}
      </div>
    </div>
  )
}

function ToolButton({
  tool,
  current,
  icon,
  label,
  onClick
}: {
  tool: Tool
  current: Tool
  icon: JSX.Element
  label: string
  onClick(tool: Tool): void
}): JSX.Element {
  return (
    <button
      className={`tb${tool === current ? ' on' : ''}`}
      title={label}
      onClick={() => onClick(tool)}
    >
      {icon}
    </button>
  )
}

export function Toolbar({
  options,
  setOptions,
  submenuOpen,
  onToolClick,
  onAction,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  variant = 'overlay',
  language = 'zh-CN',
  onConfirm,
  isPro = false,
  onOpenPurchase,
  onToggleSpotlight
}: Props): JSX.Element {
  const tr = (zh: string, vars?: Record<string, string | number>): string =>
    t(language, zh, vars)
  const widthKey = options.tool === 'shape' ? 'shape' : options.tool === 'arrow' ? 'arrow' : 'pen'
  const setBrushSize = (value: number): void => {
    setOptions({
      mosaicBrushSize: Math.max(MOSAIC_BRUSH_MIN, Math.min(MOSAIC_BRUSH_MAX, Math.round(value)))
    })
  }
  const startBrushDrag = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startSize = options.mosaicBrushSize
    const onMove = (moveEvent: PointerEvent): void => {
      setBrushSize(startSize + (moveEvent.clientX - startX) * 0.6)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }
  const mosaicDotSize =
    8 +
    ((options.mosaicBrushSize - MOSAIC_BRUSH_MIN) /
      (MOSAIC_BRUSH_MAX - MOSAIC_BRUSH_MIN)) *
      10
  return (
    <div className={`tooldock glass-2${submenuOpen ? ' submenu-open' : ''}`}>
      <div className="row1">
        <ToolButton
          tool="shape"
          current={options.tool}
          icon={<Icon name="shape" />}
          label={tr('矩形 / 椭圆')}
          onClick={onToolClick}
        />
        <ToolButton
          tool="arrow"
          current={options.tool}
          icon={<Icon name="arrow" />}
          label={tr('线条 / 箭头')}
          onClick={onToolClick}
        />
        <ToolButton
          tool="mosaic"
          current={options.tool}
          icon={<Icon name="mosaic" />}
          label={tr('马赛克')}
          onClick={onToolClick}
        />
        <ToolButton
          tool="text"
          current={options.tool}
          icon={<Icon name="text" />}
          label={tr('文字')}
          onClick={onToolClick}
        />
        <ToolButton
          tool="seq"
          current={options.tool}
          icon={<Icon name="seq" />}
          label={tr('序号')}
          onClick={onToolClick}
        />
        <span className="div" />
        <button className="tb" title={tr('撤销 Ctrl+Z')} disabled={!canUndo} onClick={onUndo}>
          <Icon name="undo" />
        </button>
        <button className="tb" title={tr('重做 Ctrl+Shift+Z')} disabled={!canRedo} onClick={onRedo}>
          <Icon name="redo" />
        </button>
        <span className="div" />
        {variant === 'pin' ? (
          <button
            className="act"
            data-action="confirm"
            title={tr('完成编辑')}
            aria-label={tr('完成编辑')}
            onClick={onConfirm}
          >
            <Icon name="check" size={16} />
          </button>
        ) : (
          <>
            <button
              className="act"
              data-action="ocr"
              title={tr('识别选区文字')}
              aria-label={tr('识别选区文字')}
              onClick={() => onAction('ocr')}
            >
              <Icon name="ocr" size={16} />
            </button>
            <button
              className="act"
              data-action="translate"
              title={tr('识别并翻译')}
              aria-label={tr('识别并翻译')}
              onClick={() => onAction('translate')}
            >
              <Icon name="translate" size={16} />
            </button>
            <button className="tb tb-gif" title={tr('录制 GIF')} onClick={() => onAction('gif')}>
              <Icon name="gif" />
            </button>
            <button className="tb tb-video" title={tr('录制视频')} onClick={() => onAction('video')}>
              <Icon name="video" />
            </button>
            <span className="div" />
            <button
              className="act"
              data-action="close"
              title={tr('关闭')}
              aria-label={tr('关闭')}
              onClick={() => onAction('close')}
            >
              <Icon name="close" size={16} />
            </button>
            <button
              className="act"
              data-action="pin"
              title={tr('钉图')}
              aria-label={tr('钉图')}
              onClick={() => onAction('pin')}
            >
              <Icon name="pin" size={16} />
            </button>
            <button
              className="act"
              data-action="save"
              title={tr('保存')}
              aria-label={tr('保存')}
              onClick={() => onAction('save')}
            >
              <Icon name="save" size={16} />
            </button>
            <button
              className="act"
              data-action="copy"
              title={tr('复制')}
              aria-label={tr('复制')}
              onClick={() => onAction('copy')}
            >
              <Icon name="copy" size={16} />
            </button>
          </>
        )}
      </div>

      {submenuOpen && <div className="submenu-divider" />}
      {submenuOpen && <div className="row2">
        {options.tool === 'shape' && (
          <button
            className={`ss-cell spotlight-toggle${options.spotlight ? ' on' : ''}`}
            title={tr('聚光灯')}
            aria-label={tr('聚光灯')}
            aria-pressed={options.spotlight}
            onClick={() => onToggleSpotlight?.()}
          >
            <SpotlightIcon />
          </button>
        )}
        {(options.tool === 'shape' || options.tool === 'arrow') && (
          <WidthDot
            value={options.widths[widthKey]}
            color={options.color}
            title={tr('滚轮调节粗细')}
            onChange={(value) =>
              setOptions({ widths: { ...options.widths, [widthKey]: value } })
            }
          />
        )}

        {options.tool === 'shape' && (
          <>
            <div className="seg">
              <button
                className={`ss-cell${options.shapeKind === 'rect' ? ' on' : ''}`}
                title={tr('矩形')}
                onClick={() => setOptions({ shapeKind: 'rect' })}
              >
                <svg viewBox="0 0 24 24" fill="none">
                  <rect
                    x="4"
                    y="5"
                    width="16"
                    height="14"
                    rx="1.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                </svg>
              </button>
              <button
                className={`ss-cell${options.shapeKind === 'ellipse' ? ' on' : ''}`}
                title={tr('椭圆')}
                onClick={() => setOptions({ shapeKind: 'ellipse' })}
              >
                <svg viewBox="0 0 24 24" fill="none">
                  <ellipse
                    cx="12"
                    cy="12"
                    rx="8"
                    ry="6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                </svg>
              </button>
            </div>
            <span className="div" />
            <ColorPalette color={options.color} onChange={(color) => setOptions({ color })} />
          </>
        )}

        {options.tool === 'arrow' && (
          <>
            <ArrowModePicker
              value={options.arrowMode}
              language={language}
              onChange={(arrowMode) => setOptions({ arrowMode })}
            />
            {options.arrowMode !== 'none' && (
              <LineStylePicker
                value={options.lineStyle}
                color={options.color}
                language={language}
                onChange={(lineStyle) => setOptions({ lineStyle })}
              />
            )}
            <span className="div" />
            <ColorPalette color={options.color} onChange={(color) => setOptions({ color })} />
          </>
        )}

        {options.tool === 'mosaic' && (
          <>
            <div
              className="mosaic-brush-control"
              title={tr('马赛克画笔大小：拖动圆点或滑杆调节')}
            >
              <span
                className="mosaic-brush-dot"
                title={tr('拖动调整画笔大小')}
                onPointerDown={startBrushDrag}
                onWheel={(event) => {
                  event.preventDefault()
                  setBrushSize(options.mosaicBrushSize + (event.deltaY < 0 ? 2 : -2))
                }}
              >
                <i
                  style={{
                    width: mosaicDotSize,
                    height: mosaicDotSize
                  }}
                />
              </span>
            </div>
            <span className="div" />
            <div className="seg">
              <button
                className={`ss-cell${options.mosaicMode === 'brush' ? ' on' : ''}`}
                title={tr('笔刷马赛克')}
                onClick={() => setOptions({ mosaicMode: 'brush' })}
              >
                <Icon name="mosaic" />
              </button>
              <button
                className={`ss-cell${options.mosaicMode === 'rect' ? ' on' : ''}`}
                title={tr('矩形马赛克')}
                onClick={() => setOptions({ mosaicMode: 'rect' })}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="5" y="5" width="14" height="14" rx="2" strokeDasharray="3 2" />
                </svg>
              </button>
            </div>
            <span className="div" />
            <input
              className="mosaic-range"
              type="range"
              min={MOSAIC_DENSITY_MIN}
              max={MOSAIC_DENSITY_MAX}
              step="1"
              title={tr('马赛克密度：数值越大越细腻')}
              value={options.mosaicDensity}
              onChange={(event) =>
                setOptions({
                  mosaicDensity: Number(event.target.value),
                  mosaicSize: mosaicDensityToSize(Number(event.target.value))
                })
              }
            />
            <span className="range-value">{options.mosaicDensity}</span>
          </>
        )}

        {options.tool === 'text' && (
          <>
            <FontPicker
              value={options.fontFamily}
              isPro={isPro}
              language={language}
              onChange={(family) => setOptions({ fontFamily: family })}
              onOpenPurchase={() => onOpenPurchase?.()}
            />
            <div className="seg">
              <button
                className={`ss-cell${options.textB ? ' on' : ''}`}
                title={tr('加粗')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setOptions({ textB: !options.textB })}
              >
                <strong className="text-style-glyph">B</strong>
              </button>
              <button
                className={`ss-cell${options.textI ? ' on' : ''}`}
                title={tr('斜体')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setOptions({ textI: !options.textI })}
              >
                <span className="text-style-glyph text-italic">I</span>
              </button>
              <button
                className={`ss-cell${options.textU ? ' on' : ''}`}
                title={tr('下划线')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setOptions({ textU: !options.textU })}
              >
                <u className="text-style-glyph text-underline">U</u>
              </button>
            </div>
            <span className="div" />
            <ColorPalette color={options.color} onChange={(color) => setOptions({ color })} />
          </>
        )}

        {options.tool === 'seq' && (
          <ColorPalette color={options.color} onChange={(color) => setOptions({ color })} />
        )}
      </div>}
    </div>
  )
}
