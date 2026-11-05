import { z } from 'zod'
import type { IpcContext } from './types'
import { handle, on } from './validate'

/** OCR 弹窗 ↔ 主进程。 */
export function registerOcrIpc(ctx: IpcContext): void {
  handle('ocr:ready', z.tuple([]), (event) => ctx.ocrManager.initFor(event.sender.id))
  on('ocr:close', z.tuple([]), (event) => {
    ctx.ocrManager.close(event.sender.id)
  })
  on('ocr:open-settings', z.tuple([]), () => {
    ctx.ocrManager.openSettings()
  })
  on('ocr:resize', z.tuple([z.number().finite().positive().max(10000)]), (event, [height]) => {
    ctx.ocrManager.resize(event.sender.id, height)
  })
}
