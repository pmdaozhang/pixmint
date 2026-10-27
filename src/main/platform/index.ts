import type { WindowSnapHelper } from '../window-snap'
import { createWin32PlatformServices } from './win32'
import type { PlatformServices } from './types'

export type { PlatformServices } from './types'

/**
 * 背景：Windows 先落地，macOS 后续通过独立 provider 接入。
 * 设计意图：主进程只调用 createPlatformServices，不再散落 process.platform 判断。
 * 关键约束：未实现的平台返回可启动的占位 provider，真实截图/OCR 时给出明确错误。
 */
export function createPlatformServices(windowSnap: WindowSnapHelper): PlatformServices {
  if (process.platform === 'win32') {
    return createWin32PlatformServices(windowSnap)
  }
  return createUnavailablePlatformServices(process.platform)
}

function createUnavailablePlatformServices(platform: string): PlatformServices {
  const unavailable = async (): Promise<never> => {
    throw new Error(`${platform} 平台能力尚未接入，请先在 Windows 上验证核心链路`)
  }
  return {
    name: platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : 'linux',
    capture: {
      captureDisplay: unavailable,
      captureAll: unavailable,
      captureFast: async () => null,
      prewarm: () => {},
      dispose: () => {}
    },
    windowQuery: {
      prewarm: () => {},
      query: async () => null,
      dispose: () => {}
    },
    ocr: {
      recognizeDataUrl: unavailable
    },
    dispose: () => {}
  }
}
