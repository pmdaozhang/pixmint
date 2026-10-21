import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { RecorderPreviewInfo } from '@shared/types'
import { formatBytes, formatRecordingDuration } from '@shared/recording'
import './record-preview.css'

export function RecordPreviewApp(): JSX.Element {
  const [info, setInfo] = useState<RecorderPreviewInfo | null>(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [gifUrl, setGifUrl] = useState('')

  const showMessage = (value: string): void => {
    setMessage(value)
    window.setTimeout(() => setMessage(''), 2200)
  }

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    document.documentElement.dataset.theme = media.matches ? 'dark' : 'light'
    void window.snapglass.recorderPreview.ready().then((value) => {
      if (value) setInfo(value)
    })
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.snapglass.recorderPreview.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (info?.mode !== 'gif' || !info.mediaUrl) {
      setGifUrl('')
      return
    }
    let cancelled = false
    let objectUrl = ''
    const load = async (): Promise<void> => {
      try {
        const bytes = await window.snapglass.recorderPreview.readFile()
        // 通过 IPC 读取原始字节再生成 Blob URL，避免自定义协议被 CSP/CORS 拦截后只显示静态首帧。
        const copy = new Uint8Array(bytes.length)
        copy.set(bytes)
        const gifBlob = new Blob([copy.buffer], { type: 'image/gif' })
        objectUrl = URL.createObjectURL(gifBlob)
        if (!cancelled) setGifUrl(objectUrl)
      } catch {
        if (!cancelled) setGifUrl(info.mediaUrl)
      }
    }
    void load()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [info?.mediaUrl, info?.mode])

  if (!info) return <div className="preview-root" />

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const path = await window.snapglass.recorderPreview.save()
      if (path) {
        setInfo((previous) =>
          previous
            ? {
                ...previous,
                filePath: path,
                fileName: path.split(/[\\/]/).pop() ?? previous.fileName,
                mediaUrl: `snapglass-media://local?path=${encodeURIComponent(path)}`
              }
            : previous
        )
        showMessage(`已保存：${path}`)
      }
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="preview-root">
      <div className="preview-card">
        <div className="preview-head">
          <strong>录制完成</strong>
          <button
            className="preview-close"
            title="关闭并删除未保存的临时文件"
            onClick={() => window.snapglass.recorderPreview.close()}
          >
            ×
          </button>
        </div>

        <div className="preview-body">
          <div className="preview-thumb">
            {info.mode === 'gif' ? (
              <img src={gifUrl || info.mediaUrl} alt="" />
            ) : info.thumbnailUrl ? (
              <img src={info.thumbnailUrl} alt="" />
            ) : (
              <span>{info.extension.toUpperCase()}</span>
            )}
          </div>
          <div className="preview-info">
            <div className="preview-name">{info.fileName}</div>
            <div className="preview-meta">
              {info.width} × {info.height} · {formatRecordingDuration(info.durationMs)} ·{' '}
              {formatBytes(info.sizeBytes)}
            </div>
            <div className="preview-sub">
              {message ||
                `${info.extension.toUpperCase()} · ${info.fps} FPS${
                  info.frameCount ? ` · ${info.frameCount} 帧` : ''
                }`}
            </div>
            <div className="preview-actions">
              <button
                className="preview-btn"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? '保存中…' : '保存'}
              </button>
              <button
                className="preview-btn"
                onClick={() => window.snapglass.recorderPreview.openFolder()}
              >
                打开文件
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
