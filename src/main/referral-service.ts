import { normalizeReferralCode, type ReferralProgress } from '../shared/referral'
import type { LicenseService } from './license/service'
import { newReferralCode, referralUrl, type ReferralState, type ReferralStore } from './referral-store'

export const SHARE_ACTIVITY_TARGET = 12
export const SHARE_ACTIVITY_STEP = 5
const SYNC_INTERVAL_MS = 10 * 60 * 1000

export type ReferralFetch = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
  }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface ReferralServiceOptions {
  store: ReferralStore
  deviceId: () => string
  fetchImpl: ReferralFetch
  apiBase?: string
  /** 已购用户的激活码；未购用户传 null，服务端会按设备记录进度 */
  licenseCode?: () => string | null
  now?: () => number
  /** 进度或活动状态变化后回调，用于刷新托盘菜单 */
  onChange?: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readCount(payload: unknown): number | null {
  if (!isRecord(payload)) return null
  const value = payload.count
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  return null
}

/**
 * 分享减会员费的服务端同步。
 *
 * 计次口径：好友用带 ref 的链接安装、首次启动并登记后，服务端才上调 count；
 * 本机复制链接不走这里，所以多复制几次不会多算。
 * 网络失败一律沿用本地缓存，不阻塞页面、不打断用户。
 */
export class ReferralService {
  private readonly apiBase: string
  private readonly now: () => number
  /** 成功拿到服务端数据的时间；失败不占节流额度，下次打开菜单会立即重试 */
  private lastSuccessAt = 0
  /** 本次启动时是否为「好友从分享链接安装」，决定分享弹框展示哪套文案 */
  private friendIncoming = false
  private syncing: Promise<ReferralState> | null = null

  constructor(private readonly options: ReferralServiceOptions) {
    this.apiBase = (
      options.apiBase ??
      process.env.PIXMINT_LICENSE_URL?.trim() ??
      'https://data.hugproducthub.top/api/v1'
    ).replace(/\/$/, '')
    this.now = options.now ?? Date.now
  }

  /**
   * 读启动参数里的 ref。只把「路径可执行文件 + --ref=」这种安装后首次启动当成好友来源：
   * 登录自启、第二次启动也会带同样参数，不能每次都宣称“本次分享已计入对方”。
   */
  detectFriendLaunch(args: string[]): void {
    this.friendIncoming = Boolean(this.friendRefArg(args))
  }

  /** 从完整启动参数里找 ref；用于首次启动登记与好友文案判断 */
  friendRefArg(args: string[]): string | null {
    // 浏览器下载 exe 时把参数写成 `Pixmint-Setup-x.exe --ref=CODE`；
    // 要求前面空白分隔，避免把 URL 片段之类的参数误认成安装来源
    const arg = args.find((value) => /[^A-Za-z0-9]ref=[A-Za-z0-9]{4,16}(?![A-Za-z0-9])/.test(value))
    return arg ? this.friendCode(arg) : null
  }

  get isFriendLaunch(): boolean {
    return this.friendIncoming
  }

  get state(): ReferralState {
    return this.options.store.get()
  }

  /**
   * 购买页与分享弹框用的快照：立即返回本地缓存，同时在后台同步一次。
   * 页面约 1~3 秒后补拉即可看到服务端最新次数；网络失败时保持缓存不变。
   * 不在 IPC 里 await 同步：多个页面同时读进度会互相踢掉进行中的同步请求。
   */
  progress(): ReferralProgress {
    const state = this.state
    void this.sync().catch(() => {})
    return { count: state.count, active: !state.ended }
  }

  /** 本机分享链接；没有分享码时当场生成并持久化（不联网，同步交给调用方） */
  shareUrl(): string {
    let state = this.state
    if (!state.code) {
      state = this.options.store.save({ code: newReferralCode() })
    }
    return referralUrl(state.code)
  }

  /** 从链接里解析好友的分享码，用于安装后首次启动登记 */
  friendCode(arg: string): string | null {
    // 浏览器把 .exe 当文件下载，命令行里只剩「路径 --ref=码」，没有完整 URL
    // 前面必须是「非字母数字」边界，避免把 xref=... 之类的参数误认成推荐码
    const match = /[^A-Za-z0-9]ref=([A-Za-z0-9]{4,16})(?![A-Za-z0-9])/.exec(arg)
    return match ? normalizeReferralCode(match[1], { friendRef: true }) || null : null
  }

  /** 好友首次启动：把 ref 登记到服务端，成功后返回分享者最新的有效次数 */
  /**
   * 好友首次启动登记 ref。
   * - 成功/被拒：返回服务端响应，结束；
   * - 网络失败：下次启动再试；
   * - 分享者当天额度已满（retryLater）：记到本机，之后每次启动排队补记，不丢也不重复。
   */
  async registerFriend(code: string): Promise<unknown> {
    const payload = await this.post('/referral/friend', {
      code,
      deviceId: this.options.deviceId(),
      licenseCode: this.options.licenseCode?.() ?? null
    })
    if (isRecord(payload) && payload.retryLater === true) {
      this.options.store.save({ pendingFriendRef: code })
      return payload
    }
    if (payload !== null) this.options.store.save({}, { clearPending: true })
    return payload
  }

  /** 启动时补记之前因对方额度满而被推迟的好友登记 */
  async flushPendingFriend(): Promise<void> {
    const pending = this.state.pendingFriendRef
    if (!pending) return
    const payload = await this.post('/referral/friend', {
      code: pending,
      deviceId: this.options.deviceId(),
      licenseCode: this.options.licenseCode?.() ?? null
    })
    if (payload === null || (isRecord(payload) && payload.retryLater === true)) return
    this.options.store.save({}, { clearPending: true })
  }

  /**
   * 同步本机分享进度：
   * - 未购用户上传本机已登记的好友数，取服务端与本地较大值，防止重装后清零；
   * - 已购用户带上激活码，便于服务端核对。
   */
  async sync(force = false): Promise<ReferralState> {
    const state = this.state
    if (!state.code) return state
    const now = this.now()
    if (!force && this.lastSuccessAt && now - this.lastSuccessAt < SYNC_INTERVAL_MS) {
      return state
    }
    if (this.syncing) return this.syncing
    this.syncing = (async () => {
      const payload = await this.post('/referral/sync', {
        code: state.code,
        deviceId: this.options.deviceId(),
        count: state.count,
        // 同一次读，既做已购用户的激活码核对，也让未购用户能把按设备积累的次数合并过来
        licenseCode: this.options.licenseCode?.() ?? null
      })
      const count = payload ? readCount(payload) : null
      if (count === null) return state
      // 服务端是权威：次数可以下调（例如作弊被清），活动开关也以服务端为准（活动延期能恢复）
      this.lastSuccessAt = now
      const next = this.options.store.save(
        {
          count,
          ended: isRecord(payload) && payload.ended === true,
          // 客户端没有服务端记录的码时采用服务端发的，避免一直用旧设备码
          code: isRecord(payload) && typeof payload.code === 'string' ? payload.code : undefined,
          lastSyncedAt: now
        },
        { allowDecrease: true }
      )
      if (next.count !== state.count || next.ended !== state.ended) this.options.onChange?.()
      return next
    })()
    try {
      return await this.syncing
    } finally {
      this.syncing = null
    }
  }

  /** 返回服务端原始响应；网络/HTTP 失败返回 null（调用方沿用本地缓存） */
  private async post(
    path: string,
    body: Record<string, unknown>
  ): Promise<unknown> {
    try {
      const response = await this.options.fetchImpl(`${this.apiBase}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6_000)
      })
      if (!response.ok) return null
      return await response.json()
    } catch {
      return null
    }
  }
}

/**
 * 由 LicenseService 取已购用户的激活码。
 * 单独成函数而不是直接依赖整个 LicenseService，是为了让单测能塞一个假对象。
 */
export function licenseCodeGetter(license: Pick<LicenseService, 'status'>): () => string | null {
  return () => license.status().code || null
}
