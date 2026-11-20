import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LicenseService } from '../src/main/license/service'
import { LicenseStore, PLAIN_CIPHER } from '../src/main/license/store'

/**
 * 分享抵扣链路：报价由服务端算，客户端只取数展示；
 * 满 12 次时走 /manual/claim 直接领取，不再生成付款订单。
 */
const NOW = 1_800_000_000_000
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function signedToken(deviceId: string): string {
  const payload = {
    v: 1,
    kid: 'dev',
    plan: 'pro',
    lic: 'lic-share',
    dev: deviceId,
    iat: NOW - 1000,
    exp: NOW + 86_400_000,
    upd: null,
    feat: ['pro'],
    trial: false
  }
  const part = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = sign(null, Buffer.from(part, 'utf8'), privateKey).toString('base64url')
  return `${part}.${signature}`
}

type Call = { url: string; body: Record<string, unknown> }

function createHarness(
  handler: (path: string) => { status?: number; body: unknown } | Error
): { service: LicenseService; calls: Call[] } {
  const dir = mkdtempSync(join(tmpdir(), 'pixmint-share-discount-'))
  const calls: Call[] = []
  const service = new LicenseService({
    store: new LicenseStore(join(dir, 'license.json'), PLAIN_CIPHER),
    deviceId: () => 'device-a',
    apiBase: 'http://test.local/api/v1',
    now: () => NOW,
    fetchImpl: async (url, init) => {
      const path = url.replace('http://test.local/api/v1', '')
      calls.push({ url: path, body: JSON.parse(init?.body ?? '{}') })
      const result = handler(path)
      if (result instanceof Error) throw result
      const status = result.status ?? 200
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => result.body
      }
    }
  })
  return { service, calls }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('分享抵扣报价', () => {
  it('把服务端报价原样返回，不在客户端重算金额', async () => {
    const { service } = createHarness(() => ({
      body: { count: 3, priceCents: 5800, creditCents: 1500, amountCents: 4300, free: false }
    }))
    const quote = await service.referralQuote()
    expect(quote).toEqual({
      count: 3,
      priceCents: 5800,
      creditCents: 1500,
      amountCents: 4300,
      free: false
    })
  })

  it('报价请求失败时返回 null，页面按原价展示而不是报错', async () => {
    const { service } = createHarness(() => new Error('offline'))
    await expect(service.referralQuote()).resolves.toBeNull()
  })

  it('满 12 次时报价标记 free', async () => {
    const { service } = createHarness(() => ({
      body: { count: 12, priceCents: 5800, creditCents: 5800, amountCents: 0, free: true }
    }))
    const quote = await service.referralQuote()
    expect(quote?.free).toBe(true)
    expect(quote?.amountCents).toBe(0)
  })
})

describe('下单与分享相关信息', () => {
  it('下单请求带上本地激活码，便于换机后抵扣跟着账号走', async () => {
    const { service, calls } = createHarness((path) => {
      if (path === '/manual/orders') {
        return {
          body: {
            orderId: 'PM1',
            orderToken: 't',
            orderNumber: 'PM1',
            status: 'pending_payment',
            plan: 'lifetime',
            channel: 'alipay',
            amountCents: 4300,
            priceCents: 5800,
            shareCount: 3,
            shareCreditCents: 1500,
            expiresAt: NOW + 1000,
            qrUrls: { alipay: '/a.png', wechat: '/w.png' }
          }
        }
      }
      return { status: 404, body: {} }
    })
    // 先写入本地激活码
    const store = (service as unknown as { options: { store: LicenseStore } }).options.store
    store.save({ code: 'PM261120-AAAA' })
    const order = await service.createManualOrder('lifetime', 'alipay')
    expect(order.amountCents).toBe(4300)
    expect(order.shareCreditCents).toBe(1500)
    const call = calls.find((item) => item.url === '/manual/orders')
    expect(call?.body.licenseCode).toBe('PM261120-AAAA')
    // 价格不由客户端上报
    expect(call?.body).not.toHaveProperty('amountCents')
  })
})

describe('分享满额免费领取', () => {
  // 公钥走 PIXMINT_LICENSE_PUBLIC_KEY（kid=dev），不用改内置公钥表
  function useTestKey(): void {
    vi.stubEnv('PIXMINT_LICENSE_PUBLIC_KEY', PUBLIC_PEM)
  }

  it('领取成功后写入本地授权，状态变成 Pro', async () => {
    useTestKey()
    const { service, calls } = createHarness((path) => {
      if (path === '/manual/claim') {
        return {
          body: {
            token: signedToken('device-a'),
            code: 'PM261120-FREE',
            plan: 'pro',
            expiresAt: null,
            devicesUsed: 1,
            devicesMax: 3
          }
        }
      }
      return { status: 404, body: {} }
    })
    const activation = await service.claimShareReward()
    expect(activation.code).toBe('PM261120-FREE')
    expect(calls.map((item) => item.url)).toContain('/manual/claim')
    expect(service.status().pro).toBe(true)
  })

  it('服务端拒绝（次数不足或已领过）时抛出错误，不写本地授权', async () => {
    const { service } = createHarness(() => ({
      status: 409,
      body: { error: '分享次数不足（11/12）', code: 'share_not_enough' }
    }))
    await expect(service.claimShareReward()).rejects.toThrow('分享次数不足')
    expect(service.status().pro).toBe(false)
  })
})
