import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { RecorderState } from '@shared/types'
import { formatRecordingDuration } from '@shared/recording'
import './recorder-control.css'

function StopIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

function PauseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}

function PlayIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function RecorderControlApp(): JSX.Element {
  const [state, setState] = useState<RecorderState | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    document.documentElement.dataset.theme = media.matches ? 'dark' : 'light'
    const off = window.snapglass.recorderControl.onState(setState)
    void window.snapglass.recorderControl.ready().then((value) => {
      if (value) setState(value)
    })
    return off
  }, [])

  if (!state) return <div className="rec-control-root" />

  const isVideo = state.mode === 'video'
  const active = state.phase === 'recording' || state.phase === 'paused'
  if (state.phase === 'preparing') {
    return (
      <div className="rec-control-root">
        <div className="rec-control preparing">
          <span className="rec-spinner" />
          <span className="tm">准备中…</span>
          <button
            className="cb"
            title="取消录制"
            onClick={() => window.snapglass.recorderControl.command({ type: 'cancel' })}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    )
  }
  if (state.phase === 'countdown') {
    return (
      <div className="rec-control-root">
        <div className="rec-control preparing">
          <span className="tm">倒计时…</span>
          <button
            className="cb"
            title="取消录制"
            onClick={() => window.snapglass.recorderControl.command({ type: 'cancel' })}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    )
  }
  if (state.phase === 'encoding') {
    return (
      <div className="rec-control-root">
        <div className="rec-control encoding">
          <span className="rec-spinner" />
          <span className="tm">正在生成…</span>
        </div>
      </div>
    )
  }
  if (!active) return <div className="rec-control-root" />

  return (
    <div className="rec-control-root">
      <div className="rec-control live">
        <span
          className={`tm${
            state.mode === 'gif' && state.elapsedMs >= 50_000 ? ' warn' : ''
          }`}
        >
          <i className={`dot${state.phase === 'paused' ? ' paused' : ''}`} />
          <span>{formatRecordingDuration(state.elapsedMs)}</span>
        </span>
        {isVideo && (
          <button
            className="cb"
            title={state.phase === 'paused' ? '继续' : '暂停'}
            onClick={() =>
              window.snapglass.recorderControl.command({
                type: state.phase === 'paused' ? 'resume' : 'pause'
              })
            }
          >
            {state.phase === 'paused' ? <PlayIcon /> : <PauseIcon />}
          </button>
        )}
        <button
          className="cb stop"
          title="停止"
          onClick={() => window.snapglass.recorderControl.command({ type: 'stop' })}
        >
          <StopIcon />
        </button>
      </div>
    </div>
  )
}
