import { z } from 'zod'
import { imageFromBytes } from '../image-utils'
import { binarySchema } from './schemas'
import type { IpcContext } from './types'
import { handle, on } from './validate'

/** 钉图窗口 ↔ 主进程：创建、复制、保存、透明度、穿透、缩放、拖拽、编辑。 */
export function registerPinIpc(ctx: IpcContext): void {
  const pin = ctx.pinManager

  handle('pin:ready', z.tuple([]), (event) => pin.initFor(event.sender.id))
  on('pin:close', z.tuple([]), (event) => {
    pin.close(event.sender.id)
  })
  handle('pin:copy', z.tuple([]), (event) => {
    pin.copy(event.sender.id)
  })
  handle('pin:save', z.tuple([]), (event) => {
    pin.save(event.sender.id)
  })
  handle('pin:recognize-text', z.tuple([]), async (event) => {
    const bytes = pin.imageBytesFor(event.sender.id)
    if (!bytes) return null
    const image = imageFromBytes(bytes)
    if (image.isEmpty()) return null
    return ctx.platformServices.ocr.recognizeDataUrl(image.toDataURL())
  })
  handle('pin:set-edit-mode', z.tuple([z.boolean()]), (event, [active]) =>
    pin.setEditMode(event.sender.id, active)
  )
  handle('pin:commit-edit', z.tuple([binarySchema]), (event, [imageBytes]) =>
    pin.commitEdit(event.sender.id, imageBytes)
  )
  handle('pin:set-opacity', z.tuple([z.number().min(0).max(1)]), (event, [value]) =>
    pin.setOpacity(event.sender.id, value)
  )
  handle('pin:zoom', z.tuple([z.union([z.literal(1), z.literal(-1)])]), (event, [direction]) =>
    pin.zoom(event.sender.id, direction)
  )
  on('pin:drag-start', z.tuple([]), (event) => {
    pin.dragStart(event.sender.id)
  })
  on('pin:drag-move', z.tuple([z.number().finite(), z.number().finite()]), (event, [dx, dy]) => {
    pin.dragMove(event.sender.id, dx, dy)
  })
  on('pin:drag-end', z.tuple([]), (event) => {
    pin.dragEnd(event.sender.id)
  })
  on('pin:context-menu', z.tuple([]), (event) => {
    pin.contextMenu(event.sender.id)
  })
}
