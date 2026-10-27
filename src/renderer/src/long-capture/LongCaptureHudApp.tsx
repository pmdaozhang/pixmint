import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { LongCapturePhase, LongCaptureProgress } from '@shared/types'
import './long-capture-hud.css'

const INITIAL: LongCaptureProgress = {
  phase: 'idle',
  screens: 0,
  height: 0
}

const LABELS: Record<LongCapturePhase, string> = {
  idle: '准备中',
  preparing: '准备中',
  scrolling: '滚动中',
  capturing: '截取中',
  matching: '拼接中',
  manual: '手动滚动',
  paused: '已暂停',
  finished: '已完成',
  error: '已停止',
  cancelled: '已取消'
}

function LongIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
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

export function LongCaptureHudApp(): JSX.Element {
  const [state, setState] = useState<LongCaptureProgress>(INITIAL)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    document.documentElement.dataset.theme = media.matches ? 'dark' : 'light'
    const unsubscribe = window.snapglass.longCapture.onProgress(setState)
    void window.snapglass.longCapture.getState().then(setState)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.snapglass.longCapture.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      unsubscribe()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const paused = state.phase === 'paused'
  const error = state.phase === 'error'
  const tone = error ? 'error' : paused ? 'paused' : 'active'
  const message =
    state.message ??
    (state.phase === 'idle' ? '正在准备长截图' : '正在处理长截图')

  return (
    <div className="hud-shell">
      <section className="hud-card" data-tone={tone} aria-live="polite">
        <div className="hud-head">
          <span className="hud-icon">
            <LongIcon />
          </span>
          <strong>长截图</strong>
          <span className="hud-pill">{LABELS[state.phase]}</span>
        </div>
        <div className="hud-meta">
          {state.screens} 屏 · {state.height.toLocaleString()}px
        </div>
        <div className="hud-message">{message}</div>
        <div className="hud-track">
          <div className="hud-fill" />
        </div>
        <div className="hud-actions">
          {!error && (
            <>
              <button
                className="hud-btn"
                onClick={() => {
                  if (paused) window.snapglass.longCapture.resume()
                  else window.snapglass.longCapture.pause()
                }}
              >
                {paused ? '继续' : '暂停'}
              </button>
              <button
                className="hud-btn primary"
                onClick={() => window.snapglass.longCapture.finish()}
              >
                完成
              </button>
            </>
          )}
          {error && (
            <button
              className="hud-btn primary"
              onClick={() => window.snapglass.longCapture.manual()}
            >
              改手动滚动
            </button>
          )}
          <button
            className="hud-btn"
            onClick={() => window.snapglass.longCapture.cancel()}
          >
            {error ? '关闭' : '取消'}
          </button>
        </div>
      </section>
    </div>
  )
}
