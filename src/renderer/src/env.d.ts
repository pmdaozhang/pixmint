import type { SnapglassApi } from '../../shared/api'

declare module '*.css'

declare global {
  interface Window {
    snapglass: SnapglassApi
  }
}

export {}
