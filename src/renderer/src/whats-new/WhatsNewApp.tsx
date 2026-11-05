import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { Settings, ThemeSetting, UpdateState } from '@shared/types'
import { t } from '@shared/i18n'
import './whats-new.css'

/** 窗口尺寸 = 卡片高度 + 四周 28px 透明阴影边距 */
const SHADOW_PADDING = 56
/** 内容区最高高度，超出后内部滚动 */
const MAX_BODY_HEIGHT = 520
const MIN_WINDOW_HEIGHT = 380
const MAX_WINDOW_HEIGHT = 860

function applyTheme(theme: ThemeSetting): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.dataset.theme = theme === 'system' ? (media ? 'dark' : 'light') : theme
}

/** 与首次引导页相同的品牌标识 */
function BrandMark(): JSX.Element {
  return (
    <span className="wn-logo" aria-hidden="true">
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

function parseDemo(): { version: string; notes: string } | null {
  const hash = window.location.hash
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  if (!query) return null
  const params = new URLSearchParams(query)
  const version = params.get('version')
  if (!version) return null
  return { version, notes: params.get('notes') ?? '' }
}

/**
 * 新版本介绍页：说明本次更新内容，提供“立即更新”和“跳过此版本”。
 * 正常运行时从 updater 状态读取版本号与 release notes；
 * 带 ?version= 参数时用于开发和 E2E 预览。
 */
export function WhatsNewApp(): JSX.Element {
  const demo = parseDemo()
  const [state, setState] = useState<UpdateState>(
    demo
      ? { status: 'available', version: demo.version, releaseNotes: demo.notes }
      : { status: 'idle' }
  )
  const [settings, setSettings] = useState<Settings | null>(null)
  const headRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const footRef = useRef<HTMLElement | null>(null)

  // 在设置读取完成前先跟随系统主题，避免默认深色一闪
  useLayoutEffect(() => {
    applyTheme('system')
  }, [])

  useEffect(() => {
    if (demo) return
    let active = true
    void window.snapglass.updater.getState().then((next) => {
      if (active) setState(next)
    })
    const off = window.snapglass.updater.onState((next) => {
      if (active) setState(next)
    })
    return () => {
      active = false
      off()
    }
  }, [demo])

  useEffect(() => {
    void window.snapglass.settings
      .get()
      .then((next) => {
        setSettings(next)
        applyTheme(next.theme)
      })
      .catch(() => applyTheme('system'))
  }, [])

  const language = settings?.language ?? 'zh-CN'
  const tr = (zh: string, vars?: Record<string, string | number>): string =>
    t(language, zh, vars)

  const version = state.version ?? ''
  const notes = (state.releaseNotes ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6)
  const list = notes.length > 0 ? notes : [tr('性能与稳定性改进')]

  const downloading = state.status === 'downloading' || state.status === 'verifying'
  const installing = state.status === 'installing'
  const downloaded = state.status === 'downloaded'
  const busy = downloading || installing

  // 窗口高度随更新条目多少变化：测出内容高度后交给主进程调整窗口
  const contentKey = `${language}:${state.status}:${list.length}:${state.error ?? ''}`
  useEffect(() => {
    const body = bodyRef.current
    const head = headRef.current
    const foot = footRef.current
    if (!body) return
    let frame = 0
    let applied = 0
    const sync = (): void => {
      const bodyHeight = Math.min(body.scrollHeight, MAX_BODY_HEIGHT)
      const cardHeight = (head?.offsetHeight ?? 60) + bodyHeight + (foot?.offsetHeight ?? 67) + 2
      const target = Math.max(
        MIN_WINDOW_HEIGHT,
        Math.min(MAX_WINDOW_HEIGHT, Math.round(cardHeight + SHADOW_PADDING))
      )
      if (target === applied) return
      applied = target
      window.snapglass?.whatsNew?.resize(target)
    }
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(sync)
    }
    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(body)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [contentKey])

  const primary = async (): Promise<void> => {
    if (downloaded) {
      await window.snapglass.updater.install()
      return
    }
    await window.snapglass.updater.download()
  }

  const skip = async (): Promise<void> => {
    if (version) {
      await window.snapglass.settings
        .update({ skippedUpdateVersion: version })
        .catch(() => {})
    }
    window.close()
  }

  const primaryLabel = downloaded
    ? tr('重启并安装')
    : downloading
      ? tr('下载中…')
      : installing
        ? tr('安装中…')
        : tr('立即更新')

  return (
    <div className="wn-root">
      <section className="wn-card" aria-label={tr('新版本介绍')}>
        <header className="wn-head" ref={headRef}>
          <div className="wn-brand">
            <BrandMark />
            <span>Pixmint</span>
          </div>
          <button className="wn-close" type="button" aria-label={tr('关闭')} onClick={skip}>
            ×
          </button>
        </header>

        <div className="wn-body" ref={bodyRef}>
          <div className="wn-eyebrow">{tr('新功能')}</div>
          <h1>{version ? tr('发现新版本 v{version}', { version }) : tr('发现新版本')}</h1>
          <p className="wn-lead">{tr('这次更新带来了这些变化：')}</p>
          <ul className="wn-list">
            {list.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          {downloading && (
            <div className="wn-progress-block">
              <div className="wn-progress-track">
                <div
                  className="wn-progress-fill"
                  style={{ width: `${Math.round(state.progress?.percent ?? 0)}%` }}
                />
              </div>
              <span>{Math.round(state.progress?.percent ?? 0)}%</span>
            </div>
          )}
          {state.status === 'error' && state.error && (
            <div className="wn-error">{state.error}</div>
          )}
        </div>

        <footer className="wn-foot" ref={footRef}>
          <button className="wn-secondary" type="button" onClick={skip}>
            {tr('跳过此版本')}
          </button>
          <button className="wn-primary" type="button" disabled={busy} onClick={() => void primary()}>
            {primaryLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}
