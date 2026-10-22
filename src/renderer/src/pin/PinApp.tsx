import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { PinInit } from '@shared/types'
import { Icon } from '../components/Icon'
import './pin.css'

export function PinApp(): JSX.Element {
  const [init, setInit] = useState<PinInit | null>(null)
  const [ignore, setIgnore] = useState(false)
  const [toast, setToast] = useState('')
  const [dragging, setDragging] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)
  const suppressDoubleClickRef = useRef(false)

  useEffect(() => {
    window.snapglass.pin.ready().then(setInit)
  }, [])

  useEffect(() => {
    if (!init) {
      setImageUrl('')
      return
    }
    const copy = new Uint8Array(init.imageBytes)
    const blob = new Blob([copy.buffer], { type: 'image/png' })
    const url = URL.createObjectURL(blob)
    setImageUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [init])

  const flash = (message: string): void => {
    setToast(message)
    window.setTimeout(() => setToast(''), 1500)
  }

  if (!init) return <div className="pin-empty" />

  return (
    <div
      className={`pin-root${dragging ? ' dragging' : ''}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        if ((event.target as HTMLElement).closest('.pin-actions')) return
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { startX: event.screenX, startY: event.screenY, moved: false }
        setDragging(true)
        window.snapglass.pin.dragStart()
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (!drag) return
        if (Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) > 2) {
          drag.moved = true
        }
        if (drag.moved) window.snapglass.pin.dragMove(event.movementX, event.movementY)
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current
        if (!drag) return
        dragRef.current = null
        setDragging(false)
        window.snapglass.pin.dragEnd()
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          // pointer capture 可能已释放
        }
        if (drag.moved) {
          suppressDoubleClickRef.current = true
          window.setTimeout(() => {
            suppressDoubleClickRef.current = false
          }, 260)
        }
      }}
      onWheel={(event) => {
        event.preventDefault()
        void window.snapglass.pin.zoom(event.deltaY < 0 ? 1 : -1)
      }}
      onDoubleClick={async (event) => {
        if ((event.target as HTMLElement).closest('.pin-actions')) return
        if (suppressDoubleClickRef.current) return
        const next = await window.snapglass.pin.toggleIgnore()
        setIgnore(next)
        flash(next ? '鼠标穿透已开启，可从托盘恢复' : '鼠标穿透已关闭')
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        window.snapglass.pin.contextMenu()
      }}
    >
      <img className="pin-image" src={imageUrl} alt="" draggable={false} />
      <div className="pin-actions">
        <button
          title="复制"
          onClick={(event) => {
            event.stopPropagation()
            void window.snapglass.pin.copy().then(() => flash('已复制'))
          }}
        >
          <Icon name="copy" size={14} />
        </button>
        <button
          title="保存"
          onClick={(event) => {
            event.stopPropagation()
            void window.snapglass.pin.save().then((filePath) => flash(filePath ? '已保存' : '保存失败'))
          }}
        >
          <Icon name="save" size={14} />
        </button>
        <button
          title="关闭"
          onClick={(event) => {
            event.stopPropagation()
            window.snapglass.pin.close()
          }}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      {ignore && <span className="pin-badge">鼠标穿透</span>}
      {toast && <span className="pin-toast">{toast}</span>}
    </div>
  )
}
