import { captureDisplay, captureDisplays, captureDisplayFast } from '../../capture'
import { fastCapture } from '../../fast-capture'
import { recognizeImageDataUrl } from '../../ocr'
import type { WindowSnapHelper } from '../../window-snap'
import type { PlatformServices } from '../types'

/**
 * 背景：Windows 的截图、窗口吸附和 OCR 各自已有成熟实现。
 * 设计意图：用适配器把它们收进 PlatformServices，业务层不再直接 import 平台模块。
 * 关键约束：适配器只转发调用，不复制算法；生命周期仍由原单例/helper 管理。
 */
export function createWin32PlatformServices(windowSnap: WindowSnapHelper): PlatformServices {
  return {
    name: 'win32',
    capture: {
      captureDisplay,
      captureAll: captureDisplays,
      captureFast: captureDisplayFast,
      prewarm: () => fastCapture.prewarm(),
      dispose: () => fastCapture.dispose()
    },
    windowQuery: {
      prewarm: () => windowSnap.prewarm(),
      query: (x, y) => windowSnap.query(x, y),
      dispose: () => windowSnap.dispose()
    },
    ocr: {
      recognizeDataUrl: recognizeImageDataUrl
    },
    dispose: () => {
      fastCapture.dispose()
      windowSnap.dispose()
    }
  }
}
