import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import type { LicenseDevice, LicenseStatus } from '@shared/license'
import { t, type Language } from '@shared/i18n'
import './member-welcome.css'

const SHADOW_PADDING = 56
/** 480px 卡片 + 两侧 28px 阴影留白 */
const WINDOW_WIDTH = 536
const SHARE_LINK = 'https://pixmint.hugproducthub.top/download'

/** 允许在 style 里写 CSS 变量 */
function vars(values: Record<string, string | number>): CSSProperties {
  return values as CSSProperties
}

/** 激活码只露出前两位，其余换成圆点；复制时仍用完整码 */
function maskCode(value: string): string {
  let kept = 0
  return value
    .split('')
    .map((char) => {
      if (!/[A-Za-z0-9]/.test(char)) return char
      kept += 1
      return kept <= 2 ? char : '•'
    })
    .join('')
}

function deviceLabel(name: string): string {
  // 服务端存的是 platform 字符串；本地预览/人工命名的设备直接展示
  if (/[一-龥]/.test(name)) return name
  const lower = name.toLowerCase()
  if (lower.includes('win')) return 'Windows 设备'
  if (lower.includes('darwin') || lower.includes('mac')) return 'Mac 设备'
  if (lower.includes('linux')) return 'Linux 设备'
  return name || '未知设备'
}

function relativeTime(seconds: number): string {
  if (!seconds) return ''
  const diff = Date.now() / 1000 - seconds
  if (diff < 120) return '刚刚活跃'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前活跃`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前活跃`
  return `${Math.floor(diff / 86400)} 天前活跃`
}

function MonitorIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 20h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  life: number
  ttl: number
  rot: number
  vr: number
  shape: 'ribbon' | 'dot'
}

const CONFETTI_COLORS = ['#e0524a', '#f2994a', '#f2c044', '#57c785', '#4a90e2', '#8b6cf0']

interface MemberWelcomeProps {
  status: LicenseStatus
  language: Language
}

export function MemberWelcome({ status, language }: MemberWelcomeProps): JSX.Element {
  const tr = (zh: string, values?: Record<string, string | number>): string =>
    t(language, zh, values)

  const cardRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [devices, setDevices] = useState<LicenseDevice[] | null>(null)
  const [deviceError, setDeviceError] = useState('')
  const [pending, setPending] = useState<LicenseDevice | null>(null)
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [toastText, setToastText] = useState('')
  const toastTimer = useRef(0)

  const showToast = useCallback((text: string) => {
    setToastText(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastText(''), 1900)
  }, [])

  const copyText = useCallback(
    (text: string, okText: string) => {
      void navigator.clipboard
        .writeText(text)
        .then(() => showToast(okText))
        .catch(() => showToast(tr('复制失败，请稍后重试')))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast, language]
  )

  const loadDevices = useCallback(async () => {
    try {
      const next = await window.snapglass.license.devices()
      setDevices(next)
      setDeviceError('')
    } catch {
      setDevices([])
      setDeviceError('暂时无法读取设备列表')
    }
  }, [])

  useEffect(() => {
    void loadDevices()
  }, [loadDevices])

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  // 窗口随内容高度调整；会员页固定为 480px 卡片宽度
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    let frame = 0
    let applied = 0
    const sync = (): void => {
      const target = Math.max(480, Math.min(980, Math.round(card.scrollHeight + SHADOW_PADDING)))
      if (target === applied) return
      applied = target
      window.snapglass.purchase.resize(target, WINDOW_WIDTH)
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
  }, [])

  // 打开时放一次烟花彩带
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let dpr = 1
    let width = 0
    let height = 0
    let particles: Particle[] = []
    let raf = 0
    const timers: number[] = []

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = rect.width
      height = rect.height
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }

    const burst = (x: number, y: number): void => {
      for (let i = 0; i < 40; i += 1) {
        const angle = (Math.PI * 2 * i) / 40 + Math.random() * 0.14
        const speed = 90 + Math.random() * 160
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 30,
          size: 2.5 + Math.random() * 3.5,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          life: 0,
          ttl: 1.4 + Math.random() * 0.5,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 10,
          shape: Math.random() < 0.55 ? 'ribbon' : 'dot'
        })
      }
    }

    const rain = (): void => {
      for (let i = 0; i < 18; i += 1) {
        particles.push({
          x: Math.random() * width,
          y: -12 - Math.random() * 60,
          vx: (Math.random() - 0.5) * 30,
          vy: 80 + Math.random() * 70,
          size: 3 + Math.random() * 3.5,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          life: 0,
          ttl: 2.1 + Math.random() * 0.7,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 7,
          shape: 'ribbon'
        })
      }
    }

    const tick = (prev: number): void => {
      const now = performance.now()
      const dt = Math.min((now - prev) / 1000, 0.05)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.scale(dpr, dpr)
      particles = particles.filter((p) => {
        p.life += dt
        if (p.life >= p.ttl) return false
        p.vy += 240 * dt
        p.vx *= 0.995
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.rot += p.vr * dt
        ctx.globalAlpha = Math.max(0, 1 - p.life / p.ttl)
        ctx.fillStyle = p.color
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        if (p.shape === 'ribbon') {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        } else {
          ctx.beginPath()
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
          ctx.fill()
        }
        return p.y < height + 40 && p.x > -40 && p.x < width + 40
      })
      ctx.restore()
      if (particles.length > 0) {
        raf = requestAnimationFrame(() => tick(now))
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }

    resize()
    timers.push(
      window.setTimeout(() => burst(width * 0.32, height * 0.24), 260),
      window.setTimeout(() => burst(width * 0.68, height * 0.2), 480),
      window.setTimeout(() => burst(width * 0.5, height * 0.3), 700),
      window.setTimeout(() => rain(), 300)
    )
    raf = requestAnimationFrame(() => tick(performance.now()))
    const onResize = (): void => resize()
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      timers.forEach((timer) => window.clearTimeout(timer))
      window.removeEventListener('resize', onResize)
    }
  }, [])

  useEffect(() => {
    if (!pending) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPending(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending])

  const usedCount = devices ? devices.length : status.devicesUsed
  const maxCount = status.devicesMax
  const code = status.code ?? ''

  const confirmUnbind = async (): Promise<void> => {
    if (!pending) return
    const target = pending
    setDeviceBusy(true)
    try {
      await window.snapglass.license.unbind(target.deviceHash)
      setDevices((current) =>
        current ? current.filter((device) => device.deviceHash !== target.deviceHash) : current
      )
      showToast(tr('已解绑该设备'))
    } catch {
      showToast(tr('解绑失败，请稍后重试'))
    } finally {
      setDeviceBusy(false)
      setPending(null)
    }
  }

  return (
    <div className="pc-root">
      <section className="pc-card mw-card" aria-label={tr('终身会员')} ref={cardRef}>
        <canvas className="mw-canvas" ref={canvasRef} aria-hidden="true" />

        <header className="mw-head">
          <div className="mw-brand">
            <span className="mw-logo" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 7.5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <circle cx="9.2" cy="12.8" r="1.1" fill="currentColor" />
                <circle cx="14.8" cy="12.8" r="1.1" fill="currentColor" />
                <path
                  d="M17 3.5h3.5V7"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span>Pixmint</span>
          </div>
          <button
            className="mw-close"
            type="button"
            aria-label={tr('关闭')}
            onClick={() => window.close()}
          >
            ×
          </button>
        </header>

        <div className="mw-body">
          <div className="mw-hero">
            <div className="mw-crown-stage">
              <svg className="mw-cloud" viewBox="0 0 280 184" aria-hidden="true">
                <g transform="translate(140 46)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '0ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '-6deg', '--fd': '1.2s' })}>
                      <path
                        d="M-7 2 Q-3.5 -4 0 2 T7 2"
                        fill="none"
                        stroke="#e0524a"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                      />
                    </g>
                  </g>
                </g>
                <g transform="translate(106 50)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '90ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '14deg', '--fd': '0.7s' })}>
                      <rect x="-4" y="-4" width="8" height="8" rx="1.5" fill="#57c785" />
                    </g>
                  </g>
                </g>
                <g transform="translate(174 44)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '40ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '-12deg', '--fd': '1.6s' })}>
                      <polygon points="0,-6 6,4 -6,4" fill="#f2994a" />
                    </g>
                  </g>
                </g>
                <g transform="translate(82 62)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '140ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '8deg', '--fd': '0.9s' })}>
                      <path
                        d="M-7 7 C-9 -2 -1 -7 2 0 C5 7 -3 11 -7 6"
                        fill="none"
                        stroke="#f2c044"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                      />
                    </g>
                  </g>
                </g>
                <g transform="translate(200 60)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '60ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '-20deg', '--fd': '1.8s' })}>
                      <rect x="-3.5" y="-3.5" width="7" height="7" rx="1" fill="#8b6cf0" />
                    </g>
                  </g>
                </g>
                <g transform="translate(124 66)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '180ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '24deg', '--fd': '0.5s' })}>
                      <rect x="-3.5" y="-6" width="7" height="12" rx="1.5" fill="#f2994a" />
                    </g>
                  </g>
                </g>
                <g transform="translate(162 72)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '110ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '4deg', '--fd': '1.4s' })}>
                      <path
                        d="M-6 3 A6 6 0 0 1 6 3"
                        fill="none"
                        stroke="#e0524a"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                      />
                    </g>
                  </g>
                </g>
                <g transform="translate(140 86)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '240ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '32deg', '--fd': '0.8s' })}>
                      <rect x="-2.75" y="-2.75" width="5.5" height="5.5" rx="1" fill="#4a90e2" />
                    </g>
                  </g>
                </g>
                <g transform="translate(98 88)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '30ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '16deg', '--fd': '1.7s' })}>
                      <polygon points="0,-4 4,3 -4,3" fill="#e0524a" />
                    </g>
                  </g>
                </g>
                <g transform="translate(184 90)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '160ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '-14deg', '--fd': '0.6s' })}>
                      <path
                        d="M-6 2 Q-3 -3 0 2 T6 2"
                        fill="none"
                        stroke="#57c785"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                      />
                    </g>
                  </g>
                </g>
                <g transform="translate(64 108)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '200ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '-8deg', '--fd': '1.1s' })}>
                      <path
                        d="M-6 6 C-8 -2 -1 -6 2 0 C4 6 -2 10 -6 5"
                        fill="none"
                        stroke="#f2994a"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                      />
                    </g>
                  </g>
                </g>
                <g transform="translate(216 106)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '130ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '10deg', '--fd': '1.9s' })}>
                      <path
                        d="M-6 2 Q-3 -3 0 2 T6 2"
                        fill="none"
                        stroke="#4a90e2"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                      />
                    </g>
                  </g>
                </g>
                <g transform="translate(74 138)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '260ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '24deg', '--fd': '0.7s' })}>
                      <rect x="-3" y="-3" width="6" height="6" rx="1" fill="#8b6cf0" />
                    </g>
                  </g>
                </g>
                <g transform="translate(204 136)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '190ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '-16deg', '--fd': '1.3s' })}>
                      <polygon points="0,-4.5 5,3.5 -5,3.5" fill="#f2c044" />
                    </g>
                  </g>
                </g>
                <g transform="translate(80 158)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '100ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '6deg', '--fd': '1.5s' })}>
                      <path
                        d="M-5 2.5 A5 5 0 0 1 5 2.5"
                        fill="none"
                        stroke="#57c785"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                      />
                    </g>
                  </g>
                </g>
                <g transform="translate(198 156)">
                  <g className="mw-cloud-piece" style={vars({ '--d': '70ms' })}>
                    <g className="mw-cloud-float" style={vars({ '--rot': '0deg', '--fd': '1s' })}>
                      <circle r="2.8" fill="#4a90e2" />
                    </g>
                  </g>
                </g>
              </svg>
              <span className="mw-crown" aria-hidden="true">
                👑
              </span>
            </div>
            <h1>{tr('您已是终身会员')}</h1>
            <p>{tr('感谢支持 Pixmint，所有功能已永久解锁！')}</p>
            <ul className="mw-perks">
              <li>{tr('终身有效')}</li>
              <li>{tr('不限次数')}</li>
              <li>{tr('最多 {max} 台设备', { max: maxCount })}</li>
            </ul>
          </div>

          <section className="mw-block">
            <div className="mw-block-head">
              <h2>{tr('激活码')}</h2>
            </div>
            <div className="mw-code-row">
              <span className="mw-code">{code ? maskCode(code) : tr('暂无激活码')}</span>
              <button
                className="mw-soft-btn"
                type="button"
                disabled={!code}
                onClick={() => copyText(code, tr('激活码已复制，请妥善保存'))}
              >
                {tr('复制')}
              </button>
            </div>
            <div className="mw-info-row">
              <span className="mw-info-label">{tr('绑定邮箱')}</span>
              <span className="mw-info-value">{status.email || tr('未绑定')}</span>
            </div>
          </section>

          <section className="mw-block">
            <div className="mw-block-head">
              <h2>{tr('设备管理')}</h2>
              <span className="mw-hint">
                {usedCount} / {maxCount}
              </span>
            </div>
            <ul className="mw-devices">
              {(devices ?? []).map((device) => (
                <li className="mw-device" key={device.deviceHash}>
                  <span className="mw-device-ico">
                    <MonitorIcon />
                  </span>
                  <div className="mw-device-main">
                    <div className="mw-device-name">
                      {deviceLabel(device.name)}
                      {device.current && <span className="mw-current-tag">{tr('当前设备')}</span>}
                    </div>
                    <div className="mw-device-sub">
                      {[device.current ? tr('正在使用') : relativeTime(device.lastSeen)]
                        .filter(Boolean)
                        .join(' · ') || tr('最近活跃')}
                    </div>
                  </div>
                  {!device.current && (
                    <button
                      className="mw-unbind"
                      type="button"
                      onClick={() => setPending(device)}
                    >
                      {tr('解绑')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {devices !== null && devices.length === 0 && !deviceError && (
              <p className="mw-device-empty">{tr('还没有绑定其他设备')}</p>
            )}
            {deviceError && <p className="mw-device-empty">{tr(deviceError)}</p>}
          </section>

          <section className="mw-block mw-share">
            <div className="mw-block-head">
              <h2>{tr('分享给朋友')}</h2>
            </div>
            <p>{tr('把链接发给朋友，对方在浏览器里打开就会开始下载最新版 Pixmint。')}</p>
            <div className="mw-link-row">
              <code>pixmint.hugproducthub.top/download</code>
              <button
                className="mw-link-btn"
                type="button"
                onClick={() => copyText(SHARE_LINK, tr('分享链接已复制'))}
              >
                {tr('复制链接')}
              </button>
            </div>
          </section>
        </div>

        <footer className="mw-foot">
          <button className="mw-primary" type="button" onClick={() => window.close()}>
            {tr('完成')}
          </button>
        </footer>

        {pending && (
          <div
            className="mw-confirm-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) setPending(null)
            }}
          >
            <div
              className="mw-confirm-card"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="mw-confirm-title"
            >
              <h3 id="mw-confirm-title">{tr('解绑这台设备？')}</h3>
              <p>{tr('解绑后，该设备需要重新输入激活码才能使用。')}</p>
              <div className="mw-confirm-actions">
                <button
                  className="mw-soft-btn"
                  type="button"
                  onClick={() => setPending(null)}
                  disabled={deviceBusy}
                >
                  {tr('取消')}
                </button>
                <button
                  className="mw-danger-btn"
                  type="button"
                  onClick={() => void confirmUnbind()}
                  disabled={deviceBusy}
                >
                  {tr('解绑')}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className={`mw-toast${toastText ? ' show' : ''}`} role="status" aria-live="polite">
          {toastText}
        </div>
      </section>
    </div>
  )
}
