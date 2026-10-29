import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import clipUrl from '../assets/onboarding-clip.mp4'

/**
 * 背景：引导页需要循环演示真实操作，但 React 状态每帧更新会带来额外渲染开销。
 * 设计意图：用 interval + ref 直接改样式，组件本身不重渲染；离开页面即停表。
 * 关键约束：所有画面必须由同一个时钟驱动，光标与选区不能各跑一套动画。
 */
function useSceneLoop(active: boolean, duration: number, tick: (progress: number) => void): void {
  const tickRef = useRef(tick)
  tickRef.current = tick
  useEffect(() => {
    if (!active) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      tickRef.current(duration * 0.45)
      return
    }
    const started = performance.now()
    const run = (): void => {
      tickRef.current(((performance.now() - started) / 1000) % duration)
    }
    run()
    const id = window.setInterval(run, 16)
    return () => window.clearInterval(id)
  }, [active, duration])
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function easeOut(value: number): number {
  return 1 - Math.pow(1 - value, 3)
}

function Tags({ items }: { items: string[] }): JSX.Element {
  return (
    <div className="onb-tags">
      {items.map((item) => (
        <span className="onb-tag" key={item}>
          {item}
        </span>
      ))}
    </div>
  )
}

export function GifScene({ active }: { active: boolean }): JSX.Element {
  const selectRef = useRef<HTMLDivElement | null>(null)
  const cursorRef = useRef<HTMLSpanElement | null>(null)
  const tagRef = useRef<HTMLSpanElement | null>(null)
  const timerRef = useRef<HTMLElement | null>(null)
  const dotsRef = useRef<Array<HTMLElement | null>>([])
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useSceneLoop(active, 7, (progress) => {
    const drawEnd = 2
    const ratio =
      progress < 0.4 ? 0 : easeOut(clamp01((progress - 0.4) / (drawEnd - 0.4)))
    const width = 300 * ratio
    const height = 108 * ratio
    if (selectRef.current) {
      selectRef.current.style.width = `${width}px`
      selectRef.current.style.height = `${height}px`
      selectRef.current.style.opacity = progress < 0.4 || progress > 6.6 ? '0' : '1'
    }
    if (cursorRef.current) {
      cursorRef.current.style.transform = `translate(${width}px, ${height}px)`
      cursorRef.current.style.opacity =
        progress < 0.2
          ? '0'
          : progress < 2.15
            ? '1'
            : progress < 2.55
              ? String(clamp01(1 - (progress - 2.15) / 0.4))
              : '0'
    }
    if (tagRef.current) {
      tagRef.current.style.opacity = progress >= drawEnd && progress < 6.6 ? '1' : '0'
    }
    if (timerRef.current) {
      timerRef.current.textContent = `00:0${Math.max(0, progress - drawEnd).toFixed(1)}`
    }
    const lit =
      progress < drawEnd ? 0 : Math.min(6, Math.floor((progress - drawEnd) / 0.6) + 1)
    dotsRef.current.forEach((dot, index) => {
      dot?.classList.toggle('on', index < lit)
    })
    bodyRef.current?.classList.toggle('toggled', progress >= drawEnd && progress < 6.4)
  })

  return (
    <div className={`onb-page${active ? ' active' : ''}`} aria-hidden={!active}>
      <div className="onb-copy">
        <div className="onb-eyebrow">02 · GIF 动画</div>
        <h1>支持录制 GIF 动画</h1>
        <p className="onb-lead">
          划定区域后点 GIF 按钮，自动录制框选区域，
          <span className="onb-nowrap">最长 60 秒</span>。
        </p>
        <Tags items={['GIF 录制', '最长 60 秒']} />
      </div>

      <div className="onb-visual">
        <div className="onb-scene-window">
          <div className="onb-desk-top">
            <i />
            <i />
            <i />
          </div>
          <div className="onb-scene-body" ref={bodyRef}>
            <div className="onb-gif-app">
              <span className="onb-app-title" />
              <div className="onb-app-row">
                <span className="onb-app-dot" />
                <span className="onb-app-line" />
              </div>
              <div className="onb-app-row focus">
                <span className="onb-toggle">
                  <i />
                </span>
                <span className="onb-app-line short" />
              </div>
              <div className="onb-app-row">
                <span className="onb-app-dot" />
                <span className="onb-app-line" />
              </div>
            </div>
            <div className="onb-select onb-gif-select" ref={selectRef}>
              <span className="onb-rec-tag" ref={tagRef}>
                <i />
                REC · GIF <b ref={timerRef}>00:00.0</b>
              </span>
            </div>
            <span className="onb-draw-cursor onb-gif-cursor" ref={cursorRef} aria-hidden="true" />
            <div className="onb-gif-control">
              <span className="onb-gif-fps">15 FPS</span>
              <span className="onb-frame-dots">
                {Array.from({ length: 6 }, (_, index) => (
                  <i
                    key={index}
                    ref={(node) => {
                      dotsRef.current[index] = node
                    }}
                  />
                ))}
              </span>
              <span className="onb-gif-hint">选区录制</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function VideoScene({ active }: { active: boolean }): JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const cursorRef = useRef<HTMLSpanElement | null>(null)
  const tagRef = useRef<HTMLSpanElement | null>(null)
  const timerRef = useRef<HTMLElement | null>(null)

  useSceneLoop(active, 8, (progress) => {
    const drawEnd = 2.2
    const ratio =
      progress < 0.45 ? 0 : easeOut(clamp01((progress - 0.45) / (drawEnd - 0.45)))
    const width = 282 * ratio
    const height = 128 * ratio
    if (boxRef.current) {
      boxRef.current.style.width = `${width}px`
      boxRef.current.style.height = `${height}px`
      boxRef.current.style.opacity = progress < 0.45 || progress > 7.7 ? '0' : '1'
      boxRef.current.classList.toggle('recording', progress >= drawEnd && progress < 7.6)
    }
    if (cursorRef.current) {
      cursorRef.current.style.transform = `translate(${width}px, ${height}px)`
      cursorRef.current.style.opacity =
        progress < 0.25
          ? '0'
          : progress < 2.25
            ? '1'
            : progress < 2.65
              ? String(clamp01(1 - (progress - 2.25) / 0.4))
              : '0'
    }
    if (tagRef.current) {
      tagRef.current.style.opacity =
        progress >= drawEnd && progress < 7.6 ? '1' : '0'
    }
    if (timerRef.current) {
      timerRef.current.textContent = `00:0${Math.floor(Math.max(0, progress - drawEnd))}`
    }
  })

  return (
    <div className={`onb-page${active ? ' active' : ''}`} aria-hidden={!active}>
      <div className="onb-copy">
        <div className="onb-eyebrow">03 · 视频</div>
        <h1>视频也能录制</h1>
        <p className="onb-lead">
          按框选区域录制视频，支持麦克风和系统声音，
          <span className="onb-nowrap">高清 1080P</span>。
        </p>
        <Tags items={['视频录制', '高清 1080P']} />
      </div>

      <div className="onb-visual">
        <div className="onb-scene-window onb-video-window">
          <div className="onb-desk-top">
            <i />
            <i />
            <i />
          </div>
          <div className="onb-scene-body">
            <video className="onb-video" src={clipUrl} autoPlay loop muted playsInline />
            <span className="onb-video-shade" />
            <div className="onb-capture" ref={boxRef}>
              <span className="onb-rec-tag onb-video-tag" ref={tagRef}>
                <i />
                REC <b ref={timerRef}>00:00</b>
              </span>
            </div>
            <span className="onb-draw-cursor onb-video-cursor" ref={cursorRef} aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function OcrScene({ active }: { active: boolean }): JSX.Element {
  const selectRef = useRef<HTMLDivElement | null>(null)
  const cursorRef = useRef<HTMLSpanElement | null>(null)
  const stackRef = useRef<HTMLDivElement | null>(null)

  useSceneLoop(active, 8, (progress) => {
    const drawEnd = 2
    const ratio =
      progress < 0.4 ? 0 : easeOut(clamp01((progress - 0.4) / (drawEnd - 0.4)))
    const width = 300 * ratio
    const height = 118 * ratio
    if (selectRef.current) {
      selectRef.current.style.width = `${width}px`
      selectRef.current.style.height = `${height}px`
      selectRef.current.style.opacity = progress < 0.4 || progress > 7.5 ? '0' : '1'
    }
    if (cursorRef.current) {
      cursorRef.current.style.transform = `translate(${width}px, ${height}px)`
      cursorRef.current.style.opacity =
        progress < 0.2
          ? '0'
          : progress < 1.95
            ? '1'
            : progress < 2.35
              ? String(clamp01(1 - (progress - 1.95) / 0.4))
              : '0'
    }
    stackRef.current?.classList.toggle('show', progress >= 2.1 && progress < 7.2)
  })

  return (
    <div className={`onb-page${active ? ' active' : ''}`} aria-hidden={!active}>
      <div className="onb-copy">
        <div className="onb-eyebrow">04 · 识别与翻译</div>
        <h1>OCR、翻译页都有</h1>
        <p className="onb-lead">框选内容，OCR 识别、翻译任你选，一键复制更方便。</p>
        <Tags items={['OCR 识别', '中英互译']} />
      </div>

      <div className="onb-visual onb-ocr-visual">
        <div className="onb-ocr-stage">
          <div className="onb-ocr-doc-wrap">
            <div className="onb-ocr-doc">
              <p className="onb-ocr-cn">
                把眼前的文字，
                <br />
                变成可以继续使用的文本。
              </p>
              <p className="onb-ocr-en">Turn what you see into text you can use.</p>
            </div>
            <div className="onb-select onb-ocr-select" ref={selectRef} />
            <span className="onb-draw-cursor onb-ocr-cursor" ref={cursorRef} aria-hidden="true" />
          </div>
          <div className="onb-ocr-stack" ref={stackRef}>
            <div className="onb-ocr-card">
              <small>识别原文</small>
              <p>把眼前的文字，变成可以继续使用的文本。</p>
            </div>
            <span className="onb-ocr-arrow">↓</span>
            <div className="onb-ocr-card translated">
              <small>翻译结果</small>
              <p>Turn what you see into text you can use.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
