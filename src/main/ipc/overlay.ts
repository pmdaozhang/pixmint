import { clipboard, nativeImage, screen } from 'electron'
import { z } from 'zod'
import { logDiagnostic } from '../diagnostics'
import { noteOverlayReady } from '../runtime/counters'
import { overlayCompleteSchema, rectSchema } from './schemas'
import type { IpcContext } from './types'
import { handle, on } from './validate'

/** 覆盖层窗口 ↔ 主进程：截图会话、窗口命中、完成/取消。 */
export function registerOverlayIpc(ctx: IpcContext): void {
  handle('overlay:ready', z.tuple([]), (event) => {
    noteOverlayReady()
    const capture = ctx.overlayManager.captureFor(event.sender.id)
    return capture ? { ...capture, settings: ctx.settingsStore.get() } : null
  })

  on('overlay:renderer-ready', z.tuple([]), (event) => {
    ctx.overlayManager.markRendererReady(event.sender.id)
  })

  on('overlay:prepared', z.tuple([]), (event) => {
    ctx.overlayManager.markPrepared(event.sender.id)
  })

  on('overlay:warm-edit-done', z.tuple([]), (event) => {
    ctx.overlayManager.markWarmEditDone(event.sender.id)
  })

  on('overlay:heartbeat', z.tuple([]), (event) => {
    ctx.overlayManager.noteHeartbeat(event.sender.id)
  })

  handle(
    'overlay:window-at',
    z.tuple([z.number().finite(), z.number().finite()]),
    async (_event, [x, y]) => {
      const physical = screen.dipToScreenPoint({ x, y })
      const rect = await ctx.platformServices.windowQuery.query(physical.x, physical.y)
      if (!rect) return null
      return screen.screenToDipRect(null, rect)
    }
  )

  on('overlay:auto-copy', z.tuple([rectSchema]), (event, [selection]) => {
    const capture = ctx.overlayManager.captureFor(event.sender.id)
    if (!capture) return
    // 背景：自动复制原先由渲染线程编码整张 PNG，再用 IPC 传几 MB 字节，
    // 一次大选区就占住渲染主线程 549ms，工具栏和标注跟着卡。
    // 设计意图：主进程直接用本次截图的原图裁剪，渲染层只上报选区矩形。
    // 关键约束：裁剪坐标要按物理像素换算；失败只记日志，不能影响标注和录制。
    const startedAt = Date.now()
    try {
      const image = capture.imageBytes
        ? nativeImage.createFromBuffer(Buffer.from(capture.imageBytes))
        : nativeImage.createFromDataURL(capture.imageDataUrl)
      if (!image.isEmpty()) {
        const size = image.getSize()
        // 以解码后的实际像素尺寸为准，兼容缩放/测试用的假屏幕图。
        const scaleX = size.width / capture.bounds.width
        const scaleY = size.height / capture.bounds.height
        const x = Math.max(0, Math.min(size.width - 1, Math.round(selection.x * scaleX)))
        const y = Math.max(0, Math.min(size.height - 1, Math.round(selection.y * scaleY)))
        const width = Math.max(
          1,
          Math.min(size.width - x, Math.round(selection.width * scaleX))
        )
        const height = Math.max(
          1,
          Math.min(size.height - y, Math.round(selection.height * scaleY))
        )
        const cropped = image.crop({ x, y, width, height })
        if (!cropped.isEmpty()) clipboard.writeImage(cropped)
      }
    } catch (error) {
      logDiagnostic('overlay', `auto-copy failed: ${String(error)}`, 'warn')
      return
    }
    const totalMs = Date.now() - startedAt
    if (totalMs > 300) {
      logDiagnostic('overlay', `auto-copy slow: total=${totalMs}ms`, 'warn')
    }
  })

  on('overlay:complete', z.tuple([overlayCompleteSchema]), (event, [payload]) => {
    ctx.overlayManager.complete(payload, event.sender.id)
  })

  on('overlay:cancel', z.tuple([]), () => {
    ctx.overlayManager.cancel()
  })
}
