/**
 * 聚光灯渲染的纯函数部分。
 *
 * 背景：聚光灯的合成逻辑出过三次真实 bug（重叠区变暗、边框被擦掉、边框被遮罩吞掉），
 * 而它们都只在实际画布上才暴露，单测完全覆盖不到。这里把「哪些标注算聚光灯」
 * 「挖空区怎么算」「按什么顺序画」抽成纯函数，方便用 canvas mock 做回归测试。
 * 关键约束：本文件不能依赖 React 或 DOM 之外的 canvas 之外的东西。
 */

import type { Annotation, RectAnno } from '@shared/types'

/** 聚光灯形状判定：只有显式开启 spotlight 的矩形/椭圆才算。 */
export function isSpotlitShape(annotation: Annotation): annotation is RectAnno {
  return (
    (annotation.type === 'rect' || annotation.type === 'ellipse') &&
    annotation.spotlight === true
  )
}

export interface SpotlightHole {
  type: 'rect' | 'ellipse'
  x: number
  y: number
  width: number
  height: number
}

/**
 * 计算一个聚光灯形状的挖空区。
 * 描边以边界线为中心绘制，外沿正好在 lineW/2 处；挖空区按 lineW/2 外扩，
 * 使高亮区边缘与边框外沿严丝合缝。
 * 关键约束：不能再多扩——白底截图上多出来的那一圈亮边会非常明显
 * （2026-11-20 用户实测反馈，椭圆同理）。
 */
export function spotlightHole(shape: RectAnno): SpotlightHole | null {
  const pad = Math.max(0, shape.style.lineW / 2)
  const width = Math.abs(shape.x2 - shape.x1) + pad * 2
  const height = Math.abs(shape.y2 - shape.y1) + pad * 2
  if (width < 0.5 || height < 0.5) return null
  return {
    type: shape.type,
    x: Math.min(shape.x1, shape.x2) - pad,
    y: Math.min(shape.y1, shape.y2) - pad,
    width,
    height
  }
}

export interface SlackDrawPlan {
  /** 遮罩之前：非聚光灯标注 */
  base: Annotation[]
  /** 遮罩之后：聚光灯形状（填充 + 描边） */
  spotlit: Annotation[]
}

/**
 * 绘制顺序计划。顺序不正确会直接导致用户可见的 bug：
 * 聚光灯形状若画在遮罩之前，会被遮罩压暗。
 *
 * 2026-11-21 起 overlay 层（遮罩后半透明重描）已删除：遮罩改为
 * 「在遮罩画布上铺黑纱并挖洞、整张叠加」，亮区里的标注从未被擦掉，
 * 不再需要任何重描补救。见 AnnotationCanvas.drawSpotlightMasks。
 *
 * 文本编辑中的草稿要跳过，由调用方通过 skipId 传入。
 */
export function planSpotlightDraw(
  annotations: Annotation[],
  temp: Annotation | null,
  skipId: string | null = null
): SlackDrawPlan {
  const visible = annotations.filter(
    (annotation) => !(annotation.type === 'text' && annotation.id === skipId)
  )
  const all = temp ? [...visible, temp] : visible
  return {
    base: all.filter((annotation) => !isSpotlitShape(annotation)),
    spotlit: all.filter((annotation) => isSpotlitShape(annotation))
  }
}

/** 收集当前所有聚光灯挖空区（含正在拖拽的临时形状）。 */
export function spotlightHoles(
  annotations: Annotation[],
  temp: Annotation | null = null
): SpotlightHole[] {
  const holes: SpotlightHole[] = []
  for (const annotation of temp ? [...annotations, temp] : annotations) {
    if (!isSpotlitShape(annotation)) continue
    const hole = spotlightHole(annotation)
    if (hole) holes.push(hole)
  }
  return holes
}
