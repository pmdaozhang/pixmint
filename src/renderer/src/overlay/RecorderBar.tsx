import type { JSX } from 'react'
import type { RecorderMode, RecorderSize } from '@shared/types'
import { formatRecordingDuration } from '@shared/recording'
import { t, type Language } from '@shared/i18n'

interface Props {
  mode: RecorderMode
  size: RecorderSize
  mic: boolean
  systemAudio: boolean
  onSizeChange(size: RecorderSize): void
  onMicToggle(): void
  onSystemAudioToggle(): void
  language: Language
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
  size,
  mic,
  systemAudio,
  onSizeChange,
  onMicToggle,
  onSystemAudioToggle,
  language,
  onStart,
  onCancel
}: Props): JSX.Element {
  const tr = (zh: string): string => t(language, zh)
  return (
    <div className="rec-ctrl" aria-label={tr('录制设置')}>
      <button
        className="rec-start"
        title={tr('开始录制')}
        aria-label={tr('开始录制')}
        onClick={onStart}
      >
        <i />
        {tr('开始')}
      </button>
      {mode === 'video' ? (
        <label className="rec-size" title={tr('输出分辨率')}>
          <select
            value={size === '1080' ? '1080' : '720'}
            aria-label={tr('输出分辨率')}
            onChange={(event) => onSizeChange(event.target.value as RecorderSize)}
          >
            <option value="720">720P</option>
            <option value="1080">1080P</option>
          </select>
        </label>
      ) : null}
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
            {tr('麦克风')}
          </button>
          <button
            className={`rec-tog${systemAudio ? ' on' : ''}`}
            onClick={onSystemAudioToggle}
          >
            {tr('系统音')}
          </button>
        </>
      ) : null}
      <span className="div" />
      <button className="cb" title={tr('取消录制')} onClick={onCancel}>
        <CloseIcon />
      </button>
    </div>
  )
}
