import type { JSX } from 'react'
import type { RecorderMode } from '@shared/types'
import { formatRecordingDuration } from '@shared/recording'

interface Props {
  mode: RecorderMode
  mic: boolean
  systemAudio: boolean
  onMicToggle(): void
  onSystemAudioToggle(): void
  onStart(): void
  onCancel(): void
}

function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function RecorderBar({
  mode,
  mic,
  systemAudio,
  onMicToggle,
  onSystemAudioToggle,
  onStart,
  onCancel
}: Props): JSX.Element {
  return (
    <div className="rec-ctrl" aria-label="录制设置">
      <button
        className="rec-start"
        title="开始录制"
        aria-label="开始录制"
        onClick={onStart}
      >
        <i />
        开始
      </button>
      <span className="tm">
        <span>{formatRecordingDuration(0)}</span>
      </span>
      {mode === 'video' ? (
        <>
          <span className="div" />
          <button
            className={`rec-tog${mic ? ' on' : ''}`}
            onClick={onMicToggle}
          >
            麦克风
          </button>
          <button
            className={`rec-tog${systemAudio ? ' on' : ''}`}
            onClick={onSystemAudioToggle}
          >
            系统音
          </button>
        </>
      ) : null}
      <span className="div" />
      <button className="cb" title="取消录制" onClick={onCancel}>
        <CloseIcon />
      </button>
    </div>
  )
}
