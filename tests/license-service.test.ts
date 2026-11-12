import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LicenseService } from '../src/main/license/service'
import { LicenseStore, PLAIN_CIPHER } from '../src/main/license/store'

const NOW = 1_800_000_000_000

function createService(devPro: boolean, fetchImpl = (): never => {
  throw new Error('开发版会员预览不应请求授权服务')
}): LicenseService {
  const dir = mkdtempSync(join(tmpdir(), 'pixmint-license-'))
  return new LicenseService({
    store: new LicenseStore(join(dir, 'license.json'), PLAIN_CIPHER),
    deviceId: () => 'device-a',
    fetchImpl: fetchImpl as never,
    now: () => NOW,
    devPro
  })
}

describe('LicenseService 开发版会员预览', () => {
  it('devPro 开启时返回终身会员状态，且不读本地授权', () => {
    const status = createService(true).status()
    expect(status.pro).toBe(true)
    expect(status.plan).toBe('pro')
    expect(status.expiresAt).toBeNull()
    expect(status.code).toBe('PM261112-DEV1')
    expect(status.devicesUsed).toBe(1)
    expect(status.devicesMax).toBe(5)
  })

  it('devPro 开启时 isPro 为 true', () => {
    expect(createService(true).isPro()).toBe(true)
  })

  it('devPro 开启时续签不发网络请求', async () => {
    const status = await createService(true).refresh()
    expect(status.pro).toBe(true)
    expect(status.code).toBe('PM261112-DEV1')
  })

  it('devPro 开启时设备列表返回本地预览设备，不发网络请求', async () => {
    const devices = await createService(true).devices()
    expect(devices).toHaveLength(2)
    expect(devices[0]).toMatchObject({
      deviceHash: '0'.repeat(64),
      current: true
    })
    expect(devices[1]).toMatchObject({
      deviceHash: '1'.repeat(64),
      current: false
    })
  })

  it('devPro 关闭且无授权时仍是免费用户', () => {
    const status = createService(false).status()
    expect(status.pro).toBe(false)
    expect(status.plan).toBeNull()
  })
})
