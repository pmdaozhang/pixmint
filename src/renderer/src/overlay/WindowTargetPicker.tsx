import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { WindowTargetItem } from '@shared/types'
import './window-target-picker.css'

interface Props {
  open: boolean
  onClose(): void
}

interface PickerPosition {
  left: number
  top: number
  maxHeight: number
}

const PICKER_WIDTH = 340
const PICKER_HEIGHT = 380

/**
 * 背景：窗口长截图需要先从真实桌面窗口列表中选定目标，而不是让用户猜中心点。
 * 设计意图：选择器贴着截图工具栏显示，保留 Demo 的层级与紧凑密度；屏幕项只做说明。
 * 关键约束：选中窗口后由主进程隐藏冻结截图并打开实时选区，本组件不自行拼接图片。
 */
export function WindowTargetPicker({ open, onClose }: Props): JSX.Element | null {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [items, setItems] = useState<WindowTargetItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [position, setPosition] = useState<PickerPosition>({
    left: 12,
    top: 12,
    maxHeight: PICKER_HEIGHT
  })

  const place = useCallback(() => {
    const dock = document.querySelector('.tooldock')?.getBoundingClientRect()
    const margin = 12
    const gap = 8
    const width = Math.min(PICKER_WIDTH, window.innerWidth - margin * 2)
    const left = dock
      ? Math.max(
          margin,
          Math.min(dock.right - width, window.innerWidth - width - margin)
        )
      : margin
    const below = dock ? dock.bottom + gap : margin
    const above = dock ? dock.top - PICKER_HEIGHT - gap : margin
    const available = window.innerHeight - margin * 2
    const maxHeight = Math.min(PICKER_HEIGHT, available)
    const top =
      below + maxHeight <= window.innerHeight - margin
        ? below
        : Math.max(margin, above)
    setPosition({ left, top, maxHeight })
  }, [])

  useEffect(() => {
    if (!open) return
    place()
    let cancelled = false
    setLoading(true)
    setMessage('')
    void window.snapglass.windowTarget
      .list()
      .then((next) => {
        if (!cancelled) setItems(next)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setMessage(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if ((target as HTMLElement).closest?.('.tooldock')) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    const onResize = (): void => place()
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onResize)
    }
  }, [onClose, open, place])

  if (!open) return null

  const screens = items.filter((item) => item.kind === 'screen')
  const windows = items.filter((item) => item.kind === 'window')

  const choose = async (item: WindowTargetItem): Promise<void> => {
    if (item.kind !== 'window' || busyId) return
    setBusyId(item.id)
    setMessage('')
    try {
      await window.snapglass.windowTarget.select(item.id)
      window.snapglass.windowLong.begin()
      onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      setBusyId('')
    }
  }

  const renderRow = (item: WindowTargetItem): JSX.Element => {
    const disabled = item.kind === 'screen'
    return (
      <button
        key={item.id}
        className={`window-picker-row${busyId === item.id ? ' busy' : ''}`}
        type="button"
        disabled={disabled || Boolean(busyId)}
        onClick={() => {
          void choose(item)
        }}
      >
        <span className="window-picker-thumb">
          {item.thumbnailDataUrl ? (
            <img src={item.thumbnailDataUrl} alt="" draggable={false} />
          ) : (
            <span className="window-picker-thumb-fallback" />
          )}
        </span>
        <span className="window-picker-meta">
          <strong>{item.name}</strong>
          <span>{item.kind === 'screen' ? '屏幕' : '窗口'}</span>
        </span>
        {(item.note || busyId === item.id) && (
          <span className="window-picker-badge">
            {busyId === item.id ? '读取中' : item.note}
          </span>
        )}
      </button>
    )
  }

  return (
    <aside
      ref={rootRef}
      className="window-picker"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      style={{
        left: position.left,
        top: position.top,
        maxHeight: position.maxHeight
      }}
      role="dialog"
      aria-label="选择要长截图的窗口"
    >
      <div className="window-picker-head">
        <strong>选择要长截图的窗口</strong>
        <span>自动滚动</span>
      </div>

      {loading && (
        <div className="window-picker-state">
          <span className="window-picker-spinner" />
          正在读取窗口…
        </div>
      )}

      {!loading && screens.length > 0 && (
        <section className="window-picker-group">
          <div className="window-picker-group-title">屏幕</div>
          {screens.map(renderRow)}
        </section>
      )}

      {!loading && windows.length > 0 && (
        <section className="window-picker-group">
          <div className="window-picker-group-title">窗口</div>
          {windows.map(renderRow)}
        </section>
      )}

      {!loading && !message && items.length === 0 && (
        <div className="window-picker-state">没有找到可选择的窗口</div>
      )}

      {message && <div className="window-picker-error">{message}</div>}
    </aside>
  )
}
