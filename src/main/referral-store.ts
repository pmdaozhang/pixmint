import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizeReferralCode } from '../shared/referral'

/**
 * 分享减会员费：本机保存分享码与已计人次。
 *
 * 购买页显示「已分享 N / 12 次」用这里的缓存；N 只随有效安装增长，
 * 不会因为重复复制链接而增加。没买会员的用户也需要看到进度，
 * 所以不放授权文件，单独存一份。
 */

const TARGET = 12
/** 与 shared/referral.ts 保持一致：分享码 4~16 位字母数字 */
// 分享码/好友 ref 的格式校验统一在 shared/referral.ts
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export interface ReferralState {
  /** 本机分享码（PM 前缀），未领取时为空串 */
  code: string
  /** 已计有效分享人次 */
  count: number
  /** 服务端明确返回活动已结束 */
  ended: boolean
  /** 最近一次拿到服务端数据的本地时间 */
  lastSyncedAt: number
  /** 好友登记时分享者当天额度已满，服务端要求稍后补记 */
  pendingFriendRef: string
}

const EMPTY: ReferralState = { code: '', count: 0, ended: false, lastSyncedAt: 0, pendingFriendRef: '' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeCode(value: unknown, options?: { friendRef?: boolean }): string {
  if (typeof value !== 'string') return ''
  return normalizeReferralCode(value, options)
}

function normalizeState(value: unknown): ReferralState {
  if (!isRecord(value)) return { ...EMPTY }
  const count =
    typeof value.count === 'number' && Number.isFinite(value.count)
      ? Math.max(0, Math.min(Math.floor(value.count), TARGET))
      : 0
  return {
    code: normalizeCode(value.code),
    count,
    ended: value.ended === true,
    lastSyncedAt:
      typeof value.lastSyncedAt === 'number' && Number.isFinite(value.lastSyncedAt)
        ? value.lastSyncedAt
        : 0,
    pendingFriendRef: normalizeCode(value.pendingFriendRef, { friendRef: true })
  }
}

export class ReferralStore {
  private cached: ReferralState | null = null
  private warned = false

  /**
   * 进度必须跨进程重启保留：否则每次启动都从 0 开始，服务端全挂时用户会以为清零了。
   * filePath 为空（单测）时退化为内存缓存。
   */
  constructor(private readonly filePath = '') {}

  get(): ReferralState {
    if (!this.cached) this.cached = this.read()
    return { ...this.cached }
  }

  /**
   * 合并保存。默认次数只增不减，避免换设备/清缓存造成倒退；
   * 服务端明确下发的权威值（同步成功、账号被重置）用 allowDecrease 才生效。
   */
  save(
    patch: Partial<ReferralState>,
    options?: { allowDecrease?: boolean; clearPending?: boolean }
  ): ReferralState {
    const current = this.get()
    const next: ReferralState = {
      code: normalizeCode(patch.code) || current.code,
      count:
        patch.count === undefined
          ? current.count
          : Math.max(0, Math.min(Math.floor(patch.count), TARGET)),
      ended: patch.ended === undefined ? current.ended : patch.ended,
      lastSyncedAt: patch.lastSyncedAt ?? current.lastSyncedAt,
      pendingFriendRef: options?.clearPending
        ? ''
        : patch.pendingFriendRef === undefined
          ? current.pendingFriendRef
          : normalizeCode(patch.pendingFriendRef, { friendRef: true })
    }
    if (!options?.allowDecrease && next.count < current.count) next.count = current.count
    this.cached = next
    this.persist(next)
    return { ...next }
  }

  private read(): ReferralState {
    if (!this.filePath) return { ...EMPTY }
    try {
      if (!existsSync(this.filePath)) return { ...EMPTY }
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8').replace(/^﻿/, ''))
      return normalizeState(raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw)
    } catch {
      return { ...EMPTY }
    }
  }

  private persist(state: ReferralState): void {
    if (!this.filePath) return
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify({ version: 1, data: state }, null, 2), 'utf8')
    } catch {
      // 磁盘满/权限异常时静默降级为内存缓存，不影响主流程
      if (!this.warned) {
        this.warned = true
        console.warn('[referral] 本地缓存不可写，本次会话仅存内存')
      }
    }
  }
}

/** 生成 PM 开头的分享码，避开 I/O/1/0 等易混字符 */
export function newReferralCode(): string {
  const bytes = randomBytes(6)
  let body = ''
  for (const byte of bytes) body += ALPHABET[byte % ALPHABET.length]
  return `PM${body}`
}

/** 好友下载链接：带 ref，安装后首次启动回传才计入分享者 */
export function referralUrl(code: string): string {
  return `https://pixmint.hugproducthub.top/download?ref=${encodeURIComponent(code)}`
}
