import type { ArrowMode, LineStyle, ShapeKind, Tool } from '../../../shared/types'

export interface OverlayOptions {
  tool: Tool
  shapeKind: ShapeKind
  color: string
  lineStyle: LineStyle
  arrowMode: ArrowMode
  widths: Record<'shape' | 'arrow' | 'pen', number>
  mosaicMode: 'brush' | 'rect'
  mosaicDensity: number
  mosaicSize: number
  mosaicBrushSize: number
  fontSize: number
  fontFamily: string
  textB: boolean
  textI: boolean
  textU: boolean
}

export const DEFAULT_FONT_FAMILY = 'sans-serif'

export const DEFAULT_OPTIONS: OverlayOptions = {
  tool: 'move',
  shapeKind: 'rect',
  color: '#e64545',
  lineStyle: 'solid',
  arrowMode: 'single',
  widths: { shape: 2.5, arrow: 2.5, pen: 2.5 },
  mosaicMode: 'brush',
  mosaicDensity: 50,
  mosaicSize: 12,
  mosaicBrushSize: 24,
  fontSize: 15,
  fontFamily: DEFAULT_FONT_FAMILY,
  textB: false,
  textI: false,
  textU: false
}

export interface FontChoice {
  id: string
  /** 显示名（字体名，中文） */
  label: string
  /** @font-face 与 canvas font 共用的族名 */
  family: string
  /** 是否会员专属；免费用户只能用默认字体 */
  pro: boolean
}

/**
 * 打包字体随应用分发（woff2）。默认字体走系统 sans-serif，免费可用；
 * 其余字体为会员专属，免费用户点击会打开购买窗。
 */
export const FONT_CHOICES: FontChoice[] = [
  { id: 'default', label: '默认', family: DEFAULT_FONT_FAMILY, pro: false },
  { id: 'source-han-sans', label: '思源黑体', family: 'PixmintSourceHanSans', pro: true },
  { id: 'foxi', label: '演示佛系体', family: 'PixmintFoxi', pro: true },
  { id: 'qiuhongkai', label: '演示秋鸿楷', family: 'PixmintQiuhongkai', pro: true },
  { id: 'pangmen', label: '庞门正道粗书体', family: 'PixmintPangmen', pro: true },
  { id: 'zhuokai', label: '江西拙楷', family: 'PixmintZhuokai', pro: true },
  { id: 'baotu', label: '包图小白体', family: 'PixmintBaotu', pro: true },
  { id: 'muyao-ruanbi', label: '沐瑶软笔手写体', family: 'PixmintMuyaoRuanbi', pro: true },
  { id: 'muyao-suixin', label: '沐瑶随心手写体', family: 'PixmintMuyaoSuixin', pro: true },
  { id: 'xinye', label: '新叶念体', family: 'PixmintXinye', pro: true },
  { id: 'shetu', label: '摄图摩登小方体', family: 'PixmintShetu', pro: true }
]

export function fontChoiceId(family: string): string {
  return FONT_CHOICES.find((choice) => choice.family === family)?.id ?? 'default'
}

/** 免费用户只能使用默认字体；会员可用全部。 */
export function canUseFontChoice(choice: FontChoice, isPro: boolean): boolean {
  return !choice.pro || isPro
}

export const MOSAIC_MIN_BLOCK = 3
export const MOSAIC_MAX_BLOCK = 20
export const MOSAIC_BRUSH_MIN = 8
export const MOSAIC_BRUSH_MAX = 48
export const MOSAIC_DENSITY_MIN = 1
export const MOSAIC_DENSITY_MAX = 100

/**
 * 背景：用户语义是“像素密度”，越大越细腻；内部绘制仍需要块边长。
 * 设计意图：密度 1..100 映射到块边长 20..4；两端都保持在正常马赛克范围，
 * 最小密度只是稍粗，最大密度仍然保留细腻像素纹理，不会变成原图。
 * 关键约束：矩形马赛克走像素化路径，不按块生成格子。
 */
export function mosaicDensityToSize(density: number): number {
  const value = Math.max(
    MOSAIC_DENSITY_MIN,
    Math.min(MOSAIC_DENSITY_MAX, Math.round(density))
  )
  const t = (value - MOSAIC_DENSITY_MIN) / (MOSAIC_DENSITY_MAX - MOSAIC_DENSITY_MIN)
  return Math.round(MOSAIC_MAX_BLOCK - t * (MOSAIC_MAX_BLOCK - MOSAIC_MIN_BLOCK))
}

export function mosaicSizeToDensity(size: number): number {
  const block = Math.max(MOSAIC_MIN_BLOCK, Math.min(MOSAIC_MAX_BLOCK, Math.round(size)))
  const t = (MOSAIC_MAX_BLOCK - block) / (MOSAIC_MAX_BLOCK - MOSAIC_MIN_BLOCK)
  return Math.round(
    MOSAIC_DENSITY_MIN + t * (MOSAIC_DENSITY_MAX - MOSAIC_DENSITY_MIN)
  )
}

export const PALETTE = [
  '#1a1a1a',
  '#8c8c8c',
  '#990000',
  '#e60000',
  '#f27900',
  '#d9b200',
  '#2e9e44',
  '#29b7c9',
  '#2456e6',
  '#8c29d9',
  '#ffffff',
  '#d9d9d9',
  '#f2b8a0',
  '#f7c9d9',
  '#f7e9a0',
  '#ede3c9',
  '#c9f0a2',
  '#c9f2f2',
  '#c9d9f2',
  '#e2d1f7'
]

export const LINE_STYLES: Array<{ value: LineStyle; label: string }> = [
  { value: 'solid', label: '实线' },
  { value: 'thin', label: '细线' },
  { value: 'dotted', label: '点线' }
]
