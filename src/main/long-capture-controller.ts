import { screen } from 'electron'
import type {
  LongCapturePreviewInfo,
  OverlayCompletePayload,
  Rect
} from '../shared/types'
import { notify } from './image-utils'
import { LongCaptureManager } from './long-capture'
import { LongCaptureHud } from './windows/long-capture-hud'
import { LongCaptureBorder } from './windows/long-capture-border'
import {
  closeLongCapturePreview,
  createLongCapturePreview
} from './windows/long-capture-preview'

/**
 * 长截图的 UI 编排：覆盖层动作 → HUD → 主进程会话 → 预览窗口。
 * manager 负责算法和文件，controller 只负责窗口生命周期和 IPC 转发。
 */
export class LongCaptureController {
  private readonly hud: LongCaptureHud
  private readonly border: LongCaptureBorder
  private lastPayload: OverlayCompletePayload | null = null

  constructor(
    private readonly preloadPath: string,
    private readonly manager: LongCaptureManager
  ) {
    this.border = new LongCaptureBorder(preloadPath)
    this.hud = new LongCaptureHud(preloadPath, () => {
      // 用户关闭 HUD 等同于取消本次长截图；已完成时 cancel 是幂等的。
      this.manager.cancel()
      this.border.hide()
    })
  }

  async start(payload: OverlayCompletePayload): Promise<void> {
    this.lastPayload = payload
    const display =
      screen.getAllDisplays().find((candidate) => candidate.id === payload.displayId) ??
      screen.getPrimaryDisplay()
    this.hud.show(display, payload.selection)
    this.hud.send(this.manager.getProgress())
    this.border.show(display, payload.selection, 'auto')
    try {
      await this.manager.start({
        display,
        selection: payload.selection,
        ...this.callbacks()
      })
    } catch (error) {
      this.border.hide()
      this.hud.hide()
      const message = error instanceof Error ? error.message : String(error)
      notify(`长截图失败：${message}`)
    }
  }

  /**
   * 背景：窗口长截图从实时选区窗口启动，不再经过旧覆盖层 complete 流程。
   * 设计意图：复用自动长截图 manager、HUD 和边界层；窗口已由窗口选择器置前。
   * 关键约束：调用前实时选区窗口必须已隐藏，selection 使用显示器相对 DIP。
   */
  async startSelection(
    display: Electron.Display,
    selection: Rect,
    expectedHwnd?: number
  ): Promise<void> {
    this.lastPayload = {
      action: 'long',
      displayId: display.id,
      selection,
      pngBytes: new Uint8Array(0)
    }
    this.hud.show(display, selection)
    this.hud.send(this.manager.getProgress())
    this.border.show(display, selection, 'auto')
    try {
      await this.manager.start({
        display,
        selection,
        expectedHwnd,
        ...this.callbacks()
      })
    } catch (error) {
      this.border.hide()
      this.hud.hide()
      const message = error instanceof Error ? error.message : String(error)
      notify(`长截图失败：${message}`)
    }
  }

  /**
   * 背景：手动长截图不应只作为自动失败后的兜底，工具栏需要能直接进入。
   * 设计意图：复用同一个 HUD 和 manager，只是把启动方法换成 startManual。
   * 关键约束：必须在覆盖层已隐藏后调用；手动模式不需要滚动目标窗口。
   */
  async startManual(payload: OverlayCompletePayload): Promise<void> {
    this.lastPayload = payload
    const display =
      screen.getAllDisplays().find((candidate) => candidate.id === payload.displayId) ??
      screen.getPrimaryDisplay()
    this.hud.show(display, payload.selection)
    this.hud.send(this.manager.getProgress())
    this.border.show(display, payload.selection, 'manual')
    try {
      await this.manager.startManual({
        display,
        selection: payload.selection,
        ...this.callbacks()
      })
    } catch (error) {
      this.border.hide()
      this.hud.hide()
      const message = error instanceof Error ? error.message : String(error)
      notify(`手动长截图失败：${message}`)
    }
  }

  manual(): void {
    const payload = this.lastPayload
    if (!payload) return
    void this.startManual(payload)
  }

  retry(): void {
    const payload = this.lastPayload
    if (!payload) return
    void this.start(payload)
  }

  private callbacks(): {
    onProgress: (progress: ReturnType<LongCaptureManager['getProgress']>) => void
    onComplete: () => void
  } {
    return {
      onProgress: (progress) => this.hud.send(progress),
      onComplete: () => {
        this.border.hide()
        this.hud.hide()
        const previewInfo = this.manager.getPreviewInfo()
        createLongCapturePreview(this.preloadPath, () => {
          this.manager.deleteResult()
        }, previewInfo?.width)
      }
    }
  }

  pause(): void {
    this.manager.pause()
    this.hud.send(this.manager.getProgress())
  }

  resume(): void {
    this.manager.resume()
    this.hud.send(this.manager.getProgress())
  }

  finish(): void {
    this.manager.finish()
  }

  undo(): void {
    this.manager.undo()
  }

  cancel(): void {
    this.manager.cancel()
    this.hud.hide()
    this.border.hide()
  }

  previewInfo(): LongCapturePreviewInfo | null {
    return this.manager.getPreviewInfo()
  }

  savePreview(): Promise<string | null> {
    return this.manager.saveResult()
  }

  copyPreview(): string {
    return this.manager.copyResult()
  }

  closePreview(): void {
    this.manager.deleteResult()
    closeLongCapturePreview()
  }

  dispose(): void {
    this.manager.cancel()
    this.hud.dispose()
    this.border.dispose()
    closeLongCapturePreview()
    this.manager.deleteResult()
    this.manager.dispose()
  }
}
