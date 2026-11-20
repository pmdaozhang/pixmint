/**
 * 授权相关的跨进程类型。
 * token 采用 base64url(payload).base64url(signature) 的紧凑格式，
 * 客户端只做离线验签，服务端负责签发设备绑定 token。
 */

export type LicensePlan = 'pro'

export interface LicensePayload {
  v: number
  kid: string
  plan: LicensePlan
  /** 授权记录 ID */
  lic: string
  /** 绑定的设备哈希；激活码本身为 null */
  dev: string | null
  order?: string
  iat: number
  /** null 表示终身 */
  exp: number | null
  /** 免费更新截止时间；null 表示跟随当前大版本 */
  upd: number | null
  feat: string[]
  trial?: boolean
}

export interface LicenseStatus {
  pro: boolean
  plan: LicensePlan | null
  expiresAt: number | null
  updateUntil: number | null
  code: string | null
  devicesUsed: number
  devicesMax: number
  /** 仅本地验签成功但需要联网续签 */
  needsRefresh: boolean
  offline: boolean
  reason?: string
}

export interface LicenseActivation {
  token: string
  code: string
  plan: LicensePlan
  expiresAt: number | null
  devicesUsed: number
  devicesMax: number
}

export interface LicenseDevice {
  deviceHash: string
  name: string
  firstSeen: number
  lastSeen: number
  current: boolean
}

export interface PurchasePlan {
  id: 'monthly' | 'yearly' | 'lifetime'
  label: string
  price: number
  days: number | null
}

export const PURCHASE_PLANS: PurchasePlan[] = [
  { id: 'lifetime', label: '58 元 终身', price: 5800, days: null }
]

export type PaymentProvider = 'alipay' | 'wechat'

export interface PurchaseOrder {
  orderId: string
  orderToken: string
  qrSvg?: string
  qrDataUrl?: string
  payUrl?: string
  expiresAt: number
}

export type PurchaseOrderStatus =
  | 'pending'
  | 'paid'
  | 'expired'
  | 'refunded'
  | 'unavailable'

export interface PurchaseOrderResult {
  status: PurchaseOrderStatus
  code?: string
  token?: string
}

export type ManualOrderStatus =
  | 'pending_payment'
  | 'reviewing'
  | 'paid'
  | 'rejected'
  | 'expired'

export interface ManualOrder {
  orderId: string
  orderToken: string
  orderNumber: string
  status: ManualOrderStatus
  plan: 'monthly' | 'yearly' | 'lifetime'
  channel: PaymentProvider
  amountCents: number
  /** 毫秒时间戳 */
  expiresAt: number
  qrUrls: Record<PaymentProvider, string>
  rejectReason?: string | null
  /** 原价（分）；金额一律以服务端下单结果为准 */
  priceCents?: number
  /** 下单时锁定的分享次数与抵扣金额（分） */
  shareCount?: number
  shareCreditCents?: number
}

/** 分享抵扣报价（服务端计算，客户端只负责展示） */
export interface ReferralQuote {
  count: number
  priceCents: number
  creditCents: number
  amountCents: number
  /** 分享次数已够，直接免费领取，不再生成付款订单 */
  free: boolean
}

export interface ManualOrderResult {
  status: ManualOrderStatus
  code?: string
  token?: string
  rejectReason?: string | null
}
