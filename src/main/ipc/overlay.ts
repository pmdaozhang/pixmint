import { clipboard, screen } from 'electron'
import { z } from 'zod'
import { noteOverlayReady } from '../runtime/counters'
import { imageFromBytes } from '../image-utils'
import { binarySchema, overlayCompleteSchema } from './schemas'
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

  on('overlay:auto-copy', z.tuple([binarySchema]), (event, [pngBytes]) => {
    if (!ctx.overlayManager.captureFor(event.sender.id)) return
    const image = imageFromBytes(pngBytes)
    if (!image.isEmpty()) clipboard.writeImage(image)
  })

  on('overlay:complete', z.tuple([overlayCompleteSchema]), (event, [payload]) => {
    ctx.overlayManager.complete(payload, event.sender.id)
  })

  on('overlay:cancel', z.tuple([]), () => {
    ctx.overlayManager.cancel()
  })
}
