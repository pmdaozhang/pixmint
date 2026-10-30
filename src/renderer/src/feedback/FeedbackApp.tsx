import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ThemeSetting } from '@shared/types'
import {
  FEEDBACK_IMAGE_MIME_TYPES,
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_MESSAGE_LENGTH,
  type FeedbackAttachment,
  type FeedbackImageMimeType,
  type FeedbackSubmitResult
} from '@shared/feedback'
import './feedback.css'

type Phase = 'idle' | 'submitting' | 'sent' | 'queued'

interface PastedImage {
  id: string
  file: File
  url: string
  name: string
}

const ERROR_MESSAGES: Record<string, string> = {
  content_required: '请先填写反馈内容。',
  content_too_long: '反馈内容不能超过 1000 字。',
  content_too_short: '反馈内容太短，请再补充一些细节。',
  request_id_invalid: '本次反馈标识异常，请再试一次。',
  too_many_images: '最多只能粘贴 10 张截图。',
  image_type_unsupported: '截图格式不支持，请重新复制后再粘贴。',
  image_empty: '截图内容为空，请重新复制。',
  image_too_large: '截图压缩后仍超过 5MB，请减少截图范围。',
  attachments_too_large: '截图总大小超出上限，请删除部分截图。',
  missing_feedback_id: '反馈已提交，但后台没有返回反馈编号，截图无法上传。',
  http_404: '反馈已提交，但后台附件接口尚未就绪。',
  http_413: '截图或内容超过后台限制，请减少后重试。'
}

function applyTheme(theme: ThemeSetting): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.dataset.theme =
    theme === 'system' ? (media ? 'dark' : 'light') : theme
}

function isSupportedMime(value: string): value is FeedbackImageMimeType {
  return (FEEDBACK_IMAGE_MIME_TYPES as readonly string[]).includes(value)
}

function errorMessage(code?: string): string {
  if (!code) return '提交失败，请稍后再试。'
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  if (/network|fetch|timeout|socket/i.test(code)) return '网络不可用，反馈会进入发送队列。'
  return '提交失败，请稍后再试。'
}

function attachmentErrorMessage(code?: string): string {
  if (!code) return '截图上传失败，文字反馈已保存。'
  if (code === 'http_404' || code === 'http_501') {
    return '后台附件接口尚未就绪，文字反馈已保存。'
  }
  if (code === 'image_too_large') return '有截图超过 5MB，文字反馈已保存。'
  if (/network|fetch|timeout|socket/i.test(code)) {
    return '截图上传时网络中断，文字反馈已保存。'
  }
  return '截图上传失败，文字反馈已保存。'
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

async function compressToWebp(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  try {
    let width = bitmap.width
    let height = bitmap.height
    const maxSide = 4096
    if (Math.max(width, height) > maxSide) {
      const scale = maxSide / Math.max(width, height)
      width = Math.max(1, Math.round(width * scale))
      height = Math.max(1, Math.round(height * scale))
    }
    let quality = 0.9
    let best: Blob | null = null
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas_unavailable')
      context.drawImage(bitmap, 0, 0, width, height)
      const blob = await canvasToBlob(canvas, 'image/webp', quality)
      if (blob && (!best || blob.size < best.size)) best = blob
      if (blob && blob.size <= FEEDBACK_MAX_IMAGE_BYTES) break
      width = Math.max(1, Math.round(width * 0.84))
      height = Math.max(1, Math.round(height * 0.84))
      quality = Math.max(0.72, quality - 0.04)
    }
    if (!best || best.size > FEEDBACK_MAX_IMAGE_BYTES) throw new Error('image_too_large')
    const name = (file.name || 'screenshot').replace(/\.[^.]+$/, '')
    return new File([best], `${name}.webp`, { type: 'image/webp' })
  } finally {
    bitmap.close()
  }
}

async function toAttachment(image: PastedImage, index: number): Promise<FeedbackAttachment> {
  let file = image.file
  if (!isSupportedMime(file.type) || file.size > FEEDBACK_MAX_IMAGE_BYTES) {
    file = await compressToWebp(file)
  }
  if (!isSupportedMime(file.type)) throw new Error('image_type_unsupported')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const fallbackName = `screenshot-${index + 1}.${file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : 'webp'}`
  return {
    name: file.name || fallbackName,
    mimeType: file.type,
    bytes
  }
}

function BrandMark(): JSX.Element {
  return (
    <svg className="feedback-brand-mark" viewBox="0 0 512 512" aria-hidden="true">
      <g transform="rotate(-2 256 270)">
        <path
          d="M 148 118 H 364 C 414 118 444 148 444 198 V 342 C 444 392 414 422 364 422 H 148 C 98 422 68 392 68 342 V 198 C 68 148 98 118 148 118 Z"
          fill="currentColor"
        />
        <circle cx="190" cy="250" r="24" fill="var(--bg)" />
        <circle cx="322" cy="250" r="24" fill="var(--bg)" />
      </g>
      <path
        d="M 380 58 H 460 V 138"
        fill="none"
        stroke="currentColor"
        strokeWidth="26"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CloseIcon(): JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

function CheckIcon({ size = 24 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4 10-10" />
    </svg>
  )
}

export function FeedbackApp(): JSX.Element {
  const pasteModifier = window.snapglass.app.platform === 'darwin' ? '⌘' : 'Ctrl'
  const [content, setContent] = useState('')
  const [images, setImages] = useState<PastedImage[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<FeedbackSubmitResult | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const imagesRef = useRef<PastedImage[]>([])
  const phaseRef = useRef<Phase>('idle')
  const toastTimer = useRef<number | null>(null)

  useEffect(() => {
    imagesRef.current = images
  }, [images])

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    void window.snapglass.settings
      .get()
      .then((settings) => applyTheme(settings.theme))
      .catch(() => applyTheme('system'))
  }, [])

  useEffect(() => {
    return () => {
      for (const image of imagesRef.current) URL.revokeObjectURL(image.url)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1800)
  }, [])

  const addFiles = useCallback(
    (files: File[]) => {
      const imageFiles = files.filter((file) => file.type.startsWith('image/'))
      if (imageFiles.length === 0) return
      const current = imagesRef.current
      const available = FEEDBACK_MAX_IMAGES - current.length
      if (available <= 0) {
        showToast(`最多只能粘贴 ${FEEDBACK_MAX_IMAGES} 张截图`)
        return
      }
      const accepted = imageFiles.slice(0, available)
      const start = current.length
      const next = [
        ...current,
        ...accepted.map((file, index) => ({
          id: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
          name: file.name || `截图 ${start + index + 1}`
        }))
      ]
      imagesRef.current = next
      setImages(next)
      showToast(
        imageFiles.length > available
          ? `最多 ${FEEDBACK_MAX_IMAGES} 张，已保留前 ${accepted.length} 张`
          : `已粘贴 ${accepted.length} 张截图`
      )
    },
    [showToast]
  )

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent): void => {
      if (phaseRef.current !== 'idle') return
      const items = Array.from(event.clipboardData?.items || [])
      const files = items
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      if (files.length === 0) return
      event.preventDefault()
      addFiles(files)
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [addFiles])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.close()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    return window.snapglass.feedback.onStatus((event) => {
      if (event.requestId !== requestId) return
      if (event.status === 'sent') {
        setResult({
          status: 'sent',
          requestId,
          id: event.id,
          attachments: event.attachments
        })
        phaseRef.current = 'sent'
        setPhase('sent')
      } else {
        phaseRef.current = 'idle'
        setPhase('idle')
        setError(errorMessage(event.error))
      }
    })
  }, [requestId])

  const removeImage = (id: string): void => {
    const current = imagesRef.current
    const target = current.find((image) => image.id === id)
    if (target) URL.revokeObjectURL(target.url)
    const next = current.filter((image) => image.id !== id)
    imagesRef.current = next
    setImages(next)
  }

  const resetForAnother = (): void => {
    for (const image of imagesRef.current) URL.revokeObjectURL(image.url)
    imagesRef.current = []
    setImages([])
    setContent('')
    setResult(null)
    setError('')
    phaseRef.current = 'idle'
    setPhase('idle')
    setRequestId(crypto.randomUUID())
  }

  const submit = async (): Promise<void> => {
    if (phaseRef.current !== 'idle' || !content.trim()) return
    setToast('')
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current)
      toastTimer.current = null
    }
    setError('')
    phaseRef.current = 'submitting'
    setPhase('submitting')
    try {
      const attachments: FeedbackAttachment[] = []
      for (let index = 0; index < images.length; index += 1) {
        attachments.push(await toAttachment(images[index], index))
      }
      const next = await window.snapglass.feedback.submit({
        content,
        requestId,
        attachments
      })
      setResult(next)
      if (next.status === 'sent') {
        phaseRef.current = 'sent'
        setPhase('sent')
      } else if (next.status === 'queued') {
        phaseRef.current = 'queued'
        setPhase('queued')
      } else {
        phaseRef.current = 'idle'
        setPhase('idle')
        setError(errorMessage(next.error))
      }
    } catch (submitError) {
      phaseRef.current = 'idle'
      setPhase('idle')
      setError(
        submitError instanceof Error && submitError.message === 'image_too_large'
          ? ERROR_MESSAGES.image_too_large
          : '截图处理失败，请移除后重试。'
      )
    }
  }

  const submitting = phase === 'submitting'
  const finished = phase === 'sent' || phase === 'queued'
  const attachmentsFailed = result?.attachments?.failed || 0
  const attachmentError = result?.attachments?.error

  return (
    <div className="feedback-root">
      <header className="feedback-header">
        <div className="feedback-title">
          <BrandMark />
          <div>
            <strong>Pixmint</strong>
            <span>FEEDBACK</span>
          </div>
        </div>
        <button className="feedback-close" type="button" aria-label="关闭" onClick={() => window.close()}>
          <CloseIcon />
        </button>
      </header>

      {!finished && (
        <div className="feedback-form">
          <div className="feedback-body">
            <div className="feedback-intro">
              <h1>意见反馈</h1>
              <p>遇到问题，或者有想做的功能，都可以告诉我们。截图能帮助定位得更快。</p>
            </div>

            <div className="field-heading">
              <label htmlFor="feedback-content">
                反馈内容<span className="required">必填</span>
              </label>
              <span>
                {content.length} / {FEEDBACK_MAX_MESSAGE_LENGTH}
              </span>
            </div>

            <div className="composer">
              {images.length > 0 && (
                <div className="thumbnail-strip" role="list" aria-label="已粘贴的截图">
                  {images.map((image, index) => (
                    <div className="thumbnail" key={image.id} role="listitem">
                      <div className="thumbnail-frame">
                        <img src={image.url} alt={`截图 ${index + 1}`} />
                      </div>
                      <button
                        className="thumb-remove"
                        type="button"
                        aria-label={`移除截图 ${index + 1}`}
                        onClick={() => removeImage(image.id)}
                      >
                        <svg
                          width="8"
                          height="8"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                id="feedback-content"
                className="feedback-textarea"
                autoFocus
                maxLength={FEEDBACK_MAX_MESSAGE_LENGTH}
                value={content}
                disabled={submitting}
                placeholder="描述你遇到的问题或建议。截图后直接按 Ctrl+V，粘贴进来。"
                onChange={(event) => setContent(event.target.value)}
              />
            </div>

            <div className="paste-meta">
              <span className="paste-help">
                <kbd className="keycap">{pasteModifier}</kbd> + <kbd className="keycap">V</kbd>
                直接粘贴截图，超过 5MB 自动压缩
              </span>
              <span className={`image-count ${images.length >= FEEDBACK_MAX_IMAGES ? 'full' : ''}`}>
                {images.length} / {FEEDBACK_MAX_IMAGES} 张
              </span>
            </div>

            {error && (
              <div className="feedback-error" role="alert">
                {error}
              </div>
            )}

            <div className="privacy-note">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="4" y="10" width="16" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              提交内容、版本号、系统版本和截图会发送到 Pixmint 反馈后台。
            </div>
          </div>

          <footer className="feedback-footer">
            <button className="button-secondary" type="button" onClick={() => window.close()}>
              取消
            </button>
            <button
              className="button-primary"
              type="button"
              disabled={!content.trim() || submitting}
              onClick={() => void submit()}
            >
              {submitting ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  正在提交…
                </>
              ) : (
                '提交反馈'
              )}
            </button>
          </footer>
        </div>
      )}

      {finished && (
        <div className="feedback-result">
          <div className={`result-mark ${phase === 'queued' ? 'queued' : ''}`}>
            {phase === 'queued' ? (
              <svg
                width="27"
                height="27"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 18a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.7 1.2A3.5 3.5 0 0 1 17 18h-2" />
                <path d="M12 12v7M9 16l3 3 3-3" />
              </svg>
            ) : (
              <CheckIcon size={29} />
            )}
          </div>

          <h2>{phase === 'queued' ? '已加入发送队列' : '反馈已发送'}</h2>
          <p>
            {phase === 'queued'
              ? '网络暂时不可用，文字反馈会在恢复后自动发送。'
              : '谢谢你帮助 Pixmint 变得更好。我们会认真读完每一条反馈。'}
          </p>

          {phase === 'sent' && attachmentsFailed === 0 && (
            <div className="result-chip">
              <CheckIcon size={12} />
              {result?.attachments && result.attachments.uploaded > 0
                ? `已提交文字与 ${result.attachments.uploaded} 张截图`
                : '已提交文字反馈'}
            </div>
          )}

          {phase === 'sent' && attachmentsFailed > 0 && (
            <div className="result-warning">
              <strong>文字已提交，{attachmentsFailed} 张截图未上传</strong>
              <span>{attachmentErrorMessage(attachmentError)}</span>
            </div>
          )}

          {phase === 'queued' && images.length > 0 && (
            <div className="result-warning">
              <strong>截图不会跨重启保留</strong>
              <span>网络恢复后会在当前运行期间继续上传；关闭 Pixmint 前请保持联网。</span>
            </div>
          )}

          <div className="result-actions">
            <button className="button-secondary" type="button" onClick={resetForAnother}>
              再写一条
            </button>
            <button className="button-primary" type="button" onClick={() => window.close()}>
              完成
            </button>
          </div>
        </div>
      )}

      <div className={`feedback-toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  )
}

