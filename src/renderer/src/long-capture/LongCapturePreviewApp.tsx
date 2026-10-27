import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { LongCapturePreviewInfo } from '@shared/types'
import { formatBytes } from '@shared/update'
import './long-capture-preview.css'

function LongIcon(): JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="3" width="12" height="15" rx="1.6" />
      <path d="M12 7v6M9 11l3 3 3-3M4 21h16" />
    </svg>
  )
}

export function LongCapturePreviewApp(): JSX.Element {
  const [info, setInfo] = useState<LongCapturePreviewInfo | null>(null)
  const [zoom, setZoom] = useState(1)
  const [message, setMessage] = useState('')
  const contentRef = useRef<HTMLDivElement | null>(null)

  const showMessage = (value: string): void => {
    setMessage(value)
    window.setTimeout(() => setMessage(''), 2200)
  }

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    document.documentElement.dataset.theme = media.matches ? 'dark' : 'light'
    void window.snapglass.longCapture.previewInfo().then((value) => {
      if (value) setInfo(value)
    })
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.snapglass.longCapture.closePreview()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!info) return <div className="long-preview-loading">正在加载长图…</div>

  const imageWidth = Math.max(120, Math.round(info.width * zoom))

  const fitWidth = (): void => {
    const available = (contentRef.current?.clientWidth ?? 860) - 48
    setZoom(Math.max(0.3, Math.min(1.2, available / info.width)))
  }

  const save = async (): Promise<void> => {
    try {
      const path = await window.snapglass.longCapture.savePreview()
      if (path) showMessage(`已保存：${path}`)
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const copy = async (): Promise<void> => {
    try {
      showMessage(await window.snapglass.longCapture.copyPreview())
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="long-preview-root">
      <header className="long-preview-titlebar">
        <div className="long-preview-title">
          <LongIcon />
          长截图预览
        </div>
        <button
          className="long-preview-close"
          type="button"
          aria-label="关闭"
          onClick={() => window.snapglass.longCapture.closePreview()}
        >
          ×
        </button>
      </header>

      <div className="long-preview-toolbar">
        <button
          className="long-preview-btn"
          type="button"
          aria-label="缩小"
          onClick={() => setZoom((value) => Math.max(0.3, value - 0.1))}
        >
          −
        </button>
        <span className="long-preview-zoom">{Math.round(zoom * 100)}%</span>
        <button
          className="long-preview-btn"
          type="button"
          aria-label="放大"
          onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))}
        >
          +
        </button>
        <button className="long-preview-btn" type="button" onClick={fitWidth}>
          适应宽度
        </button>
        <button
          className="long-preview-btn"
          type="button"
          onClick={() => setZoom(1)}
        >
          100%
        </button>
        <span className="long-preview-spacer" />
        <button className="long-preview-btn" type="button" onClick={() => void copy()}>
          复制
        </button>
        <button
          className="long-preview-btn primary"
          type="button"
          onClick={() => void save()}
        >
          保存 PNG
        </button>
      </div>

      <div className="long-preview-content" ref={contentRef}>
        <img
          src={info.mediaUrl}
          alt="长截图"
          style={{ width: `${imageWidth}px` }}
          onError={() => showMessage('长图加载失败，请重新截图')}
        />
      </div>

      <footer className="long-preview-footer">
        <span>
          {info.width} × {info.height} · {formatBytes(info.bytes)}
        </span>
        <span>{message || '固定表头已合并 · 无重复行'}</span>
      </footer>
    </div>
  )
}
