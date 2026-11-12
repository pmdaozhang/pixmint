import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { DiagnosticsInfo, Settings, ThemeSetting, UpdateState } from '@shared/types'
import type { LicenseStatus } from '@shared/license'
import type { UsageView } from '@shared/usage'
import { describeUpdate } from '@shared/update'
import { t } from '@shared/i18n'
import { Icon } from '../components/Icon'
import './settings.css'

function applyTheme(theme: ThemeSetting): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.dataset.theme = theme === 'system' ? (media ? 'dark' : 'light') : theme
}

function shortcutFromEvent(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  const key = event.key
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return null
  if (key === 'Escape') return null
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  let main = key
  if (key === ' ') main = 'Space'
  else if (key.startsWith('Arrow')) main = key.replace('Arrow', '')
  else if (key.length === 1) main = key.toUpperCase()
  parts.push(main)
  return parts.join('+')
}

function BrandMark(): JSX.Element {
  return (
    <svg className="brand-mark" viewBox="0 0 512 512" aria-hidden="true">
      <g transform="rotate(-2 256 270)">
        <path
          d="M 148 118 H 364 C 414 118 444 148 444 198 V 342 C 444 392 414 422 364 422 H 148 C 98 422 68 392 68 342 V 198 C 68 148 98 118 148 118 Z"
          fill="currentColor"
        />
        <circle cx="190" cy="250" r="24" fill="var(--bg)" />
        <circle cx="322" cy="250" r="24" fill="var(--bg)" />
      </g>
      <path
        d="M 380 58 H 460 V 138"
        fill="none"
        stroke="currentColor"
        strokeWidth="26"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SettingsApp(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [version, setVersion] = useState('')
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null)
  const [toast, setToast] = useState('')
  const [translationKey, setTranslationKey] = useState('')
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null)
  const [usage, setUsage] = useState<UsageView | null>(null)
  const language = settings?.language ?? 'zh-CN'
  const tr = (zh: string, vars?: Record<string, string | number>): string =>
    t(language, zh, vars)

  const flash = (message: string): void => {
    setToast(message)
    window.setTimeout(() => setToast(''), 1800)
  }

  const load = async (): Promise<void> => {
    const [nextSettings, nextVersion, nextUsage, nextLicense] = await Promise.all([
      window.snapglass.settings.get(),
      window.snapglass.app.version(),
      window.snapglass.usage.get().catch(() => null),
      window.snapglass.license.status().catch(() => null)
    ])
    setSettings(nextSettings)
    setVersion(nextVersion)
    setUsage(nextUsage)
    setLicenseStatus(nextLicense)
    try {
      setDiagnostics(await window.snapglass.diagnostics.info())
    } catch (error) {
      console.warn('DIAGNOSTICS_INFO_FAILED', error)
    }
    applyTheme(nextSettings.theme)
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    let active = true
    const unsubscribe = window.snapglass.updater.onState((state) => {
      if (active) setUpdateState(state)
    })
    void window.snapglass.updater
      .getState()
      .then((state) => {
        if (active) setUpdateState(state)
      })
      .catch(() => {})
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const update = async (patch: Partial<Settings>): Promise<void> => {
    const next = await window.snapglass.settings.update(patch)
    setSettings(next)
    applyTheme(next.theme)
    // 用更新后的语言生成提示，切换语言时不会残留旧语言
    flash(t(next.language, '设置已保存'))
  }

  if (!settings)
    return <div className="settings-loading">{tr('正在加载设置…')}</div>

  const updateView = describeUpdate(updateState, version, language)
  const runUpdateAction = async (): Promise<void> => {
    if (updateView.actionKind === 'check') await window.snapglass.updater.check()
    else if (updateView.actionKind === 'download') await window.snapglass.updater.download()
    else if (updateView.actionKind === 'install') await window.snapglass.updater.install()
  }

  return (
    <div className="settings-root">
      <header className="settings-header">
        <div className="settings-title">
          <BrandMark />
          <div>
            <h1>Pixmint</h1>
            <p>{tr('截图 · 贴图 · OCR 翻译 · 录屏')}</p>
          </div>
        </div>
        <button className="window-close" title={tr('关闭')} onClick={() => window.close()}>
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="settings-scroll">
        <section className="card">
          <div className="card-title">
            <Icon name="keyboard" size={16} />
            {tr('快捷键')}
          </div>
          <div className="row">
            <div className="row-label">
              <strong>{tr('截图快捷键')}</strong>
              <span>{tr('点击输入框后直接按下组合键')}</span>
            </div>
            <input
              className="shortcut-input"
              readOnly
              value={settings.shortcut}
              onKeyDown={(event) => {
                event.preventDefault()
                if (event.key === 'Escape') {
                  event.currentTarget.blur()
                  return
                }
                const shortcut = shortcutFromEvent(event)
                if (shortcut) void update({ shortcut })
              }}
            />
          </div>
        </section>

        <section className="card">
          <div className="card-title">
            <Icon name="translate" size={16} />
            {tr('OCR 与翻译')}
          </div>
          <div className="row">
            <div className="row-label">
              <strong>{tr('翻译服务')}</strong>
              <span>{tr('不配置时只使用离线 OCR 与内置词典')}</span>
            </div>
            <select
              id="translation-provider"
              className="select"
              value={settings.translationProvider}
              onChange={(event) =>
                void update({
                  translationProvider: event.target.value as Settings['translationProvider']
                })
              }
            >
              <option value="none">{tr('未配置')}</option>
              <option value="free">{tr('免费翻译（公共接口）')}</option>
              <option value="openai">{tr('OpenAI 兼容接口')}</option>
              <option value="deepl">DeepL</option>
            </select>
          </div>
          {settings.translationProvider === 'openai' && (
            <>
              <div className="row">
                <div className="row-label">
                  <strong>{tr('接口地址')}</strong>
                  <span>{tr('例如 https://api.openai.com/v1')}</span>
                </div>
                <input
                  id="translation-endpoint"
                  className="text-input"
                  value={settings.translationEndpoint}
                  onChange={(event) => void update({ translationEndpoint: event.target.value })}
                />
              </div>
              <div className="row">
                <div className="row-label">
                  <strong>{tr('模型')}</strong>
                  <span>{tr('用于翻译的模型名')}</span>
                </div>
                <input
                  id="translation-model"
                  className="text-input"
                  value={settings.translationModel}
                  onChange={(event) => void update({ translationModel: event.target.value })}
                />
              </div>
            </>
          )}
          {settings.translationProvider === 'deepl' && (
            <div className="row">
              <div className="row-label">
                <strong>{tr('DeepL 接口')}</strong>
                <span>{tr('默认使用 api-free.deepl.com')}</span>
              </div>
            </div>
          )}
          {settings.translationProvider === 'free' && (
            <div className="row">
              <div className="row-label">
                <strong>{tr('免费翻译')}</strong>
                <span>{tr('使用 Google 公共接口，无需 Key；可能被限流或不可用')}</span>
              </div>
            </div>
          )}
          <div className="row">
            <div className="row-label">
              <strong>{tr('翻译方向')}</strong>
              <span>{tr('只影响翻译结果')}</span>
            </div>
            <select
              id="translation-target"
              className="select"
              value={settings.translationTarget}
              onChange={(event) =>
                void update({
                  translationTarget: event.target.value as Settings['translationTarget']
                })
              }
            >
              <option value="zh-CN">{tr('英文 → 中文')}</option>
              <option value="en-US">{tr('中文 → 英文')}</option>
            </select>
          </div>
          {(settings.translationProvider === 'openai' ||
            settings.translationProvider === 'deepl') && (
            <div className="row">
              <div className="row-label">
                <strong>API Key</strong>
                <span>
                  {settings.hasTranslationKey
                    ? tr('已加密保存到系统安全存储')
                    : tr('未配置')}
                </span>
              </div>
              <div className="key-row">
                <input
                  id="translation-key"
                  className="text-input key-input"
                  type="password"
                  placeholder={
                    settings.hasTranslationKey
                      ? tr('输入新 Key 可覆盖')
                      : tr('粘贴 API Key')
                  }
                  value={translationKey}
                  onChange={(event) => setTranslationKey(event.target.value)}
                />
                <button
                  id="translation-key-save"
                  className="secondary"
                  onClick={async () => {
                    const saved = await window.snapglass.settings.setTranslationKey(translationKey)
                    setTranslationKey('')
                    setSettings({ ...settings, hasTranslationKey: saved })
                    flash(saved ? tr('API Key 已加密保存') : tr('API Key 已清除'))
                  }}
                >
                  {tr('保存')}
                </button>
              </div>
            </div>
          )}
          <div className="translation-hint">
            {tr(
              'OCR 当前使用 Windows 系统识别；PaddleOCR 与 ECDICT 数据待模型/数据可下载后接入。'
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-title">
            <Icon name="folder" size={16} />
            {tr('外观与启动')}
          </div>
          <div className="row">
            <div className="row-label">
              <strong>{tr('主题')}</strong>
              <span>{tr('跟随系统或固定深浅色')}</span>
            </div>
            <div className="segmented">
              {(
                [
                  ['system', tr('跟随系统')],
                  ['dark', tr('深色')],
                  ['light', tr('浅色')]
                ] as Array<[ThemeSetting, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={settings.theme === value ? 'on' : ''}
                  onClick={() => void update({ theme: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <div className="row-label">
              <strong>{tr('界面语言')}</strong>
              <span>{tr('切换整个应用界面，立即生效')}</span>
            </div>
            <select
              id="interface-language"
              className="select"
              value={settings.language}
              onChange={(event) =>
                void update({ language: event.target.value as Settings['language'] })
              }
            >
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </div>
          <div className="row">
            <div className="row-label">
              <strong>{tr('开机自启')}</strong>
              <span>{tr('登录系统后自动驻留托盘')}</span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.launchAtLogin}
                onChange={(event) => void update({ launchAtLogin: event.target.checked })}
              />
              <span />
            </label>
          </div>
        </section>

        <section className="card">
          <div className="card-title">
            <Icon name="settings" size={16} />
            {tr('Pixmint Pro')}
          </div>
          <div className="row">
            <div className="row-label">
              <strong>{licenseStatus?.pro ? tr('Pro 已激活') : tr('免费版')}</strong>
              <span>
                {licenseStatus?.pro
                  ? licenseStatus.expiresAt
                    ? tr('有效期至 {date}', {
                        date: new Date(licenseStatus.expiresAt).toLocaleDateString()
                      })
                    : tr('永久授权')
                  : usage?.unlimited
                    ? tr('开发版 · 不限次数')
                    : usage
                    ? tr('今日剩余：OCR {ocr}/{ocrLimit} · 翻译 {translate}/{translateLimit} · GIF {gif}/{gifLimit} · 视频 {video}/{videoLimit}', {
                        ocr: usage.remaining.ocr,
                        ocrLimit: usage.limits.ocr,
                        translate: usage.remaining.translate,
                        translateLimit: usage.limits.translate,
                        gif: usage.remaining.gif,
                        gifLimit: usage.limits.gif,
                        video: usage.remaining.video,
                        videoLimit: usage.limits.video
                      })
                    : tr('每日免费额度')
                }
              </span>
            </div>
            <div className="row-actions">
              <button
                className="primary pro-gold"
                onClick={() => window.snapglass.purchase.open()}
              >
                <Icon name="crown" size={14} />
                {licenseStatus?.pro ? tr('终身会员') : tr('升级 Pro')}
              </button>
            </div>
          </div>
          {licenseStatus?.code && (
            <div className="row">
              <div className="row-label">
                <strong>{tr('激活码')}</strong>
                <span>{tr('换电脑时输入此码，最多绑定 5 台设备')}</span>
              </div>
              <div className="row-actions">
                <code className="license-code">{licenseStatus.code}</code>
                <button
                  className="ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(licenseStatus.code ?? '')
                    flash(tr('激活码已复制'))
                  }}
                >
                  {tr('复制')}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-title">
            <Icon name="settings" size={16} />
            {tr('关于与更新')}
            {updateView.showBadge && <span className="update-chip">NEW</span>}
          </div>
          <div className="row update-row">
            <div className="row-label">
              <strong>
                <span className={`version-dot ${updateView.tone}`} />
                {updateView.title}
              </strong>
              <span
                className={`update-desc ${updateView.tone}`}
                aria-live="polite"
              >
                {updateView.description}
              </span>
            </div>
            <div className="row-actions">
              <button
                className={updateView.actionVariant}
                disabled={updateView.actionDisabled}
                onClick={() => void runUpdateAction()}
              >
                {updateView.actionLabel}
              </button>
            </div>
          </div>
          {updateView.showProgress && (
            <div className="progress-block">
              <div
                className="progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={updateView.progressPercent}
              >
                <div
                  className={`progress-fill ${updateView.progressPercent >= 100 ? 'done' : ''}`}
                  style={{ width: `${updateView.progressPercent}%` }}
                />
              </div>
              <div className="progress-meta">
                <span>{updateView.progressLabel}</span>
                <span>{Math.round(updateView.progressPercent)}%</span>
              </div>
            </div>
          )}
          {updateView.note && (
            <div className={`update-note ${updateView.noteTone === 'error' ? 'err' : ''}`}>
              <Icon name={updateView.noteTone === 'error' ? 'close' : 'check'} size={13} />
              <span>{updateView.note}</span>
            </div>
          )}
        </section>

        {diagnostics && (import.meta.env.DEV || diagnostics.safeMode) && (
          <section className="card">
            <div className="card-title">
              <Icon name="folder" size={16} />
              {tr('诊断')}
            </div>
            <div className="row">
              <div className="row-label">
                <strong>{tr('诊断日志')}</strong>
                <span className="path-text">{diagnostics.logPath}</span>
              </div>
              <div className="row-actions">
                <button
                  className="secondary"
                  onClick={async () => {
                    const filePath = await window.snapglass.diagnostics.exportReport()
                    if (filePath) flash(tr('诊断报告已导出'))
                  }}
                >
                  {tr('导出报告')}
                </button>
                <button
                  className="secondary"
                  onClick={async () => {
                    await window.snapglass.diagnostics.flush()
                    await window.snapglass.diagnostics.openLogFolder()
                    flash(tr('已打开日志目录'))
                  }}
                >
                  {tr('打开目录')}
                </button>
              </div>
            </div>
            <div className="row">
              <div className="row-label">
                <strong>{tr('崩溃报告')}</strong>
                <span>
                  {tr('{count} 份', { count: diagnostics.crashReportCount })}
                  {diagnostics.latestCrashAt
                    ? ` · ${tr('最近 {time}', {
                        time: new Date(diagnostics.latestCrashAt).toLocaleString()
                      })}`
                    : ''}
                </span>
              </div>
              <div className="row-actions">
                <button
                  className="secondary"
                  onClick={async () => {
                    await window.snapglass.diagnostics.openCrashFolder()
                    flash(tr('已打开崩溃报告目录'))
                  }}
                >
                  {tr('打开目录')}
                </button>
              </div>
            </div>
            <div className="row">
              <div className="row-label">
                <strong>{tr('兼容模式')}</strong>
                <span>
                  {diagnostics.safeMode
                    ? tr('已启用（上次会话异常退出）')
                    : tr('未启用')}
                </span>
              </div>
              <div className="row-actions">
                {diagnostics.safeMode && (
                  <button
                    className="secondary"
                    onClick={async () => {
                      await window.snapglass.diagnostics.disableSafeMode()
                      setDiagnostics(await window.snapglass.diagnostics.info())
                      flash(tr('已关闭兼容模式，重启后生效'))
                    }}
                  >
                    {tr('退出兼容模式')}
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={async () => {
                    await window.snapglass.diagnostics.flush()
                    flash(tr('诊断日志已写入'))
                  }}
                >
                  {tr('立即写入日志')}
                </button>
              </div>
            </div>
          </section>
        )}

        <footer className="settings-footer">
          <span>Pixmint v{version} · {window.snapglass.app.platform}</span>
          <span>P0–P4</span>
        </footer>
      </div>

      {toast && <div className="settings-toast">{toast}</div>}
    </div>
  )
}
