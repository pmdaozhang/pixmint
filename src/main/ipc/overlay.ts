import { screen } from 'electron'
import { z } from 'zod'
import { noteOverlayReady } from '../runtime/counters'
import { overlayCompleteSchema } from './schemas'
import type { IpcContext } from './types'
import { handle, on } from './validate'

/** 覆盖层窗口 ↔ 主进程：截图会话、窗口命中、完成/取消。 */
export function registerOverlayIpc(ctx: IpcContext): void {
  handle('overlay:ready', z.tuple([]), (event) => {
    noteOverlayReady()
    const capture = ctx.overlayManager.captureFor(event.sender.id)
    if (!capture) return null
    const point = screen.getCursorScreenPoint()
    return {
      ...capture,
      settings: ctx.settingsStore.get(),
      cursor: {
        x: Math.max(0, Math.min(capture.bounds.width - 1, point.x - capture.bounds.x)),
        y: Math.max(0, Math.min(capture.bounds.height - 1, point.y - capture.bounds.y))
      }
    }
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

  // 聚光灯是独立开关：用户手动改过之后，下次 F1 要沿用这个选择。
  on('overlay:spotlight-pref', z.tuple([z.boolean()]), (_event, [value]) => {
    ctx.overlayManager.setSpotlightPreference(value)
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

  on('overlay:complete', z.tuple([overlayCompleteSchema]), (event, [payload]) => {
    ctx.overlayManager.complete(payload, event.sender.id)
  })

  on('overlay:cancel', z.tuple([]), () => {
    ctx.overlayManager.cancel()
  })
}
