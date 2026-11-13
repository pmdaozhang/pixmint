import type { ThemeSetting } from '@shared/types'

/** 把“跟随系统”解析成实际的深/浅色。 */
export function resolveTheme(theme: ThemeSetting): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

/** 所有窗口统一通过这里设置 data-theme，避免某个窗口漏读用户主题。 */
export function applyTheme(theme: ThemeSetting): void {
  document.documentElement.dataset.theme = resolveTheme(theme)
}

/**
 * 主题设为“跟随系统”时，监听系统深浅色切换并重新应用。
 * 返回取消函数；非 system 主题不注册监听。
 */
export function watchSystemTheme(theme: ThemeSetting, onChange: () => void): () => void {
  if (theme !== 'system') return () => {}
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const listener = (): void => onChange()
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}
