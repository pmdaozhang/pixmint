import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

export function loadRoute(window: BrowserWindow, route: string): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void window.loadURL(`${devUrl}#${route}`)
    return
  }
  void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
}
