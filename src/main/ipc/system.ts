import { app, BrowserWindow, clipboard, net } from 'electron'
import { z } from 'zod'
import { translateText } from '../../shared/translation'
import { lookupDictionary } from '../dictionary'
import { t } from '../../shared/i18n'
import { feedbackSubmitSchema } from './schemas'
import type { IpcContext } from './types'
import { handle, on } from './validate'

/** 版本、剪贴板、词典、翻译、意见反馈。 */
export function registerSystemIpc(ctx: IpcContext): void {
  handle('app:version', z.tuple([]), () => app.getVersion())

  handle('clipboard:write-text', z.tuple([z.string().max(1_000_000)]), (_event, [text]) => {
    clipboard.writeText(text)
  })

  handle('dictionary:lookup', z.tuple([z.string().max(64)]), (_event, [word]) =>
    lookupDictionary(word)
  )

  handle(
    'translation:translate',
    z.tuple([z.string().max(5000), z.enum(['zh-CN', 'en-US']).optional()]),
    async (_event, [text, target]) => {
      const settings = ctx.settingsStore.get()
      const effective = target ? { ...settings, translationTarget: target } : settings
      const key = ctx.secretStore.getTranslationKey()
      if (settings.translationProvider !== 'free' && !key) {
        throw new Error(
          t(ctx.settingsStore.get().language, '未配置翻译 API Key，请先在设置页配置')
        )
      }
      const quota = ctx.usageService.consume('translate')
      if (!quota.allowed) {
        throw new Error(
          t(settings.language, '今日翻译次数已用完，明天再来吧')
        )
      }
      try {
        return await translateText(text, effective, key ?? '', net.fetch.bind(net) as typeof fetch)
      } catch (error) {
        ctx.usageService.refund('translate')
        throw error
      }
    }
  )

  handle('feedback:submit', z.tuple([feedbackSubmitSchema]), (_event, [input]) =>
    ctx.feedbackService.submit(input)
  )

  // 购买窗按内容高度自适应；会员页会同时收窄到 480px 卡片宽度
  on(
    'purchase:resize',
    z.tuple([
      z.number().finite().min(360).max(980),
      z.number().finite().min(360).max(1200).optional()
    ]),
    (event, [height, width]) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window || window.isDestroyed()) return
      const bounds = window.getBounds()
      const nextHeight = Math.round(height)
      const nextWidth = width ? Math.round(width) : bounds.width
      if (bounds.height === nextHeight && bounds.width === nextWidth) return
      window.setBounds({
        x: Math.round(bounds.x + (bounds.width - nextWidth) / 2),
        y: Math.round(bounds.y + (bounds.height - nextHeight) / 2),
        width: nextWidth,
        height: nextHeight
      })
    }
  )

  // 更新介绍页按内容高度自适应
  on(
    'whats-new:resize',
    z.tuple([z.number().finite().min(320).max(900)]),
    (event, [height]) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window || window.isDestroyed()) return
      const bounds = window.getBounds()
      const nextHeight = Math.round(height)
      if (bounds.height === nextHeight) return
      // 以窗口中心为锚点缩放，弹框始终停在屏幕中央
      window.setBounds({
        x: bounds.x,
        y: Math.round(bounds.y + (bounds.height - nextHeight) / 2),
        width: bounds.width,
        height: nextHeight
      })
    }
  )
}
