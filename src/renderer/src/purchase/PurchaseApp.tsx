import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  PURCHASE_PLANS,
  type LicenseStatus,
  type PaymentProvider,
  type PurchaseOrder
} from '@shared/license'
import type { Settings, ThemeSetting } from '@shared/types'
import type { UsageFeature, UsageView } from '@shared/usage'
import { t } from '@shared/i18n'
import './purchase.css'

const SHADOW_PADDING = 56
const MIN_WINDOW_HEIGHT = 480
const MAX_WINDOW_HEIGHT = 880

type PlanId = 'monthly' | 'yearly' | 'lifetime'
type Step = 'plans' | 'pay' | 'done' | 'activate' | 'invite'

const FEATURE_LABEL: Record<UsageFeature, string> = {
  ocr: 'OCR 识别',
  translate: '翻译',
  gif: 'GIF 录制',
  video: '视频录制'
}

function readableError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^LicenseApiError:\s*/, '')
    .trim()
}

function applyTheme(theme: ThemeSetting): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.dataset.theme = theme === 'system' ? (media ? 'dark' : 'light') : theme
}

function parseFeature(): UsageFeature | null {
  const hash = window.location.hash
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const value = new URLSearchParams(query).get('feature')
  return value === 'ocr' || value === 'translate' || value === 'gif' || value === 'video'
    ? value
    : null
}

function formatDate(value: number | null): string {
  if (!value) return '永久'
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

const PLAN_META: Record<
  PlanId,
  { name: string; price: string; unit: string; note: string; badge?: string }
> = {
  monthly: { name: '按月', price: '9', unit: '/ 月', note: '30 天完整 Pro' },
  yearly: { name: '按年', price: '80', unit: '/ 年', note: '365 天完整 Pro', badge: '省 26%' },
  lifetime: {
    name: '终身',
    price: '198',
    unit: '',
    note: '一次付费 · 永久使用 · 1.x 免费更新',
    badge: '最划算'
  }
}

function PlanIcon({ plan }: { plan: PlanId }): JSX.Element {
  if (plan === 'monthly') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="5.5" width="16" height="15" rx="3" stroke="currentColor" strokeWidth="1.7" />
        <path d="M4 10h16M8 3.5v4M16 3.5v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="9" cy="14.5" r="1" fill="currentColor" />
        <circle cx="15" cy="14.5" r="1" fill="currentColor" />
      </svg>
    )
  }
  if (plan === 'yearly') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3.5 14.2 8l4.8.6-3.5 3.4.9 4.9L12 14.6 7.6 16.9l.9-4.9L5 8.6 9.8 8 12 3.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7.5 9.2c2.1 0 3.1 2.8 4.5 2.8s2.4-2.8 4.5-2.8a3.1 3.1 0 0 1 0 6.2c-2.1 0-3.1-2.8-4.5-2.8s-2.4 2.8-4.5 2.8a3.1 3.1 0 0 1 0-6.2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BrandMark(): JSX.Element {
  return (
    <span className="pc-logo" aria-hidden="true">
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

export function PurchaseApp(): JSX.Element {
  const [feature, setFeature] = useState<UsageFeature | null>(() => parseFeature())
  const cardRef = useRef<HTMLElement | null>(null)
  const [usage, setUsage] = useState<UsageView | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [step, setStep] = useState<Step>('plans')
  const [plan, setPlan] = useState<PlanId>('lifetime')
  const [provider, setProvider] = useState<PaymentProvider>('alipay')
  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const language = settings?.language ?? 'zh-CN'
  const tr = (zh: string, vars?: Record<string, string | number>): string =>
    t(language, zh, vars)

  // 同一个窗口再次打开（例如从设置页升级）时 hash 变化，需要回到套餐页
  useEffect(() => {
    const onHashChange = (): void => {
      setFeature(parseFeature())
      setStep('plans')
      setOrder(null)
      setCode('')
      setMessage('')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useLayoutEffect(() => {
    applyTheme('system')
    void Promise.all([
      window.snapglass.usage.get().catch(() => null),
      window.snapglass.settings.get().catch(() => null),
      window.snapglass.license.status().catch(() => null)
    ]).then(([nextUsage, nextSettings, nextStatus]) => {
      if (nextUsage) setUsage(nextUsage)
      if (nextSettings) {
        setSettings(nextSettings)
        applyTheme(nextSettings.theme)
        setEmail(nextStatus?.email ?? '')
      }
      if (nextStatus) {
        setStatus(nextStatus)
        if (nextStatus.code) setCode(nextStatus.code)
      }
    })
  }, [])

  // 窗口高度随步骤内容变化
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    let frame = 0
    let applied = 0
    const sync = (): void => {
      const target = Math.max(
        MIN_WINDOW_HEIGHT,
        Math.min(MAX_WINDOW_HEIGHT, Math.round(card.scrollHeight + SHADOW_PADDING))
      )
      if (target === applied) return
      applied = target
      window.snapglass.purchase.resize(target)
    }
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(sync)
    }
    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(card)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [step, message, usage, status])

  // 支付轮询
  useEffect(() => {
    if (step !== 'pay' || !order) return
    let active = true
    const timer = window.setInterval(() => {
      void window.snapglass.purchase
        .orderStatus(order.orderId, order.orderToken)
        .then(async (next) => {
          if (!active) return
          if (next.status === 'paid') {
            active = false
            window.clearInterval(timer)
            if (next.code) setCode(next.code)
            const nextStatus = await window.snapglass.license.status().catch(() => null)
            if (nextStatus) setStatus(nextStatus)
            setStep('done')
            return
          }
          if (next.status === 'expired' || next.status === 'refunded') {
            active = false
            window.clearInterval(timer)
            setMessage(
              next.status === 'expired'
                ? tr('二维码已过期，请重新下单')
                : tr('订单已退款')
            )
            setStep('plans')
          }
        })
        .catch(() => {
          // 网络抖动时继续轮询，不打断支付
        })
    }, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, order])

  const featureLimit = feature && usage ? (usage.limits[feature] ?? 0) : 0
  const exhausted = Boolean(feature && usage && usage.remaining[feature] === 0)

  const buy = useCallback(async () => {
    setBusy(true)
    setMessage('')
    try {
      const created = await window.snapglass.purchase.createOrder(plan, provider)
      setOrder(created)
      setStep('pay')
    } catch (error) {
      setMessage(readableError(error) || tr('支付暂未开放，请稍后再试'))
    } finally {
      setBusy(false)
    }
  }, [plan, provider, tr])

  const activate = useCallback(async () => {
    const value = code.trim()
    if (!value) return
    setBusy(true)
    setMessage('')
    try {
      await window.snapglass.license.activate(value)
      const nextStatus = await window.snapglass.license.status()
      setStatus(nextStatus)
      const nextUsage = await window.snapglass.usage.get().catch(() => null)
      if (nextUsage) setUsage(nextUsage)
      setStep('done')
    } catch (error) {
      setMessage(readableError(error))
    } finally {
      setBusy(false)
    }
  }, [code])

  const redeemInvite = useCallback(async () => {
    const value = code.trim()
    if (!value) return
    setBusy(true)
    setMessage('')
    try {
      const activation = await window.snapglass.license.trial(value)
      setCode(activation.code)
      const nextStatus = await window.snapglass.license.status()
      setStatus(nextStatus)
      setStep('done')
    } catch (error) {
      setMessage(readableError(error))
    } finally {
      setBusy(false)
    }
  }, [code])

  const sendEmail = useCallback(async () => {
    const value = email.trim()
    if (!value) return
    setBusy(true)
    setMessage('')
    try {
      await window.snapglass.license.email(value)
      setMessage(tr('激活码已发送到 {email}', { email: value }))
    } catch (error) {
      setMessage(readableError(error))
    } finally {
      setBusy(false)
    }
  }, [email, tr])

  const copyCode = (): void => {
    if (!code) return
    void navigator.clipboard.writeText(code)
    setMessage(tr('激活码已复制'))
  }

  const qrSrc = order?.qrSvg
    ? `data:image/svg+xml;utf8,${encodeURIComponent(order.qrSvg)}`
    : order?.qrDataUrl ?? ''

  return (
    <div className="pc-root">
      <section className="pc-card" aria-label={tr('升级 Pixmint Pro')} ref={cardRef}>
        <header className="pc-head">
          <div className="pc-brand">
            <BrandMark />
            <span>Pixmint Pro</span>
          </div>
          <button className="pc-close" type="button" aria-label={tr('关闭')} onClick={() => window.close()}>
            ×
          </button>
        </header>

        <div className="pc-body">
          {step === 'plans' && (
            <>
              <div className="pc-eyebrow">{tr('免费额度')}</div>
              <h1>
                {exhausted
                  ? tr('今日 {limit} 次 {feature}用完啦，明天再来吧！', {
                      limit: featureLimit,
                      feature: feature ? tr(FEATURE_LABEL[feature]) : ''
                    })
                  : status?.pro
                    ? tr('你已是 Pro，感谢支持')
                    : tr('升级 Pro，解锁无限使用')}
              </h1>
              <p className="pc-lead">
                {tr(
                  '截图、标注、钉图永久免费；Pro解锁OCR、翻译、GIF与视频录制无限次，也包括后续即将上线的新奇功能哦~'
                )}
              </p>

              <div className="pc-plans">
                {PURCHASE_PLANS.map((item) => {
                  const meta = PLAN_META[item.id]
                  const selected = plan === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-plan={item.id}
                      className={`pc-plan${selected ? ' on' : ''}${
                        item.id === 'lifetime' ? ' recommended' : ''
                      }`}
                      onClick={() => setPlan(item.id)}
                    >
                      {meta.badge && <span className="pc-plan-badge">{tr(meta.badge)}</span>}
                      <span className="pc-plan-top">
                        <span className="pc-plan-icon">
                          <PlanIcon plan={item.id} />
                        </span>
                        <span className="pc-plan-name">{tr(meta.name)}</span>
                        {selected && (
                          <svg className="pc-plan-check" viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" fill="currentColor" />
                            <path
                              d="m7.5 12.2 3 3 6-6.4"
                              fill="none"
                              stroke="var(--bg)"
                              strokeWidth="2.1"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                      <span className="pc-plan-price">
                        <em>¥</em>
                        {meta.price}
                        {meta.unit && <small>{tr(meta.unit)}</small>}
                      </span>
                      <span className="pc-plan-desc">{tr(meta.note)}</span>
                    </button>
                  )
                })}
              </div>

              <div className="pc-perks">
                {['无限 OCR', '无限翻译', 'GIF / 视频无限录制', '未来 Pro 功能'].map((perk) => (
                  <span key={perk}>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="m5.5 12.5 4.2 4.2 8.8-9"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {tr(perk)}
                  </span>
                ))}
              </div>

              <div className="pc-provider">
                <span>{tr('支付方式')}</span>
                <div className="pc-seg">
                  <button
                    type="button"
                    className={provider === 'alipay' ? 'on' : ''}
                    onClick={() => setProvider('alipay')}
                  >
                    {tr('支付宝')}
                  </button>
                  <button
                    type="button"
                    className={provider === 'wechat' ? 'on' : ''}
                    onClick={() => setProvider('wechat')}
                  >
                    {tr('微信支付')}
                  </button>
                </div>
              </div>

              {message && <div className="pc-message">{message}</div>}

              <button className="pc-primary" type="button" disabled={busy} onClick={() => void buy()}>
                {busy ? tr('正在创建订单…') : tr('立即购买')}
              </button>

              <div className="pc-links">
                <button type="button" onClick={() => { setCode(''); setMessage(''); setStep('activate') }}>
                  {tr('已有激活码')}
                </button>
                <button type="button" onClick={() => { setCode(''); setMessage(''); setStep('invite') }}>
                  {tr('填写邀请码，领 7 天 Pro')}
                </button>
              </div>
            </>
          )}

          {step === 'pay' && order && (
            <>
              <div className="pc-eyebrow">{tr('扫码支付')}</div>
              <h1>{tr('用手机扫码完成支付')}</h1>
              <p className="pc-lead">
                {tr('支付成功后会自动激活，本窗口无需其他操作。')}
              </p>
              <div className="pc-qr">
                {qrSrc ? (
                  <img src={qrSrc} alt={tr('支付二维码')} />
                ) : (
                  <div className="pc-qr-fallback">
                    {order.payUrl ?? tr('二维码生成中…')}
                  </div>
                )}
              </div>
              <div className="pc-pay-note">
                {provider === 'alipay' ? tr('请使用支付宝扫码') : tr('请使用微信扫码；如无法支付，请在手机浏览器打开')}
              </div>
              <button className="pc-secondary" type="button" onClick={() => setStep('plans')}>
                {tr('返回套餐')}
              </button>
            </>
          )}

          {step === 'done' && (
            <>
              <div className="pc-eyebrow">{tr('已激活')}</div>
              <h1>{status?.pro ? tr('Pro 已激活') : tr('授权已更新')}</h1>
              <p className="pc-lead">
                {status?.expiresAt
                  ? tr('有效期至 {date}', { date: formatDate(status.expiresAt) })
                  : tr('已解锁全部 Pro 功能')}
              </p>

              {(code || status?.code) && (
                <div className="pc-code">
                  <span>{tr('激活码')}</span>
                  <code>{code || status?.code}</code>
                  <button type="button" onClick={copyCode}>
                    {tr('复制')}
                  </button>
                </div>
              )}

              <div className="pc-email">
                <label htmlFor="pc-email-input">{tr('输入邮箱，把激活码发给你')}</label>
                <div className="pc-email-row">
                  <input
                    id="pc-email-input"
                    type="email"
                    value={email}
                    placeholder="you@example.com"
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  <button type="button" disabled={busy || !email.trim()} onClick={() => void sendEmail()}>
                    {tr('发送')}
                  </button>
                </div>
                <p>{tr('换电脑时输入这个激活码即可，一个激活码最多绑定 3 台设备。')}</p>
              </div>

              {message && <div className="pc-message">{message}</div>}
            </>
          )}

          {step === 'activate' && (
            <>
              <div className="pc-eyebrow">{tr('恢复购买')}</div>
              <h1>{tr('输入激活码')}</h1>
              <p className="pc-lead">
                {tr('换电脑或重装后，在这里输入购买时收到的激活码。')}
              </p>
              <input
                className="pc-input"
                value={code}
                placeholder={tr('粘贴激活码')}
                onChange={(event) => setCode(event.target.value)}
              />
              {message && <div className="pc-message">{message}</div>}
              <button className="pc-primary" type="button" disabled={busy || !code.trim()} onClick={() => void activate()}>
                {busy ? tr('激活中…') : tr('激活')}
              </button>
              <button className="pc-secondary" type="button" onClick={() => setStep('plans')}>
                {tr('返回')}
              </button>
            </>
          )}

          {step === 'invite' && (
            <>
              <div className="pc-eyebrow">{tr('邀请码')}</div>
              <h1>{tr('领取 7 天 Pro')}</h1>
              <p className="pc-lead">
                {tr('仅限新设备，每台设备只能领取一次。')}
              </p>
              <input
                className="pc-input"
                value={code}
                placeholder={tr('输入邀请码')}
                onChange={(event) => setCode(event.target.value)}
              />
              {message && <div className="pc-message">{message}</div>}
              <button className="pc-primary" type="button" disabled={busy || !code.trim()} onClick={() => void redeemInvite()}>
                {busy ? tr('领取中…') : tr('领取 7 天 Pro')}
              </button>
              <button className="pc-secondary" type="button" onClick={() => setStep('plans')}>
                {tr('返回')}
              </button>
            </>
          )}
        </div>

        <footer className="pc-foot">
          <span>{tr('截图 · 标注 · 钉图 永久免费')}</span>
          <span>{tr('支持支付宝 / 微信')}</span>
        </footer>
      </section>
    </div>
  )
}
