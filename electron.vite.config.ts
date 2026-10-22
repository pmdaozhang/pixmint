import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * 背景：开发服务器需要 ws/localhost 才能做 HMR，生产构建不应该保留这些地址。
 * 设计意图：HTML 里存生产 CSP，只在 serve 模式由插件补上开发地址。
 * 关键约束：只修改 connect-src，不能放宽脚本、图片或其他来源。
 */
function devCspPlugin(): Plugin {
  return {
    name: 'pixmint-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        "connect-src 'self' snapglass-media:",
        "connect-src 'self' ws: http://localhost:* snapglass-media:"
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), devCspPlugin()]
  }
})
