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
  email: string | null
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
  { id: 'monthly', label: '9 元/月', price: 900, days: 30 },
  { id: 'yearly', label: '80 元/年', price: 8000, days: 365 },
  { id: 'lifetime', label: '198 元 终身', price: 19800, days: null }
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
