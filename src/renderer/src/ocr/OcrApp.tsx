import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { OcrInit, Settings, WordCardEntry } from '@shared/types'
import { detectTranslationTarget } from '@shared/text-analysis'
import { Icon } from '../components/Icon'
import './ocr.css'

export function OcrApp(): JSX.Element {
  const [init, setInit] = useState<OcrInit | null>(null)
  const [text, setText] = useState('')
  const [translation, setTranslation] = useState('')
  const [wordEntry, setWordEntry] = useState<WordCardEntry | null>(null)
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [target, setTarget] = useState<'zh-CN' | 'en-US' | null>(null)
  const [directionOpen, setDirectionOpen] = useState(false)
  const autoTranslatedRef = useRef(false)
  const translateSeqRef = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const resultRef = useRef<HTMLDivElement | null>(null)
  const directionRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void window.snapglass.ocr.ready().then((data) => {
      if (!data) return
      setInit(data)
      setText(data.text)
      setTarget(detectTranslationTarget(data.text))
      setSettings(data.settings)
      setHasKey(data.hasTranslationKey)
    })
  }, [])

  useEffect(() => {
    const refresh = (): void => {
      void window.snapglass.settings.get().then((next) => {
        setSettings(next)
        setHasKey(Boolean(next.hasTranslationKey))
      })
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  useEffect(() => {
    const word = text.trim()
    if (!init || init.mode !== 'translate' || !/^[A-Za-z][A-Za-z'-]{1,23}$/.test(word)) {
      setWordEntry(null)
      return
    }
    let cancelled = false
    void window.snapglass.dictionary
      .lookup(word)
      .then((entry) => {
        if (!cancelled) setWordEntry(entry)
      })
      .catch(() => {
        if (!cancelled) setWordEntry(null)
      })
    return () => {
      cancelled = true
    }
  }, [init, text])

  const copyAndClose = async (value: string): Promise<void> => {
    if (value) await window.snapglass.clipboard.writeText(value)
    window.snapglass.ocr.close()
  }

  const canTranslate =
    settings?.translationProvider !== undefined &&
    settings.translationProvider !== 'none' &&
    (settings.translationProvider === 'free' || hasKey)

  const translate = async (explicitTarget?: 'zh-CN' | 'en-US'): Promise<void> => {
    const nextTarget = explicitTarget ?? target
    if (!nextTarget) return
    if (!settings || settings.translationProvider === 'none') {
      setError('请先在设置页选择翻译服务')
      return
    }
    if (settings.translationProvider !== 'free' && !hasKey) {
      setError('请先在设置页配置翻译 API Key')
      return
    }
    const sequence = ++translateSeqRef.current
    setTranslating(true)
    setError('')
    try {
      const result = await window.snapglass.translation.translate(text, nextTarget)
      if (sequence === translateSeqRef.current) setTranslation(result)
    } catch (reason) {
      if (sequence === translateSeqRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (sequence === translateSeqRef.current) setTranslating(false)
    }
  }

  useEffect(() => {
    if (!init || init.mode !== 'translate' || !init.autoTranslate) return
    if (autoTranslatedRef.current || !canTranslate || !target) return
    autoTranslatedRef.current = true
    void translate(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [init, canTranslate])

  useEffect(() => {
    if (!directionOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (directionRef.current && !directionRef.current.contains(event.target as Node)) {
        setDirectionOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDirectionOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [directionOpen])

  const chooseDirection = (next: 'zh-CN' | 'en-US'): void => {
    setDirectionOpen(false)
    setTarget(next)
    setTranslation('')
    setError('')
    if (!canTranslate) return
    void translate(next)
  }

  useEffect(() => {
    if (!init) return
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current
      if (init.mode === 'ocr') {
        const inputHeight = Math.min(320, Math.max(64, input?.scrollHeight ?? 64))
        const emptyHint = text.trim() ? 0 : 54
        window.snapglass.ocr.resize(inputHeight + 100 + emptyHint)
        return
      }
      const inputHeight = Math.min(160, Math.max(70, input?.scrollHeight ?? 90))
      const resultHeight = Math.min(260, Math.max(70, resultRef.current?.scrollHeight ?? 100))
      const hint = canTranslate ? 0 : 50
      const errorHeight = error ? 40 : 0
      const directionHeight = 40
      const wordHeight = wordEntry ? 104 : 0
      window.snapglass.ocr.resize(
        28 +
          16 +
          inputHeight +
          10 +
          wordHeight +
          directionHeight +
          resultHeight +
          10 +
          hint +
          errorHeight +
          14
      )
    })
    return () => window.cancelAnimationFrame(frame)
  }, [init, text, translation, canTranslate, error, wordEntry])

  if (!init) return <div className="ocr-loading">正在打开结果…</div>

  if (init.mode === 'ocr') {
    return (
      <div className="ocr-root ocr-compact">
        <div className="ocr-dragbar">
          <button
            className="ocr-icon-btn"
            title="关闭"
            onClick={() => window.snapglass.ocr.close()}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="ocr-compact-body">
          <textarea
            ref={inputRef}
            id="ocr-original"
            className="ocr-compact-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
          />
          {!text.trim() && (
            <div className="ocr-hint">
              未识别到文字。请重新截图并放大文字区域，或确认 Windows OCR 语言包已安装。
            </div>
          )}
          <div className="ocr-compact-footer">
            <button className="ocr-copy" onClick={() => void copyAndClose(text)}>
              <Icon name="copy" size={14} />
              复制
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ocr-root ocr-compact">
      <div className="ocr-dragbar">
        <button className="ocr-icon-btn" title="关闭" onClick={() => window.snapglass.ocr.close()}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="ocr-compact-body">
        <textarea
          ref={inputRef}
          id="ocr-original"
          className="ocr-compact-input translate-input"
          value={text}
          readOnly
          spellCheck={false}
        />
        {wordEntry && (
          <div className="word-card">
            <div className="word-card-head">
              <strong>{wordEntry.word}</strong>
              <span>英 {wordEntry.uk || wordEntry.phonetic || '—'}</span>
              <span>美 {wordEntry.us || wordEntry.phonetic || '—'}</span>
            </div>
            {wordEntry.pos.length > 0 && (
              <div className="word-pos">
                {wordEntry.pos.map((item) => (
                  <i key={item}>{item}.</i>
                ))}
              </div>
            )}
            <div className="word-meanings">
              {wordEntry.meanings.map((meaning) => (
                <p key={meaning}>{meaning}</p>
              ))}
            </div>
          </div>
        )}
        <div className="translate-direction" ref={directionRef}>
          <button
            type="button"
            className="direction-trigger"
            aria-haspopup="listbox"
            aria-expanded={directionOpen}
            onClick={() => setDirectionOpen((open) => !open)}
          >
            <span className={`direction-label${target ? '' : ' placeholder'}`}>
              {target === 'en-US' ? 'CN→EN' : target === 'zh-CN' ? 'EN→CN' : '请选择'}
            </span>
            <svg
              className="direction-chevron"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7 10l5 5 5-5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {directionOpen && (
            <div className="direction-menu" role="listbox" aria-label="翻译方向">
              <button
                type="button"
                role="option"
                aria-selected={target === 'en-US'}
                className={`direction-option${target === 'en-US' ? ' selected' : ''}`}
                onClick={() => chooseDirection('en-US')}
              >
                CN→EN
              </button>
              <button
                type="button"
                role="option"
                aria-selected={target === 'zh-CN'}
                className={`direction-option${target === 'zh-CN' ? ' selected' : ''}`}
                onClick={() => chooseDirection('zh-CN')}
              >
                EN→CN
              </button>
            </div>
          )}
        </div>
        <div className="translate-result" ref={resultRef}>
          {translation || (translating ? '翻译中…' : '译文会显示在这里')}
        </div>
        {!canTranslate && (
          <div className="ocr-hint">未配置翻译服务，请先在托盘设置中配置。</div>
        )}
        {error && <div className="ocr-error">{error}</div>}
      </div>
    </div>
  )
}
