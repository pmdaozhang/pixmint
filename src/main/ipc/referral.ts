import { z } from 'zod'
import type { ReferralService } from '../referral-service'
import { handle } from './validate'

/** 分享减会员费：只读进度与上下文，不涉及资金变动 */
export function registerReferralIpc(ctx: { referralService: ReferralService }): void {
  // 立即返回本地快照并触发一次后台同步；页面稍后补拉即可拿到服务端最新次数。
  // 不在 IPC 里 await 同步：多个页面同时读进度会互相踢掉进行中的同步请求。
  handle('referral:progress', z.tuple([]), () => ctx.referralService.progress())
  handle('referral:context', z.tuple([]), () => ({
    shareUrl: ctx.referralService.shareUrl(),
    friendLaunch: ctx.referralService.isFriendLaunch,
    // 弹框打开时顺带同步一次；count 先给本地值，页面约 2 秒后补拉
    count: ctx.referralService.progress().count
  }))
}
