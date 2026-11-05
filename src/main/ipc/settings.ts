import { z } from 'zod'
import { settingsPatchSchema } from './schemas'
import type { IpcContext } from './types'
import { handle, on } from './validate'

/** 设置读写、翻译密钥、打开设置窗。 */
export function registerSettingsIpc(ctx: IpcContext): void {
  handle('settings:get', z.tuple([]), () => ({
    ...ctx.settingsStore.get(),
    hasTranslationKey: ctx.secretStore.hasTranslationKey()
  }))

  handle('settings:update', z.tuple([settingsPatchSchema]), (_event, [patch]) => {
    // hasTranslationKey 是派生态，不允许渲染层写回设置文件。
    const { hasTranslationKey: _ignored, ...rest } = patch
    const next = ctx.settingsStore.update(rest)
    ctx.applySystemSettings()
    return { ...next, hasTranslationKey: ctx.secretStore.hasTranslationKey() }
  })

  handle('settings:set-translation-key', z.tuple([z.string().max(500)]), (_event, [key]) =>
    ctx.secretStore.setTranslationKey(key)
  )

  on('settings:open-window', z.tuple([]), () => {
    ctx.openSettingsWindow()
  })
}
