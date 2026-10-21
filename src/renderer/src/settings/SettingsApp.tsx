import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Settings, ThemeSetting } from '@shared/types'
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
  const [toast, setToast] = useState('')
  const [translationKey, setTranslationKey] = useState('')

  const flash = (message: string): void => {
    setToast(message)
    window.setTimeout(() => setToast(''), 1800)
  }

  const load = async (): Promise<void> => {
    const [nextSettings, nextVersion] = await Promise.all([
      window.snapglass.settings.get(),
      window.snapglass.app.version()
    ])
    setSettings(nextSettings)
    setVersion(nextVersion)
    applyTheme(nextSettings.theme)
  }

  useEffect(() => {
    void load()
  }, [])

  const update = async (patch: Partial<Settings>): Promise<void> => {
    const next = await window.snapglass.settings.update(patch)
    setSettings(next)
    applyTheme(next.theme)
    flash('设置已保存')
  }

  if (!settings) return <div className="settings-loading">正在加载设置…</div>

  return (
    <div className="settings-root">
      <header className="settings-header">
        <div className="settings-title">
          <BrandMark />
          <div>
            <h1>Pixmint</h1>
            <p>截图 · 贴图 · OCR 翻译 · 录屏</p>
          </div>
        </div>
        <button className="window-close" title="关闭" onClick={() => window.close()}>
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="settings-scroll">
        <section className="card">
          <div className="card-title">
            <Icon name="keyboard" size={16} />
            快捷键
          </div>
          <div className="row">
            <div className="row-label">
              <strong>截图快捷键</strong>
              <span>点击输入框后直接按下组合键</span>
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
            OCR 与翻译
          </div>
          <div className="row">
            <div className="row-label">
              <strong>翻译服务</strong>
              <span>不配置时只使用离线 OCR 与内置词典</span>
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
              <option value="none">未配置</option>
              <option value="free">免费翻译（公共接口）</option>
              <option value="openai">OpenAI 兼容接口</option>
              <option value="deepl">DeepL</option>
            </select>
          </div>
          {settings.translationProvider === 'openai' && (
            <>
              <div className="row">
                <div className="row-label">
                  <strong>接口地址</strong>
                  <span>例如 https://api.openai.com/v1</span>
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
                  <strong>模型</strong>
                  <span>用于翻译的模型名</span>
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
                <strong>DeepL 接口</strong>
                <span>默认使用 api-free.deepl.com</span>
              </div>
            </div>
          )}
          {settings.translationProvider === 'free' && (
            <div className="row">
              <div className="row-label">
                <strong>免费翻译</strong>
                <span>使用 Google 公共接口，无需 Key；可能被限流或不可用</span>
              </div>
            </div>
          )}
          <div className="row">
            <div className="row-label">
              <strong>目标语言</strong>
              <span>单词卡片不受此项影响</span>
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
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </div>
          {(settings.translationProvider === 'openai' ||
            settings.translationProvider === 'deepl') && (
            <div className="row">
              <div className="row-label">
                <strong>API Key</strong>
                <span>{settings.hasTranslationKey ? '已加密保存到系统安全存储' : '未配置'}</span>
              </div>
              <div className="key-row">
                <input
                  id="translation-key"
                  className="text-input key-input"
                  type="password"
                  placeholder={settings.hasTranslationKey ? '输入新 Key 可覆盖' : '粘贴 API Key'}
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
                    flash(saved ? 'API Key 已加密保存' : 'API Key 已清除')
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          )}
          <div className="translation-hint">
            OCR 当前使用 Windows 系统识别；PaddleOCR 与 ECDICT 数据待模型/数据可下载后接入。
          </div>
        </section>

        <section className="card">
          <div className="card-title">
            <Icon name="folder" size={16} />
            外观与启动
          </div>
          <div className="row">
            <div className="row-label">
              <strong>主题</strong>
              <span>跟随系统或固定深浅色</span>
            </div>
            <div className="segmented">
              {(
                [
                  ['system', '跟随系统'],
                  ['dark', '深色'],
                  ['light', '浅色']
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
              <strong>界面语言</strong>
              <span>P0 仅保存偏好，文案后续接入</span>
            </div>
            <select
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
              <strong>开机自启</strong>
              <span>登录系统后自动驻留托盘</span>
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

        <footer className="settings-footer">
          <span>Pixmint v{version} · {window.snapglass.app.platform}</span>
          <span>P0 + P1</span>
        </footer>
      </div>

      {toast && <div className="settings-toast">{toast}</div>}
    </div>
  )
}
