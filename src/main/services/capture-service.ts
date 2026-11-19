import { app, dialog, screen, type Display, type Tray } from 'electron'
import { join } from 'node:path'
import type {
  DisplayCapture,
  OverlayCompletePayload,
  Rect,
  RecorderMode
} from '../../shared/types'
import { withTimeout } from '../../shared/async'
import { addBreadcrumb } from '../breadcrumbs'
import { logDiagnostic } from '../diagnostics'
import { copyImageBytes, imageFromBytes, notify, saveImageBytes } from '../image-utils'
import type { PlatformServices } from '../platform'
import type { ForegroundWindow } from '../platform/types'
import type { RecorderManager } from '../recording'
import type { SecretStore } from '../secret-store'
import type { SettingsStore } from '../settings-store'
import type { UsageService } from './usage-service'
import type { OcrManager } from '../windows/ocr'
import type { OverlayManager } from '../windows/overlay'
import type { PinManager } from '../windows/pin'
import type { StatusToast } from '../windows/status-toast'
import { formatStamp } from '../runtime/format-stamp'
import { t } from '../../shared/i18n'

/**
 * 背景：截图编排原先写在 index.ts 里，让入口文件同时承担启动、IPC 和业务三层职责。
 * 设计意图：把"按下快捷键到出结果"的完整链路收进独立服务，入口只负责组装依赖。
 * 关键约束：这里不碰窗口创建细节，所有窗口操作仍由 OverlayManager/PinManager 负责。
 */
export interface CaptureDeps {
  overlayManager: OverlayManager
  ocrManager: OcrManager
  pinManager: PinManager
  recorderManager: RecorderManager
  platformServices: PlatformServices
  settingsStore: SettingsStore
  secretStore: SecretStore
  statusToast: StatusToast
  usageService: UsageService
  getTray: () => Tray | null
  isFastCaptureSmoke: boolean
}

export async function startCapture(
  deps: CaptureDeps,
  mode?: RecorderMode,
  force = false
): Promise<void> {
  const triggered = Date.now()
  addBreadcrumb('capture', 'start', { mode: mode ?? 'screenshot', force })
  const { overlayManager, recorderManager } = deps
  if (!overlayManager) return
  deps.ocrManager?.closeAll()
  if (recorderManager?.isRecordingSession()) return
  if (overlayManager.isActive()) {
    overlayManager.hideAll()
    return
  }
  // 结果卡还开着时按 F1，先结束上一次录制结果，再立刻开始新的截图。
  recorderManager?.previewClose()
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    // 独占全屏程序（游戏）里 WGC 会抓到黑屏。先抢焦点让它最小化，再截图，
    // 保证一定能截到画面（代价是游戏被最小化）。
    const fullscreenExclusive =
      !force && mode === undefined && (await isFullscreenForeground(deps, display))
    await overlayManager.prepare({
      id: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor
    })
    if (fullscreenExclusive) {
      // 先把覆盖层窗口抢成前台，独占全屏游戏随即最小化；等它最小化后再截图。
      overlayManager.focusActive(display.id)
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    const preparedAt = Date.now()
    const started = Date.now()
    const fast = await deps.platformServices.capture.captureFast(display)
    console.log('CAPTURE_KIND', fast ? 'fast' : 'fallback')
    const capture =
      fast ??
      (await withTimeout(
        deps.platformServices.capture.captureDisplay(display),
        5000,
        t(deps.settingsStore.get().language, '截图超时，请检查屏幕录制权限')
      ))
    const capturedAt = Date.now()
    console.log('CAPTURE_MS', Date.now() - started)
    addBreadcrumb('capture', 'captured', {
      fast: Boolean(fast),
      durationMs: Date.now() - started
    })
    // 截完图后再关闭托盘菜单：冻结画面里保留菜单内容，同时把焦点让给覆盖层。
    deps.getTray()?.closeContextMenu()
    // 抓屏期间用户按了 Esc：会话已经取消，不要再把遮罩显示出来。
    if (!overlayManager.isActive()) return
    await overlayManager.start(capture, mode)
    const total = Date.now() - triggered
    logDiagnostic(
      'capture',
      `timing total=${total} prepare=${preparedAt - triggered} capture=${
        capturedAt - preparedAt
      } fast=${Boolean(fast)} overlayStart=${total - (capturedAt - triggered)}`,
      total > 800 || !fast ? 'warn' : 'info'
    )
    console.log('START_CAPTURE_TOTAL_MS', Date.now() - triggered)
  } catch (error) {
    overlayManager?.hideAll()
    const message = error instanceof Error ? error.message : String(error)
    addBreadcrumb('capture', 'failed', { message })
    if (deps.isFastCaptureSmoke) {
      console.error('CAPTURE_FAILED', message)
    } else {
      dialog.showErrorBox(t(deps.settingsStore.get().language, '截图失败'), message)
    }
  }
}

/**
 * 桌面、任务栏、开始菜单/输入法，以及自动化与 overlay 工具层：
 * 它们也能铺满整个显示器，但不是“全屏独占程序”，不能据此切到免扰模式。
 */
const SYSTEM_WINDOW_CLASSES = new Set([
  'Progman', // 桌面
  'WorkerW', // 桌面图标层
  'Shell_TrayWnd', // 任务栏
  'Shell_SecondaryTrayWnd',
  'Windows.UI.Core.CoreWindow', // 开始菜单 / 通知中心 / 输入法
  'ApplicationFrameWindow', // UWP 宿主
  'Cua.AgentCursorOverlay',
  'CEF-OSC-WIDGET' // NVIDIA GeForce Overlay
])

/**
 * 前台窗口是否真正铺满这台显示器（重叠面积 ≥ 99%）。
 * 阈值不能太低：最大化的普通窗口约 95%（任务栏占掉一截），
 * 放过去会让用户在浏览器/终端里按 F1 也误判成游戏。
 * window-snap 返回物理像素，显示器 bounds 是逻辑像素，先换算再比。
 * 桌面、任务栏、开始菜单以及应用自身的窗口一律排除，否则第二次按 F1 时
 * 前台回到桌面就会误判，导致覆盖层不可聚焦（Esc 失效、无法框选）。
 */
async function isFullscreenForeground(deps: CaptureDeps, display: Display): Promise<boolean> {
  let fg: ForegroundWindow | null = null
  try {
    fg = await deps.platformServices.windowQuery.foreground()
  } catch {
    return false
  }
  if (!fg) return false
  if (fg.pid === process.pid || SYSTEM_WINDOW_CLASSES.has(fg.className)) {
    logDiagnostic(
      'capture',
      `foreground skipped class=${fg.className || '?'} pid=${fg.pid}`,
      'info'
    )
    return false
  }
  const { x, y, width, height } = fg.rect
  logDiagnostic(
    'capture',
    `foreground rect=${x},${y},${width},${height} class=${fg.className} pid=${fg.pid} display=${display.bounds.x},${display.bounds.y},${display.bounds.width},${display.bounds.height} scale=${display.scaleFactor}`,
    'info'
  )
  const scale = display.scaleFactor || 1
  const b = display.bounds
  const rw = width / scale
  const rh = height / scale
  const rx = x / scale
  const ry = y / scale
  const overlapX = Math.min(rx + rw, b.x + b.width) - Math.max(rx, b.x)
  const overlapY = Math.min(ry + rh, b.y + b.height) - Math.max(ry, b.y)
  if (overlapX <= 0 || overlapY <= 0) return false
  return overlapX * overlapY >= b.width * b.height * 0.99
}


export async function handleOverlayComplete(
  deps: CaptureDeps,
  payload: OverlayCompletePayload,
  capture: DisplayCapture
): Promise<void> {
  const image = imageFromBytes(payload.pngBytes)
  if (image.isEmpty()) return
  addBreadcrumb('action', payload.action, {
    width: payload.selection.width,
    height: payload.selection.height
  })
  if (payload.action === 'copy') {
    copyImageBytes(payload.pngBytes)
    notify(t(deps.settingsStore.get().language, '已复制到剪贴板'))
    return
  }
  if (payload.action === 'save') {
    const result = await dialog.showSaveDialog({
      title: t(deps.settingsStore.get().language, '保存截图'),
      defaultPath: join(app.getPath('pictures'), `Pixmint-${formatStamp()}.png`),
      filters: [
        { name: t(deps.settingsStore.get().language, 'PNG 图片'), extensions: ['png'] }
      ]
    })
    if (!result.canceled && result.filePath) {
      saveImageBytes(payload.pngBytes, result.filePath)
      notify(
        t(deps.settingsStore.get().language, '已保存：{path}', {
          path: result.filePath
        })
      )
    }
    return
  }
  if (payload.action === 'ocr') {
    // 翻译任务只扣翻译额度（由 translation:translate 负责），避免 OCR + 翻译双扣；
    // 纯 OCR 在真正识别前扣，失败会退回，Pro 用户直接放行。
    if (!payload.autoTranslate) {
      const quota = deps.usageService.consume('ocr')
      if (!quota.allowed) return
    }
    let toastTimer: ReturnType<typeof setTimeout> | null = null
    try {
      // 快速识别不闪 toast；超过 150ms 才提示，避免短任务频繁闪窗。
      toastTimer = setTimeout(
        () => {
          const settings = deps.settingsStore.get()
          deps.statusToast.show(t(settings.language, '识别中...'), settings.theme)
        },
        150
      )
      const result = await deps.platformServices.ocr.recognizeDataUrl(
        imageFromBytes(payload.pngBytes).toDataURL()
      )
      if (toastTimer) clearTimeout(toastTimer)
      deps.statusToast.hide()
      const settings = deps.settingsStore.get()
      deps.ocrManager.open({
        text: result.text,
        lines: result.lines,
        mode: payload.autoTranslate ? 'translate' : 'ocr',
        autoTranslate: payload.autoTranslate === true,
        settings: { ...settings, hasTranslationKey: deps.secretStore.hasTranslationKey() },
        hasTranslationKey: deps.secretStore.hasTranslationKey()
      })
    } catch (error) {
      if (!payload.autoTranslate) deps.usageService.refund('ocr')
      if (toastTimer) clearTimeout(toastTimer)
      deps.statusToast.hide()
      const message = error instanceof Error ? error.message : String(error)
      dialog.showErrorBox(t(deps.settingsStore.get().language, 'OCR 失败'), message)
    }
    return
  }
  if (payload.action === 'pin') {
    deps.pinManager.create(
      payload.pngBytes,
      payload.selection.width,
      payload.selection.height,
      {
        x: capture.bounds.x + payload.selection.x,
        y: capture.bounds.y + payload.selection.y
      }
    )
  }
}
