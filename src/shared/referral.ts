/**
 * 「分享减会员费」活动的纯逻辑与接口调用。
 *
 * 业务规则（文案与定价的唯一事实源）：
 * - 每有效分享一次减 5 元，终身版 ¥58 最多减 12 次（第 12 次即 0 元）；
 * - 活动计次口径：好友通过带 ref 的下载链接安装后首次启动，才算一次；
 *   同一好友（按安装设备去重）只计一次，每次最多计 10 人次，防止刷单；
 * - 进度以服务端为准；离线时沿用本地缓存（落盘在 userData/referral.json）。
 *
 * 与授权服务同源（data.hugproducthub.top/api/v1），换服务器只改一处基址。
 */

export const REFERRAL = {
  /** 每有效分享减价（元） */
  step: 5,
  /** 免费所需分享次数 */
  target: 12,
  /** 单价（元），与 PURCHASE_PLANS 的 5800 分保持一致 */
  price: 58
} as const

/** 好友在这里填的分享码，避免字母 I/O 与数字 1/0 混淆 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const CODE_BODY_LENGTH = 6
const CODE_MIN_LENGTH = 4
const CODE_MAX_LENGTH = 16

export interface ReferralProgress {
  /** 已生效的有效分享次数 */
  count: number
  /** 服务端判定活动是否进行中；false 时客户端隐藏活动入口 */
  active: boolean
}

export const EMPTY_REFERRAL: ReferralProgress = { count: 0, active: true }

/**
 * 分享码只接受字母数字。传 friendRef=true 时按安装来源的 ref 规则校验（4~16 位），
 * 其余按本机分享码格式（PM + 6 位）校验：服务端只会签发 PM 开头的码，
 * 放宽成任意字母数字只会让非法链接多走一次网络请求。
 */
export function normalizeReferralCode(
  raw: string | null | undefined,
  options?: { friendRef?: boolean }
): string {
  if (!raw) return ''
  const code = raw.trim().toUpperCase()
  if (!/^[A-Z0-9]+$/.test(code)) return ''
  if (code.length < CODE_MIN_LENGTH || code.length > CODE_MAX_LENGTH) return ''
  if (options?.friendRef) return code
  return /^PM[A-Z0-9]{6}$/.test(code) ? code : ''
}

/** 已分享次数按有效人次计：负数归零、小数向下取整，并封顶在免费线 */
export function clampReferralCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(Math.floor(n), REFERRAL.target)
}

/** 按已分享次数计算终身版应付金额（元），最低 0 */
export function referralPrice(count: number): number {
  return Math.max(REFERRAL.price - clampReferralCount(count) * REFERRAL.step, 0)
}

/** 累计减掉的钱（元），封顶在原价以内 */
export function referralDiscount(count: number): number {
  return REFERRAL.price - referralPrice(count)
}
