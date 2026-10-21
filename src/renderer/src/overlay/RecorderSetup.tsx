import type { JSX } from 'react'
import type {
  Rect,
  RecorderCountdown,
  RecorderFps,
  RecorderMode,
  RecorderOptions,
  RecorderSize
} from '@shared/types'

interface Props {
  mode: RecorderMode
  selection: Rect
  options: RecorderOptions
  onChange(patch: Partial<RecorderOptions>): void
  onStart(): void
  onCancel(): void
}

const FPS_OPTIONS: RecorderFps[] = [10, 15, 30]
const SIZE_OPTIONS: Array<{ value: RecorderSize; label: string }> = [
  { value: 'original', label: '原始' },
  { value: '720', label: '720' },
  { value: '480', label: '480' }
]
const COUNTDOWN_OPTIONS: Array<{ value: RecorderCountdown; label: string }> = [
  { value: 3, label: '3 秒' },
  { value: 1, label: '1 秒' },
  { value: 0, label: '关闭' }
]

export function RecorderSetup({
  mode,
  selection,
  options,
  onChange,
  onStart,
  onCancel
}: Props): JSX.Element {
  const isGif = mode === 'gif'
  return (
    <div className="gif-setup recorder-setup">
      <div className="gif-setup-head">
        <strong>{isGif ? 'GIF 录制' : '视频录制'}</strong>
        <span>
          {Math.round(selection.width)} × {Math.round(selection.height)} ·{' '}
          {isGif ? '最长 60 秒' : '最长 10 分钟'}
        </span>
      </div>
      <div className={`gif-setup-grid${isGif ? '' : ' video-grid'}`}>
        {isGif ? (
          <div className="gif-field">
            <label>帧率</label>
            <div className="gif-seg">
              {FPS_OPTIONS.map((fps) => (
                <button
                  key={fps}
                  className={options.fps === fps ? 'on' : ''}
                  onClick={() => onChange({ fps })}
                >
                  {fps} FPS
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="gif-field">
            <label>声音</label>
            <div className="gif-seg">
              <button
                className={options.mic ? 'on' : ''}
                onClick={() => onChange({ mic: !options.mic })}
              >
                麦克风
              </button>
              <button
                className={options.systemAudio ? 'on' : ''}
                onClick={() => onChange({ systemAudio: !options.systemAudio })}
              >
                系统音
              </button>
            </div>
          </div>
        )}
        <div className="gif-field">
          <label>输出尺寸</label>
          <div className="gif-seg">
            {SIZE_OPTIONS.map((item) => (
              <button
                key={item.value}
                className={options.size === item.value ? 'on' : ''}
                onClick={() => onChange({ size: item.value })}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="gif-field">
          <label>倒计时</label>
          <div className="gif-seg">
            {COUNTDOWN_OPTIONS.map((item) => (
              <button
                key={item.value}
                className={options.countdown === item.value ? 'on' : ''}
                onClick={() => onChange({ countdown: item.value })}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <button className="gif-start" onClick={onStart}>
          开始录制
        </button>
      </div>
      <div className="gif-setup-foot">
        <span>
          {isGif
            ? '建议先把鼠标移到选区外，避免录进点击动作。'
            : '系统音依赖系统与平台支持，不可用时会自动静音。'}
        </span>
        <button onClick={onCancel}>返回工具条</button>
      </div>
    </div>
  )
}
