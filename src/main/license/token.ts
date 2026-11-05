import { createPublicKey, verify } from 'node:crypto'
import type { LicensePayload } from '../../shared/license'
import { PRODUCTION_KEY_ID, PRODUCTION_PUBLIC_KEY } from './public-key'

const CLOCK_SKEW_MS = 5 * 60 * 1000

export type TokenFailure =
  | 'malformed'
  | 'signature'
  | 'expired'
  | 'device'
  | 'plan'
  | 'clock'

export interface VerifyOptions {
  now: number
  /** 有值时 token 必须绑定到该设备 */
  deviceId?: string
  /** 离线宽限截止时间：token 过期后仍可接受到这个时间点 */
  allowExpiredUntil?: number
}

export interface VerifyResult {
  ok: boolean
  payload?: LicensePayload
  needsRefresh: boolean
  reason?: TokenFailure
}

interface DecodedToken {
  payload: LicensePayload
  payloadPart: string
  signature: Buffer
}

export function publicKeys(): Record<string, string> {
  const keys: Record<string, string> = { [PRODUCTION_KEY_ID]: PRODUCTION_PUBLIC_KEY }
  const override = process.env.PIXMINT_LICENSE_PUBLIC_KEY?.trim()
  if (override) keys.dev = override
  return keys
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parsePayload(value: unknown): LicensePayload | null {
  if (!isRecord(value)) return null
  if (value.v !== 1 || value.plan !== 'pro') return null
  if (typeof value.kid !== 'string' || typeof value.lic !== 'string') return null
  if (value.dev !== null && typeof value.dev !== 'string') return null
  if (typeof value.iat !== 'number') return null
  if (value.exp !== null && typeof value.exp !== 'number') return null
  if (value.upd !== null && typeof value.upd !== 'number') return null
  if (!Array.isArray(value.feat) || !value.feat.includes('pro')) return null
  return value as unknown as LicensePayload
}

export function decodeToken(token: string): DecodedToken | null {
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  try {
    const json = fromBase64Url(parts[0]).toString('utf8')
    const payload = parsePayload(JSON.parse(json))
    if (!payload) return null
    return { payload, payloadPart: parts[0], signature: fromBase64Url(parts[1]) }
  } catch {
    return null
  }
}

/**
 * 校验 token 的签名、设备、套餐和有效期。
 * 过期但仍在离线宽限期内时返回 ok=true + needsRefresh=true，由上层决定是否放行 Pro。
 */
export function verifyToken(
  token: string,
  options: VerifyOptions,
  keys: Record<string, string> = publicKeys()
): VerifyResult {
  const decoded = decodeToken(token)
  if (!decoded) return { ok: false, needsRefresh: false, reason: 'malformed' }
  const { payload, payloadPart, signature } = decoded
  const pem = keys[payload.kid]
  if (!pem) return { ok: false, needsRefresh: false, reason: 'signature' }
  let valid = false
  try {
    valid = verify(null, Buffer.from(payloadPart, 'utf8'), createPublicKey(pem), signature)
  } catch {
    valid = false
  }
  if (!valid) return { ok: false, needsRefresh: false, reason: 'signature' }
  if (payload.plan !== 'pro' || !payload.feat.includes('pro')) {
    return { ok: false, needsRefresh: false, reason: 'plan' }
  }
  if (options.deviceId && payload.dev !== options.deviceId) {
    return { ok: false, needsRefresh: false, reason: 'device' }
  }
  if (payload.iat > options.now + CLOCK_SKEW_MS) {
    return { ok: false, needsRefresh: false, reason: 'clock' }
  }
  if (payload.exp !== null && payload.exp <= options.now) {
    const grace = options.allowExpiredUntil ?? 0
    if (grace > options.now) {
      return { ok: true, payload, needsRefresh: true }
    }
    return { ok: false, needsRefresh: false, reason: 'expired' }
  }
  return { ok: true, payload, needsRefresh: false }
}
