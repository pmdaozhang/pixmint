import { screen } from 'electron'
import type {
  LongCapturePreviewInfo,
  OverlayCompletePayload
} from '../shared/types'
import { notify } from './image-utils'
import { LongCaptureManager } from './long-capture'
import { LongCaptureHud } from './windows/long-capture-hud'
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
  private lastPayload: OverlayCompletePayload | null = null

  constructor(
    private readonly preloadPath: string,
    private readonly manager: LongCaptureManager
  ) {
    this.hud = new LongCaptureHud(preloadPath, () => {
      // 用户关闭 HUD 等同于取消本次长截图；已完成时 cancel 是幂等的。
      this.manager.cancel()
    })
  }

  async start(payload: OverlayCompletePayload): Promise<void> {
    this.lastPayload = payload
    const display =
      screen.getAllDisplays().find((candidate) => candidate.id === payload.displayId) ??
      screen.getPrimaryDisplay()
    this.hud.show(display, payload.selection)
    this.hud.send(this.manager.getProgress())
    try {
      await this.manager.start({
        display,
        selection: payload.selection,
        ...this.callbacks()
      })
    } catch (error) {
      this.hud.hide()
      const message = error instanceof Error ? error.message : String(error)
      notify(`长截图失败：${message}`)
    }
  }

  manual(): void {
    const payload = this.lastPayload
    if (!payload) return
    const display =
      screen.getAllDisplays().find((candidate) => candidate.id === payload.displayId) ??
      screen.getPrimaryDisplay()
    void this.manager
      .startManual({
        display,
        selection: payload.selection,
        ...this.callbacks()
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        notify(`手动长截图失败：${message}`)
      })
  }

  private callbacks(): {
    onProgress: (progress: ReturnType<LongCaptureManager['getProgress']>) => void
    onComplete: () => void
  } {
    return {
      onProgress: (progress) => this.hud.send(progress),
      onComplete: () => {
        this.hud.hide()
        createLongCapturePreview(this.preloadPath, () => {
          this.manager.deleteResult()
        })
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

  cancel(): void {
    this.manager.cancel()
    this.hud.hide()
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
    closeLongCapturePreview()
    this.manager.deleteResult()
    this.manager.dispose()
  }
}
