import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/global.css'

async function bootstrap(): Promise<void> {
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
