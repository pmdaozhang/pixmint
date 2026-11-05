import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { LicensePayload } from '../src/shared/license'
import { verifyToken } from '../src/main/license/token'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const keys = { 'test-1': publicKey.export({ type: 'spki', format: 'pem' }).toString() }
const NOW = 1_800_000_000_000

function makeToken(patch: Partial<LicensePayload> = {}): string {
  const payload: LicensePayload = {
    v: 1,
    kid: 'test-1',
    plan: 'pro',
    lic: 'lic_1',
    dev: 'device-a',
    iat: NOW - 1000,
    exp: NOW + 86_400_000,
    upd: null,
    feat: ['pro'],
    ...patch
  }
  const part = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = sign(null, Buffer.from(part, 'utf8'), privateKey).toString('base64url')
  return `${part}.${signature}`
}

describe('verifyToken', () => {
  it('合法 token 通过并返回 payload', () => {
    const result = verifyToken(makeToken(), { now: NOW, deviceId: 'device-a' }, keys)
    expect(result.ok).toBe(true)
    expect(result.payload?.lic).toBe('lic_1')
    expect(result.needsRefresh).toBe(false)
  })

  it('篡改 payload 后签名失败', () => {
    const token = makeToken()
    const [part, signature] = token.split('.')
    const tampered = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(part, 'base64url').toString()), plan: 'pro', lic: 'evil' })
    ).toString('base64url')
    const result = verifyToken(`${tampered}.${signature}`, { now: NOW }, keys)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('signature')
  })

  it('设备不匹配被拒绝', () => {
    const result = verifyToken(makeToken(), { now: NOW, deviceId: 'device-b' }, keys)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('device')
  })

  it('过期后在宽限期内允许但标记需要续签', () => {
    const token = makeToken({ exp: NOW - 1000 })
    const grace = verifyToken(
      token,
      { now: NOW, allowExpiredUntil: NOW + 86_400_000 },
      keys
    )
    expect(grace.ok).toBe(true)
    expect(grace.needsRefresh).toBe(true)
    const expired = verifyToken(token, { now: NOW }, keys)
    expect(expired.ok).toBe(false)
    expect(expired.reason).toBe('expired')
  })

  it('未来签发时间过大按时钟回拨处理', () => {
    const result = verifyToken(makeToken({ iat: NOW + 60 * 60 * 1000 }), { now: NOW }, keys)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('clock')
  })

  it('终身 token 的 exp 为 null 时不过期', () => {
    const result = verifyToken(makeToken({ exp: null }), { now: NOW + 10 * 365 * 86_400_000 }, keys)
    expect(result.ok).toBe(true)
  })
})
