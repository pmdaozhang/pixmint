import { z } from 'zod'
import {
  arrayBufferSchema,
  binarySchema,
  gifDoneMetaSchema,
  recorderBeginSchema,
  recorderControlCommandSchema,
  recorderStatePatchSchema,
  videoDoneMetaSchema
} from './schemas'
import type { IpcContext } from './types'
import { handle, on } from './validate'

/** 录制窗口 / 控制条 / 预览窗 ↔ 主进程。 */
export function registerRecorderIpc(ctx: IpcContext): void {
  const recorder = ctx.recorderManager

  handle('recorder:begin', z.tuple([recorderBeginSchema]), (event, [payload]) => {
    const capture = ctx.overlayManager.captureFor(event.sender.id)
    if (!capture) throw new Error('截图会话已结束，请重新截图')
    const feature = payload.mode === 'gif' ? 'gif' : 'video'
    const quota = ctx.usageService.consume(feature)
    if (!quota.allowed) {
      return { sourceId: '', denied: true, reason: 'quota', feature } as const
    }
    try {
      return recorder.begin(event.sender.id, payload, capture.bounds)
    } catch (error) {
      ctx.usageService.refund(feature)
      throw error
    }
  })

  on('recorder:state', z.tuple([recorderStatePatchSchema]), (_event, [patch]) => {
    recorder.updateState(patch)
  })

  on(
    'recorder:gif-done',
    z.tuple([binarySchema, gifDoneMetaSchema]),
    (_event, [bytes, meta]) => {
      recorder.gifDone(bytes, meta)
    }
  )

  handle('recorder:video-begin', z.tuple([videoDoneMetaSchema]), (_event, [meta]) =>
    recorder.videoBegin(meta)
  )

  on('recorder:video-chunk', z.tuple([arrayBufferSchema]), (_event, [chunk]) => {
    recorder.videoChunk(chunk)
  })

  on('recorder:video-done', z.tuple([videoDoneMetaSchema]), (_event, [meta]) => {
    void recorder.videoDone(meta)
  })

  on('recorder:video-failed', z.tuple([z.string()]), (_event, [message]) => {
    recorder.failed(message)
  })

  on('recorder:dismiss', z.tuple([]), () => {
    recorder.dismiss()
  })

  handle('recorder:control-ready', z.tuple([]), () => recorder.controlReady())

  on(
    'recorder:control-command',
    z.tuple([recorderControlCommandSchema]),
    (_event, [command]) => {
      recorder.controlCommand(command)
    }
  )

  handle('recorder:preview-ready', z.tuple([]), () => recorder.previewReady())
  handle('recorder:preview-read', z.tuple([]), () => recorder.previewRead())
  handle('recorder:preview-save', z.tuple([]), () => recorder.previewSave())
  handle('recorder:preview-copy', z.tuple([]), () => recorder.previewCopy())
  on('recorder:preview-retry', z.tuple([]), () => {
    recorder.previewRetry()
  })
  on('recorder:preview-close', z.tuple([]), () => {
    recorder.previewClose()
  })
  on('recorder:preview-open-folder', z.tuple([]), () => {
    recorder.previewOpenFolder()
  })
}
