import { Fragment, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { LineStyle, Settings, ThemeSetting } from '@shared/types'
import { drawArrowHead, strokePathStyled } from '../overlay/annotation/draw'
import { GifScene, OcrScene, VideoScene } from './OnboardingScenes'
import './onboarding.css'

const ONBOARDING_VERSION = 2

const STYLE_OPTIONS: Array<{ value: LineStyle; label: string }> = [
  { value: 'solid', label: '实线' },
  { value: 'thin', label: '细线' },
  { value: 'dotted', label: '点线' }
]

function applyTheme(theme: ThemeSetting): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.dataset.theme = theme === 'system' ? (media ? 'dark' : 'light') : theme
}

function BrandMark(): JSX.Element {
  return (
    <span className="onb-brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M6 7.5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <circle cx="9.2" cy="12.8" r="1.1" fill="currentColor" />
        <circle cx="14.8" cy="12.8" r="1.1" fill="currentColor" />
        <path d="M17 3.5h3.5V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  )
}

function LineStyleOption({ style, label }: { style: LineStyle; label: string }): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const width = 64
    const height = 18
    const dpr = window.devicePixelRatio || 1
    const baseW = Math.max(2, Math.min(3.4, height / 5.5))
    const midY = height / 2
    const tipX = width - 3
    const lineEndX = tipX - Math.max(4, baseW * 2)
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    strokePathStyled(
      ctx,
      [
        { x: 4, y: midY },
        { x: lineEndX, y: midY }
      ],
      style,
      baseW,
      '#e64545'
    )
    drawArrowHead(ctx, 4, midY, tipX, midY, style, baseW * 0.75, '#e64545')
  }, [style])
  return (
    <span className="onb-style-cell" title={label}>
      <canvas ref={ref} className="onb-style-canvas" />
    </span>
  )
}

function CursorPath(): JSX.Element {
  return (
    <path
      d="M0 0 14 10.5 7.3 11.5 4.8 18.5 0 0Z"
      fill="currentColor"
      stroke="var(--bg-2)"
      strokeWidth="1"
      strokeLinejoin="round"
    />
  )
}

function CaptureDemo(): JSX.Element {
  const rectRef = useRef<HTMLDivElement | null>(null)
  const pointerRef = useRef<HTMLSpanElement | null>(null)
  const startRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const duration = 5000
    const maxWidth = 156
    const maxHeight = 106
    const started = performance.now()
    let frame = 0
    const ease = (value: number): number => value * value * (3 - 2 * value)
    const tick = (now: number): void => {
      const progress = ((now - started) % duration) / duration
      let width = 2
      let height = 2
      let opacity = 0
      let pointerOpacity = 0
      let startOpacity = 0
      let startScale = 0.4
      if (progress >= 0.18 && progress < 0.24) {
        opacity = 1
        pointerOpacity = 1
      } else if (progress >= 0.24 && progress < 0.56) {
        const value = ease((progress - 0.24) / 0.32)
        width = 2 + (maxWidth - 2) * value
        height = 2 + (maxHeight - 2) * value
        opacity = 1
        pointerOpacity = 1
      } else if (progress >= 0.56 && progress < 0.84) {
        width = maxWidth
        height = maxHeight
        opacity = 1
        pointerOpacity = 1
      } else if (progress >= 0.84 && progress < 0.9) {
        const value = (progress - 0.84) / 0.06
        width = maxWidth
        height = maxHeight
        opacity = 1 - value
        pointerOpacity = 1 - value
      }
      if (progress >= 0.18 && progress < 0.3) {
        const value = (progress - 0.18) / 0.12
        startOpacity = value < 0.25 ? (value / 0.25) * 0.9 : 0.9 * (1 - (value - 0.25) / 0.75)
        startScale = 0.4 + value * 1.8
      }
      if (rectRef.current) {
        rectRef.current.style.width = `${width}px`
        rectRef.current.style.height = `${height}px`
        rectRef.current.style.opacity = String(opacity)
      }
      if (pointerRef.current) {
        pointerRef.current.style.transform = `translate(${width}px, ${height}px)`
        pointerRef.current.style.opacity = String(pointerOpacity)
      }
      if (startRef.current) {
        startRef.current.style.opacity = String(startOpacity)
        startRef.current.style.transform = `scale(${startScale})`
      }
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <>
      <div className="onb-capture-rect" ref={rectRef} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <span className="onb-capture-start" ref={startRef} aria-hidden="true" />
      <span className="onb-capture-cursor" ref={pointerRef} aria-hidden="true">
        <svg viewBox="0 0 24 28" fill="none">
          <path
            d="M3 2.8 20.5 14l-8.3 1.5L8 23.2 3 2.8Z"
            fill="currentColor"
            stroke="var(--bg-2)"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </>
  )
}

function StepOne({ shortcut, active }: { shortcut: string; active: boolean }): JSX.Element {
  return (
    <div className={`onb-page${active ? ' active' : ''}`} aria-hidden={!active}>
      <div className="onb-copy">
        <div className="onb-eyebrow">04 · 快捷键</div>
        <h1>
          按一下 {shortcut}，
          <br />
          截下眼前的画面。
        </h1>
        <p className="onb-lead">
          Pixmint 会安静地待在系统托盘。需要截图时，按下默认快捷键即可直接框选区域。
        </p>

        <div className="onb-shortcut-card">
          <span
            className="onb-keycap"
            style={{
              fontSize: shortcut.length > 8 ? 9 : shortcut.length > 4 ? 12 : 15
            }}
            aria-hidden="true"
          >
            {shortcut}
          </span>
          <span className="onb-shortcut-copy">
            <strong>默认截图快捷键</strong>
            <span>之后可在设置中修改</span>
          </span>
        </div>

        <div className="onb-feature-row">
          <span>框选截图</span>
          <i />
          <span>标注</span>
          <i />
          <span>OCR 识别</span>
        </div>
      </div>

      <div className="onb-visual onb-visual-one" aria-label="按快捷键呼出区域截图示意">
        <div className="onb-desk-window">
          <div className="onb-desk-top">
            <i />
            <i />
            <i />
          </div>
          <div className="onb-desk-body">
            <div className="onb-desk-side">
              <span style={{ width: 42 }} />
              <span style={{ width: 35 }} />
              <span style={{ width: 48 }} />
              <span style={{ width: 30 }} />
            </div>
            <div className="onb-desk-main">
              <div className="onb-desk-hero" />
              <div className="onb-desk-lines">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
          <CaptureDemo />
        </div>

        <div className="onb-pressed-bubble" aria-hidden="true">
          <i />
          <span>
            <b>{shortcut}</b> 已按下 · 正在框选
          </span>
        </div>
      </div>
    </div>
  )
}

function StepTwo({
  demoKey,
  active,
  onReplay
}: {
  demoKey: number
  active: boolean
  onReplay(): void
}): JSX.Element {
  return (
    <div className={`onb-page${active ? ' active' : ''}`} aria-hidden={!active}>
      <div className="onb-copy onb-copy-two">
        <div className="onb-eyebrow">05 · 划线工具</div>
        <h1>
          拖一下，
          <br />
          或者点两下。
        </h1>
        <p className="onb-lead">
          按住鼠标拖拽可以自由画线；也可以先单击起点，再单击终点，拉出一条直线。
        </p>

        <div className="onb-method-list">
          <div className="onb-method">
            <span className="onb-method-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 19 17 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path
                  d="m4 19 1.4-5.1L16.8 2.5l2.7 2.7L8.1 16.6 4 19Z"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>
              <strong>按住拖拽</strong>
              <span>想画多长，就拖多长</span>
            </span>
          </div>

          <div className="onb-method">
            <span className="onb-method-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="5" cy="17" r="2.2" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="19" cy="7" r="2.2" fill="currentColor" />
                <path d="M7 16 17 8" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 3" />
              </svg>
            </span>
            <span>
              <strong>单击两次</strong>
              <span>第一次定起点，第二次定终点</span>
            </span>
          </div>
        </div>

        <div className="onb-style-note">
          <div className="onb-style-head">线条风格</div>
          <div className="onb-style-row" aria-label="软件中的线条风格选项">
            {STYLE_OPTIONS.map((option) => (
              <LineStyleOption key={option.value} style={option.value} label={option.label} />
            ))}
          </div>
        </div>

        <div className="onb-tip-line">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12 10.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="7.8" r="1" fill="currentColor" />
          </svg>
          <span>画好后，切回线条工具仍可拖动；文字可拖动，单击继续编辑。</span>
        </div>
      </div>

      <div className="onb-visual onb-visual-two" aria-label="划线工具两种用法动画">
        <div className="onb-draw-stage">
          <div className="onb-demo-content" key={demoKey}>
            <div className="onb-mode-chips" aria-hidden="true">
              <span className="onb-chip onb-chip-drag">按住拖拽</span>
              <span className="onb-chip onb-chip-two">单击两次</span>
            </div>

            <div className="onb-draw-canvas">
              <svg viewBox="0 0 360 250" fill="none" aria-hidden="true">
                <path
                  id="onb-drag-path"
                  className="onb-demo-line onb-line-drag"
                  d="M50 180 C115 55 220 215 300 95"
                  pathLength="1"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    dur="8s"
                    repeatCount="indefinite"
                    calcMode="linear"
                    keyTimes="0;0.08;0.38;1"
                    values="1;1;0;0"
                  />
                  <animate
                    attributeName="opacity"
                    dur="8s"
                    repeatCount="indefinite"
                    calcMode="linear"
                    keyTimes="0;0.06;0.08;0.44;0.46;1"
                    values="0;0;1;1;0;0"
                  />
                </path>
                <g className="onb-arrow-head onb-arrow-drag" transform="translate(300 95) rotate(-56.3)">
                  <path d="M0 0 -13 5.5 -13 -5.5Z" />
                </g>

                <path
                  id="onb-two-path"
                  className="onb-demo-line onb-line-two"
                  d="M60 90 L300 175"
                  pathLength="1"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    dur="8s"
                    repeatCount="indefinite"
                    calcMode="linear"
                    keyTimes="0;0.63;0.82;1"
                    values="1;1;0;0"
                  />
                  <animate
                    attributeName="opacity"
                    dur="8s"
                    repeatCount="indefinite"
                    calcMode="linear"
                    keyTimes="0;0.61;0.63;0.90;0.92;1"
                    values="0;0;1;1;0;0"
                  />
                </path>
                <g className="onb-arrow-head onb-arrow-two" transform="translate(300 175) rotate(19.5)">
                  <path d="M0 0 -13 5.5 -13 -5.5Z" />
                </g>

                <circle className="onb-click-point onb-click-start" cx="60" cy="90" r="4.5" />
                <circle className="onb-click-ring onb-ring-start" cx="60" cy="90" r="7" />
                <circle className="onb-click-point onb-click-end" cx="300" cy="175" r="4.5" />
                <circle className="onb-click-ring onb-ring-end" cx="300" cy="175" r="7" />

                <g className="onb-pointer onb-pointer-drag">
                  <animate
                    attributeName="opacity"
                    dur="8s"
                    repeatCount="indefinite"
                    calcMode="linear"
                    keyTimes="0;0.05;0.08;0.44;0.46;1"
                    values="0;0;1;1;0;0"
                  />
                  <animateMotion
                    dur="8s"
                    repeatCount="indefinite"
                    calcMode="linear"
                    keyPoints="0;0;1;1"
                    keyTimes="0;0.08;0.38;1"
                  >
                    <mpath href="#onb-drag-path" />
                  </animateMotion>
                  <CursorPath />
                </g>
                <g className="onb-pointer onb-pointer-two">
                  <animate
                    attributeName="opacity"
                    dur="8s"
                    repeatCount="indefinite"
                    calcMode="linear"
                    keyTimes="0;0.54;0.57;0.88;0.90;1"
                    values="0;0;1;1;0;0"
                  />
                  <animateMotion
                    dur="8s"
                    repeatCount="indefinite"
                    calcMode="linear"
                    keyPoints="0;0;1;1"
                    keyTimes="0;0.62;0.82;1"
                  >
                    <mpath href="#onb-two-path" />
                  </animateMotion>
                  <CursorPath />
                </g>
              </svg>
            </div>
          </div>

          <span className="onb-mode-caption">两种方式都会循环演示</span>
          <button className="onb-replay" type="button" onClick={onReplay}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 9a8 8 0 1 1-.6 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path
                d="M5 4v5h5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            重播
          </button>
        </div>
      </div>
    </div>
  )
}

export function OnboardingApp(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [step, setStep] = useState(1)
  const [demoKey, setDemoKey] = useState(0)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.snapglass.settings
      .get()
      .then((next) => {
        if (cancelled) return
        setSettings(next)
        applyTheme(next.theme)
      })
      .catch(() => applyTheme('system'))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (step === 5) setDemoKey((value) => value + 1)
  }, [step])

  const shortcut = settings?.shortcut.replace('CommandOrControl', 'Ctrl') || 'F1'

  const finish = async (): Promise<void> => {
    if (finishing) return
    setFinishing(true)
    try {
      await window.snapglass.settings.update({
        onboardingCompleted: true,
        onboardingVersion: ONBOARDING_VERSION
      })
    } catch {
      // 主进程在引导展示时已写入完成标记，这里失败也不阻止关闭。
    }
    window.close()
  }

  return (
    <div className="onboarding-root">
      <section className="onb-card" aria-label="Pixmint 首次使用引导">
        <header className="onb-top">
          <div className="onb-brand">
            <BrandMark />
            Pixmint
          </div>

          <div className="onb-stepper" aria-label="引导进度">
            {Array.from({ length: 5 }, (_, index) => (
              <Fragment key={index}>
                {index > 0 && <span className="onb-step-line" />}
                <button
                  type="button"
                  className={`onb-step-dot${step === index + 1 ? ' active' : ''}${
                    step > index + 1 ? ' done' : ''
                  }`}
                  aria-label={`第 ${index + 1} 页`}
                  onClick={() => setStep(index + 1)}
                >
                  {index + 1}
                </button>
              </Fragment>
            ))}
          </div>

          <button className="onb-skip" type="button" onClick={() => void finish()}>
            跳过
          </button>
        </header>

        <div className="onb-pages">
          <GifScene active={step === 1} />
          <VideoScene active={step === 2} />
          <OcrScene active={step === 3} />
          <StepOne shortcut={shortcut} active={step === 4} />
          <StepTwo
            demoKey={demoKey}
            active={step === 5}
            onReplay={() => setDemoKey((value) => value + 1)}
          />
        </div>

        <footer className="onb-foot">
          <div className="onb-dots" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <i key={index} className={step === index + 1 ? 'active' : ''} />
            ))}
          </div>
          <div className="onb-foot-actions">
            {step > 1 && (
              <button className="onb-ghost" type="button" onClick={() => setStep(step - 1)}>
                上一步
              </button>
            )}
            <button
              className="onb-primary"
              type="button"
              disabled={finishing}
              onClick={() => {
                if (step < 5) setStep(step + 1)
                else void finish()
              }}
            >
              {step < 5 ? '下一步' : '开始使用'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
