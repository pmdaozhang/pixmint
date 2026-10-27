import type { JSX } from 'react'
import { dimPanelsFor } from '../../../shared/geometry'
import type { Rect } from '../../../shared/types'

/**
 * 背景：框选、待机和录制阶段都需要把选区外压暗。
 * 设计意图：用四块实色矩形替代超大 box-shadow，避免大选区把合成器拖死。
 * 关键约束：只渲染宽高大于 0 的面板，避免创建不可见但参与布局的节点。
 */
export function DimAround({ rect, className }: { rect: Rect; className?: string }): JSX.Element {
  const panels = dimPanelsFor(rect, {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight
  })
  return (
    <>
      {(['top', 'left', 'right', 'bottom'] as const).map((key) => {
        const panel = panels[key]
        if (panel.width <= 0 || panel.height <= 0) return null
        return (
          <div
            key={key}
            className={`dim-panel${className ? ` ${className}` : ''}`}
            style={{
              left: panel.x,
              top: panel.y,
              width: panel.width,
              height: panel.height
            }}
          />
        )
      })}
    </>
  )
}
