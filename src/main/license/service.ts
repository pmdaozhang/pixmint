import type {
  LicenseActivation,
  LicenseDevice,
  LicenseStatus,
  ManualOrder,
  ManualOrderResult,
  PaymentProvider,
  PurchaseOrder,
  PurchaseOrderResult
} from '../../shared/license'
import type { LicenseRecord, LicenseStore } from './store'
import { verifyToken } from './token'

const REFRESH_GRACE_MS = 30 * 24 * 60 * 60 * 1000

export interface LicenseFetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type LicenseFetch = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
  }
) => Promise<LicenseFetchResponse>

export interface LicenseServiceOptions {
  store: LicenseStore
  deviceId: () => string
  apiBase?: string
  fetchImpl: LicenseFetch
  now?: () => number
  /** 授权状态变化（激活、续签成功、退款清空）后回调，用于刷新托盘菜单。 */
  onChange?: () => void
  /**
   * 开发版模拟终身会员，只用于预览会员 UI；由主进程按 !app.isPackaged 注入，
   * 打包发布版永远为 false。不写本地授权文件，也不请求授权服务。
   */
  devPro?: boolean
}

export class LicenseApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'LicenseApiError'
  }
}

interface ActivationResponse {
  token: string
  code: string
  plan: 'pro'
  expiresAt: number | null
  devicesUsed: number
  devicesMax: number
}

interface RefreshResponse {
  token: string
  expiresAt: number | null
  devicesUsed?: number
  devicesMax?: number
}

interface RestoreResponse extends ActivationResponse {}

interface OrderResponse {
  orderId: string
  orderToken: string
  qrSvg?: string
  payUrl?: string
  expiresAt: number
}

interface OrderStatusResponse {
  status: 'pending' | 'paid' | 'expired' | 'refunded'
  code?: string
  token?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export class LicenseService {
  private readonly apiBase: string
  private readonly now: () => number
  private refreshing: Promise<LicenseStatus> | null = null

  constructor(private readonly options: LicenseServiceOptions) {
    this.apiBase = (
      options.apiBase ??
      process.env.PIXMINT_LICENSE_URL?.trim() ??
      'https://data.hugproducthub.top/api/v1'
    ).replace(/\/$/, '')
    this.now = options.now ?? Date.now
  }

  status(): LicenseStatus {
    if (this.options.devPro) return this.devStatus()
    const record = this.options.store.get()
    const now = this.now()
    if (!record.token) {
      return {
        pro: false,
        plan: null,
        expiresAt: null,
        updateUntil: null,
        code: record.code || null,
        devicesUsed: record.devicesUsed ?? 0,
        devicesMax: record.devicesMax ?? 5,
        needsRefresh: false,
        offline: false
      }
    }
    const verified = verifyToken(record.token, {
      now,
      deviceId: this.options.deviceId(),
      allowExpiredUntil: record.lastRefreshAt + REFRESH_GRACE_MS
    })
    if (!verified.ok || !verified.payload) {
      return {
        pro: false,
        plan: null,
        expiresAt: null,
        updateUntil: null,
        code: record.code || null,
        devicesUsed: record.devicesUsed ?? 0,
        devicesMax: record.devicesMax ?? 5,
        needsRefresh: false,
        offline: false,
        reason: verified.reason
      }
    }
    return {
      pro: true,
      plan: verified.payload.plan,
      expiresAt: verified.payload.exp,
      updateUntil: verified.payload.upd,
      code: record.code || null,
      devicesUsed: record.devicesUsed ?? 0,
      devicesMax: record.devicesMax ?? 5,
      needsRefresh: verified.needsRefresh,
      offline: verified.needsRefresh
    }
  }

  /** 开发版会员预览用的固定状态：终身有效、单设备、不落盘。 */
  private devStatus(): LicenseStatus {
    return {
      pro: true,
      plan: 'pro',
      expiresAt: null,
      updateUntil: null,
      code: 'PM261112-DEV1',
      devicesUsed: 1,
      devicesMax: 5,
      needsRefresh: false,
      offline: false
    }
  }

  isPro(): boolean {
    return this.status().pro
  }

  async activate(code: string): Promise<LicenseActivation> {
    const response = await this.request<ActivationResponse>('/license/activate', {
      code: code.trim(),
      deviceId: this.options.deviceId(),
      deviceName: process.platform
    })
    this.saveActivation(response)
    return {
      token: response.token,
      code: response.code,
      plan: 'pro',
      expiresAt: response.expiresAt,
      devicesUsed: response.devicesUsed,
      devicesMax: response.devicesMax
    }
  }

  async restoreByDevice(): Promise<LicenseStatus | null> {
    const record = this.options.store.get()
    try {
      const response = await this.request<RestoreResponse>('/license/by-device', {
        deviceId: this.options.deviceId()
      })
      this.saveActivation(response)
      return this.status()
    } catch (error) {
      if (error instanceof LicenseApiError && error.status === 404) return null
      if (record.token) return this.status()
      throw error
    }
  }

  async refresh(): Promise<LicenseStatus> {
    if (this.options.devPro) return this.devStatus()
    if (this.refreshing) return this.refreshing
    const record = this.options.store.get()
    if (!record.token) return this.status()
    this.refreshing = (async () => {
      let response: RefreshResponse
      try {
        response = await this.request<RefreshResponse>('/license/refresh', {
          token: record.token,
          deviceId: this.options.deviceId()
        })
      } catch (error) {
        // 退款/封禁后服务端返回 410，立即清掉本地授权，避免永久保留 Pro。
        if (
          error instanceof LicenseApiError &&
          (error.status === 410 || error.status === 401)
        ) {
          this.options.store.clear()
          this.options.onChange?.()
          return this.status()
        }
        throw error
      }
      this.options.store.save({
        token: response.token,
        lastRefreshAt: this.now(),
        devicesUsed: response.devicesUsed ?? record.devicesUsed,
        devicesMax: response.devicesMax ?? record.devicesMax
      })
      this.options.onChange?.()
      return this.status()
    })()
    try {
      return await this.refreshing
    } finally {
      this.refreshing = null
    }
  }

  async devices(): Promise<LicenseDevice[]> {
    if (this.options.devPro) {
      const now = Math.floor(this.now() / 1000)
      return [
        {
          deviceHash: '0'.repeat(64),
          name: 'Windows 预览设备',
          firstSeen: now - 24 * 60 * 60,
          lastSeen: now,
          current: true
        },
        {
          deviceHash: '1'.repeat(64),
          name: 'Windows 备用设备',
          firstSeen: now - 10 * 24 * 60 * 60,
          lastSeen: now - 3 * 24 * 60 * 60,
          current: false
        }
      ]
    }
    const record = this.options.store.get()
    if (!record.code) return []
    const response = await this.request<{ devices: LicenseDevice[] }>('/license/devices', {
      code: record.code,
      deviceId: this.options.deviceId()
    })
    const devices = Array.isArray(response.devices) ? response.devices : []
    this.options.store.save({ devicesUsed: devices.length })
    return devices
  }

  async unbind(deviceHash: string): Promise<void> {
    const record = this.options.store.get()
    if (!record.code) return
    await this.request('/license/unbind', {
      code: record.code,
      deviceId: this.options.deviceId(),
      targetDevice: deviceHash
    })
    await this.devices().catch(() => {})
  }

  async trial(inviteCode: string): Promise<LicenseActivation> {
    const response = await this.request<ActivationResponse>('/license/trial', {
      inviteCode: inviteCode.trim(),
      deviceId: this.options.deviceId(),
      deviceName: process.platform
    })
    this.saveActivation(response)
    return {
      token: response.token,
      code: response.code,
      plan: 'pro',
      expiresAt: response.expiresAt,
      devicesUsed: response.devicesUsed,
      devicesMax: response.devicesMax
    }
  }

  async createOrder(
    plan: 'monthly' | 'yearly' | 'lifetime',
    provider: PaymentProvider
  ): Promise<PurchaseOrder> {
    const response = await this.request<OrderResponse>('/pay/orders', {
      plan,
      provider,
      deviceId: this.options.deviceId(),
      appVersion: process.env.npm_package_version ?? ''
    })
    return response
  }

  async orderStatus(orderId: string, orderToken: string): Promise<PurchaseOrderResult> {
    const response = await this.request<OrderStatusResponse>(
      `/pay/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(orderToken)}`,
      undefined,
      'GET'
    )
    if (response.status === 'paid' && response.token) {
      const record = this.options.store.get()
      const now = this.now()
      this.options.store.save({
        token: response.token,
        code: response.code ?? record.code,
        lastRefreshAt: now,
        lastSeenAt: now
      })
    }
    return response
  }

  async createManualOrder(
    plan: 'monthly' | 'yearly' | 'lifetime',
    provider: PaymentProvider
  ): Promise<ManualOrder> {
    return this.request<ManualOrder>('/manual/orders', {
      plan,
      provider,
      deviceId: this.options.deviceId(),
      deviceName: process.platform
    })
  }

  async submitManualOrder(orderId: string, orderToken: string): Promise<ManualOrder> {
    return this.request<ManualOrder>(
      `/manual/orders/${encodeURIComponent(orderId)}/submit`,
      { token: orderToken }
    )
  }

  async manualOrderStatus(
    orderId: string,
    orderToken: string
  ): Promise<ManualOrderResult> {
    const response = await this.request<ManualOrderResult>(
      `/manual/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(orderToken)}`,
      undefined,
      'GET'
    )
    if (response.status === 'paid' && response.token) {
      const record = this.options.store.get()
      const now = this.now()
      this.options.store.save({
        token: response.token,
        code: response.code ?? record.code,
        lastRefreshAt: now,
        lastSeenAt: now
      })
    }
    return response
  }

  private saveActivation(response: ActivationResponse): void {
    const now = this.now()
    // 服务端返回的 code 只在首次发码/恢复时出现；缺省时保留原值。
    const patch: Partial<LicenseRecord> = {
      token: response.token,
      lastRefreshAt: now,
      lastSeenAt: now,
      devicesUsed: response.devicesUsed,
      devicesMax: response.devicesMax
    }
    if (response.code) patch.code = response.code
    this.options.store.save(patch)
    this.options.onChange?.()
  }

  private async request<T = unknown>(
    path: string,
    body: Record<string, unknown> | undefined,
    method: 'GET' | 'POST' = 'POST'
  ): Promise<T> {
    const url = `${this.apiBase}${path}`
    let response: LicenseFetchResponse
    try {
      response = await this.options.fetchImpl(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(12_000)
      })
    } catch (error) {
      throw new LicenseApiError(
        error instanceof Error ? error.message : String(error),
        'network',
        0
      )
    }
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (!response.ok) {
      const message =
        isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${response.status}`
      const code =
        isRecord(payload) && typeof payload.code === 'string' ? payload.code : 'http_error'
      throw new LicenseApiError(message, code, response.status)
    }
    return payload as T
  }
}
