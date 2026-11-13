import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/global.css'
import './styles/win11.css'

async function bootstrap(): Promise<void> {
  // 首帧先跟随系统主题；各窗口读取到用户设置后再用 applyTheme 覆盖。
  document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)')
    .matches
    ? 'dark'
    : 'light'
  const isDev =
    (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true
  if (isDev && !window.snapglass) {
    await import('./dev-mock')
  }
  const root = document.getElementById('root')
  if (!root) throw new Error('Missing #root')
  createRoot(root).render(<App />)
}

void bootstrap()
