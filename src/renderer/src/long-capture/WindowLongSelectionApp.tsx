import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Rect, WindowTargetInfo } from '@shared/types'
import {
  SELECTION_HANDLES,
  resizeWindowSelection,
  type SelectionHandle
} from '@shared/window-selection'
import './window-long-selection.css'

/**
 * 背景：窗口长截图选中窗口后，需要在目标窗口真实内容上确认采集区域。
 * 设计意图：默认框住主内容区，并允许在窗口内容范围内拖动八个手柄微调。
 * 关键约束：不能把选区拖出目标窗口内容区；开始/取消只通过主进程 IPC。
 */
export function WindowLongSelectionApp(): JSX.Element {
  const [target, setTarget] = useState<WindowTargetInfo | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [drag, setDrag] = useState<{
    dir: SelectionHandle
    startX: number
    startY: number
    rect: Rect
  } | null>(null)

  useEffect(() => {
    document.documentElement.dataset.route = 'window-long-selection'
    void window.snapglass.windowTarget.info().then((info) => {
      if (!info) {
        window.snapglass.windowLong.cancel()
        return
      }
      setTarget(info)
      setSelection(info.contentRect)
    })
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.snapglass.windowLong.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      delete document.documentElement.dataset.route
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (!drag || !selection || !target) return
    const move = (event: PointerEvent): void => {
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      const bounds = target.contentRect
      setSelection(resizeWindowSelection(drag.rect, drag.dir, dx, dy, bounds))
    }
    const up = (): void => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, selection, target])

  if (!target || !selection) {
    return <div className="long-selection-loading">正在准备窗口选区…</div>
  }

  return (
    <div className="long-selection-root">
      <div
        className="long-selection-box"
        style={{
          left: selection.x,
          top: selection.y,
          width: selection.width,
          height: selection.height
        }}
      >
        <div className="long-selection-label">
          <span className="dot" />
          窗口内容区 · {selection.width} × {selection.height}
        </div>
        {SELECTION_HANDLES.map((dir) => (
          <span
            key={dir}
            className="long-selection-handle"
            data-dir={dir}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setDrag({
                dir,
                startX: event.clientX,
                startY: event.clientY,
                rect: selection
              })
            }}
          />
        ))}
      </div>

      <aside className="long-selection-confirm">
        <div className="long-selection-confirm-head">
          <strong>{target.title}</strong>
          <span>窗口</span>
        </div>
        <div className="long-selection-confirm-meta">
          页面内容区 · {selection.width} × {selection.height}
        </div>
        <div className="long-selection-confirm-hint">
          选区限制在窗口内容区内；拖动四角/边线微调。
        </div>
        <div className="long-selection-actions">
          <button
            className="long-selection-btn ghost"
            type="button"
            onClick={() => window.snapglass.windowLong.reselect()}
          >
            重新选择
          </button>
          <button
            className="long-selection-btn primary"
            type="button"
            onClick={() => window.snapglass.windowLong.start(selection)}
          >
            开始长截图
          </button>
        </div>
      </aside>
    </div>
  )
}
