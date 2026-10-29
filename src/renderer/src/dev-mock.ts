import type { SnapglassApi } from '../../shared/api'
import type { OverlayInit, Settings, UpdateState } from '../../shared/types'

const initialSettings: Settings = {
  schemaVersion: 1,
  shortcut: 'F1',
  theme: 'system',
  language: 'zh-CN',
  launchAtLogin: false,
  onboardingCompleted: true,
  onboardingVersion: 2,
  translationProvider: 'free',
  translationEndpoint: 'https://api.openai.com/v1',
  translationModel: 'gpt-4o-mini',
  translationTarget: 'zh-CN',
  hasTranslationKey: false
}

/**
 * 背景：没有 Electron preload 时，浏览器无法访问真实设置和诊断 IPC。
 * 设计意图：只在开发环境且 preload 缺失时注入最小 mock，让渲染层可以独立做 UI 回归。
 * 关键约束：不进入生产 Electron 路径；不模拟截图/录制等高风险能力。
 */
const settings = { ...initialSettings }

let updateState: UpdateState = { status: 'idle' }
const updateListeners = new Set<(state: UpdateState) => void>()

function setUpdateState(patch: Partial<UpdateState>): UpdateState {
  updateState = { ...updateState, ...patch }
  for (const listener of updateListeners) listener(updateState)
  return updateState
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createOverlayInit(): OverlayInit {
  const width = 1200
  const height = 800
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#172033')
    gradient.addColorStop(1, '#334155')
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#e2e8f0'
    context.font = '28px sans-serif'
    context.fillText('Pixmint UI smoke canvas', 80, 110)
    context.fillStyle = 'rgba(255,255,255,0.12)'
    context.fillRect(80, 160, 500, 260)
    context.fillRect(640, 160, 460, 260)
  }
  return {
    displayId: 1,
    bounds: { x: 0, y: 0, width, height },
    scaleFactor: 1,
    imageDataUrl: canvas.toDataURL('image/png'),
    imageWidth: width,
    imageHeight: height,
    settings: { ...settings }
  }
}

const api = {
  settings: {
    get: async (): Promise<Settings> => ({ ...settings }),
    update: async (patch: Partial<Settings>): Promise<Settings> => {
      Object.assign(settings, patch)
      return { ...settings }
    },
    setTranslationKey: async (): Promise<boolean> => true,
    openWindow: (): void => {}
  },
  app: {
    platform: 'win32',
    version: async (): Promise<string> => '0.3.7-dev'
  },
  diagnostics: {
    info: async () => ({
      version: '0.3.7-dev',
      platform: 'win32',
      logPath: 'D:\\AI project\\audio_type\\_snapglass_app\\test-results\\dev\\snapglass.log',
      crashReportsDir: 'D:\\AI project\\audio_type\\_snapglass_app\\test-results\\dev\\crash-reports',
      crashReportCount: 0,
      latestCrashFile: null,
      latestCrashAt: null,
      safeMode: false
    }),
    openLogFolder: async (): Promise<string> => '',
    openCrashFolder: async (): Promise<string> => '',
    flush: async (): Promise<void> => {},
    exportReport: async (): Promise<string | null> => null
  },
  updater: {
    getState: async (): Promise<UpdateState> => updateState,
    check: async (): Promise<UpdateState> => {
      setUpdateState({ status: 'checking', error: undefined })
      await wait(700)
      return setUpdateState({
        status: 'available',
        version: '0.4.1',
        sizeBytes: 119059768
      })
    },
    download: async (): Promise<UpdateState> => {
      const total = 119059768
      setUpdateState({
        status: 'downloading',
        version: '0.4.1',
        progress: { percent: 0, transferred: 0, total }
      })
      for (let percent = 10; percent <= 100; percent += 10) {
        await wait(120)
        setUpdateState({
          status: percent >= 100 ? 'verifying' : 'downloading',
          progress: {
            percent,
            transferred: Math.round((total * percent) / 100),
            total
          }
        })
      }
      await wait(200)
      return setUpdateState({
        status: 'downloaded',
        version: '0.4.1',
        progress: { percent: 100, transferred: total, total }
      })
    },
    install: async (): Promise<void> => {
      setUpdateState({ status: 'installing' })
    },
    onState: (callback: (state: UpdateState) => void) => {
      updateListeners.add(callback)
      return () => {
        updateListeners.delete(callback)
      }
    }
  },
  overlay: {
    ready: async (): Promise<OverlayInit> => createOverlayInit(),
    onInit: () => () => {},
    onPrepare: () => () => {},
    onReset: () => () => {},
    prepared: () => {},
    rendererReady: () => {},
    heartbeat: () => {},
    windowAt: async () => null,
    autoCopy: () => {},
    complete: () => {},
    cancel: () => {}
  }
} as unknown as SnapglassApi

if (!window.snapglass) {
  window.snapglass = api
}
