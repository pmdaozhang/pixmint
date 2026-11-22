import { describe, expect, it } from 'vitest'
import { ReferralService } from '../src/main/referral-service'
import { ReferralStore } from '../src/main/referral-store'

function setup(): ReferralService {
  return new ReferralService({
    store: new ReferralStore(),
    deviceId: () => 'device-a',
    fetchImpl: (async () => ({ ok: false, status: 200, json: async () => null })) as never,
    apiBase: 'https://example.test/api/v1'
  })
}

describe('安装器带来的 ref', () => {
  it('从安装命令行/文件名里解析出 ref', () => {
    const service = setup()
    expect(
      service.friendCode('C:\\Users\\me\\Downloads\\Pixmint-Setup-0.8.30 --ref=PM7K3QAZ.exe')
    ).toBe('PM7K3QAZ')
    expect(
      service.friendCode('"C:\\Users\\me\\Downloads\\Pixmint-Setup-0.8.30 --ref=PM7K3QAZ.exe"')
    ).toBe('PM7K3QAZ')
    expect(service.friendCode('C:\\Users\\me\\Downloads\\Pixmint-Setup-0.8.30.exe')).toBeNull()
  })

  it('安装器带来的 ref 也算好友来源', () => {
    const service = setup()
    service.detectFriendLaunch(['Pixmint'], 'PM7K3QAZ')
    expect(service.isFriendLaunch).toBe(true)
  })
})
