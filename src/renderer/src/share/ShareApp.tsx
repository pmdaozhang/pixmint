import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { t } from '@shared/i18n'
import type { Settings } from '@shared/types'
import { REFERRAL } from '@shared/referral'
import { applyTheme } from '../theme'
import './share.css'

type Phase = 'loading' | 'ready' | 'copied' | 'failed'
interface Context {
  shareUrl: string
  friendLaunch: boolean
  count: number
}

/** 复制失败时仍展示链接，用户可手动选中复制 */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}

/**
 * 分享弹框：从托盘「分享」打开，贴任务栏右下角。
 * 文案口径：分享 1 次减 5 元，累计 12 次免费升会员，活动截止时间以官方通知为准。
 * 复制成功 0.6 秒后自动关闭窗口，和系统 toast 的节奏一致。
 */
export function ShareApp(): JSX.Element {
  const [language, setLanguage] = useState<Settings['language']>('zh-CN')
  const [progress, setProgress] = useState<{ count: number; active: boolean } | null>(null)
  const [context, setContext] = useState<Context | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pullTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busy = useRef(false)
  const tr = (zh: string, vars?: Record<string, string | number>): string =>
    t(language, zh, vars)

  useLayoutEffect(() => {
    applyTheme('system')
    void Promise.all([
      window.snapglass.settings.get().catch(() => null),
      window.snapglass.referral.progress().catch(() => null),
      window.snapglass.referral.context().catch(() => null)
    ]).then(([settings, nextProgress, nextContext]) => {
      if (settings) {
        setLanguage(settings.language)
        applyTheme(settings.theme)
      }
      // context 带回本地缓存的次数；活动状态以 progress 为准（服务端 ended 会传过来）
      if (nextContext) setProgress({ count: nextContext.count, active: nextProgress?.active ?? true })
      else setProgress(nextProgress)
      setContext(nextContext)
      setPhase(nextContext ? 'ready' : 'failed')
    })
  }, [])

  useEffect(() => {
    if (!context) return
    // 让主进程知道卡片已绘制，可以显示窗口了
    window.snapglass.app.contentReady()
    // 主进程会触发一次后台同步（10 分钟内不重复）；稍后补拉一次，拿到最新次数/活动状态
    pullTimer.current = setTimeout(() => {
      void window.snapglass.referral
        .progress()
        .then((next) => setProgress(next))
        .catch(() => {})
    }, 1800)
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
      if (pullTimer.current) clearTimeout(pullTimer.current)
    }
  }, [context])

  const count = progress?.count ?? 0
  const rest = Math.max(REFERRAL.target - count, 0)

  /**
   * 走主进程 clipboard：Electron 渲染进程里 navigator.clipboard 在窗口刚显示、
   * 尚未拿到焦点时会一直挂起，这里给 1.5 秒超时后退回 execCommand，确保不会卡住。
   */
  async function copyShareLink(url: string): Promise<boolean> {
    const write = window.snapglass.clipboard.writeText(url)
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 1500))
    try {
      const result = await Promise.race([write.then(() => 'ok' as const), timeout])
      if (result === 'ok') return true
    } catch {
      // 下一行走兜底
    }
    write.catch(() => {})
    return legacyCopy(url)
  }

  async function handleCopy(): Promise<void> {
    if (!context || busy.current) return
    busy.current = true
    const ok = await copyShareLink(context.shareUrl)
    if (!ok) {
      setPhase('failed')
      busy.current = false
      return
    }
    setPhase('copied')
    closeTimer.current = setTimeout(() => window.close(), 600)
  }

  const headline = context?.friendLaunch
    ? tr('新伙伴你好，Pixmint 已准备就绪')
    : tr('分享给朋友，会员费最高全免')
  const rule = context?.friendLaunch
    ? tr('你通过朋友分享安装，这次分享已计入对方。想自己省会员费？把你的链接发给朋友同样有效。')
    : tr('分享 1 次减 5 元，累计 12 次免费升会员，活动截止时间以官方通知为准。')

  return (
    <div className="sh-root">
      <section className="sh-card" role="dialog" aria-modal="true" aria-labelledby="sh-title">
        <header className="sh-head">
          <span className="sh-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M3.5 9h17v4h-17zM5.5 13v7.5h13V13M12 9v11.5M12 9S11 4.5 8.2 5.4 8 9 12 9ZM12 9s1-4.5 3.8-3.6S16 9 12 9Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div className="sh-title-wrap">
            <h1 id="sh-title">{headline}</h1>
            <p>{rule}</p>
          </div>
          <button
            className="sh-close"
            type="button"
            aria-label={tr('关闭')}
            onClick={() => window.close()}
          >
            ×
          </button>
        </header>

        <div className="sh-progress">
          <div className="sh-progress-row">
            <span>{tr('已分享 {count} / {target} 次', { count, target: REFERRAL.target })}</span>
            <strong>
              {rest === 0
                ? tr('已达免费线')
                : tr('再分享 {rest} 次免费升会员', { rest })}
            </strong>
          </div>
          <div
            className={`sh-bar${rest === 0 ? ' full' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={REFERRAL.target}
            aria-valuenow={count}
            aria-label={tr('已分享 {count} / {target} 次', {
              count,
              target: REFERRAL.target
            })}
          >
            <i style={{ width: `${Math.min(count / REFERRAL.target, 1) * 100}%` }} />
          </div>
        </div>

        <div className="sh-link-row">
          <code title={context?.shareUrl}>{context?.shareUrl.replace(/^https?:\/\//, '') ?? ''}</code>
        </div>

        <div className="sh-actions">
          <button
            className={`sh-copy${phase === 'copied' ? ' copied' : ''}`}
            type="button"
            onClick={() => void handleCopy()}
            disabled={!context || phase === 'copied'}
          >
            {phase === 'copied'
              ? tr('已复制，正在关闭')
              : tr('复制链接')}
          </button>
          <button className="sh-cancel" type="button" onClick={() => window.close()}>
            {tr('取消')}
          </button>
        </div>
        <p className="sh-foot">{tr('好友安装并首次启动后，本次分享才算有效。')}</p>
      </section>
    </div>
  )
}
