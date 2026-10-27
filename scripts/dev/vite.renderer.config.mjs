import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export default defineConfig({
  root: resolve(projectRoot, 'src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve(projectRoot, 'src/shared'),
      '@renderer': resolve(projectRoot, 'src/renderer/src')
    }
  },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 8787,
    strictPort: true
  }
})
