import { describe, expect, it } from 'vitest'
import {
  REFERRAL,
  clampReferralCount,
  normalizeReferralCode,
  referralPrice
} from '../src/shared/referral'
import { newReferralCode, referralUrl } from '../src/main/referral-store'

describe('分享减会员费口径', () => {
  it('终身版 58 元，每 5 元一次，第 12 次免费', () => {
    expect(REFERRAL.price).toBe(58)
    expect(REFERRAL.step).toBe(5)
    expect(REFERRAL.target).toBe(12)
    expect(referralPrice(0)).toBe(58)
    expect(referralPrice(1)).toBe(53)
    expect(referralPrice(11)).toBe(3)
    expect(referralPrice(12)).toBe(0)
    expect(referralPrice(20)).toBe(0)
  })

  it('异常次数按 0 处理，不会出现负数价格', () => {
    expect(referralPrice(-3)).toBe(58)
    expect(referralPrice(Number.NaN)).toBe(58)
    expect(clampReferralCount(2.9)).toBe(2)
    expect(clampReferralCount(99)).toBe(REFERRAL.target)
    expect(clampReferralCount('3')).toBe(3)
  })
})

describe('分享码', () => {
  it('生成的码是 PM 前缀的字母数字，且不含易混字符', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = newReferralCode()
      expect(code).toMatch(/^PM[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/)
      expect(normalizeReferralCode(code)).toBe(code)
    }
  })

  it('分享链接指向官网下载页并带上 ref', () => {
    expect(referralUrl('PM7K3QAZ')).toBe(
      'https://pixmint.hugproducthub.top/download?ref=PM7K3QAZ'
    )
  })

  it('归一化会去掉空格并转大写，非法字符拒绝', () => {
    expect(normalizeReferralCode(' pm7k3qaz ')).toBe('PM7K3QAZ')
    expect(normalizeReferralCode('PM-7K3Q')).toBe('')
    expect(normalizeReferralCode('abc')).toBe('')
    expect(normalizeReferralCode(null)).toBe('')
    // 本机分享码必须是 PM + 6 位；好友 ref 放宽到 4~16 位，由服务端判定是否存在
    expect(normalizeReferralCode('ABCD1234')).toBe('')
    expect(normalizeReferralCode('ABCD1234', { friendRef: true })).toBe('ABCD1234')
    expect(normalizeReferralCode('PM7K3QAZBB', { friendRef: true })).toBe('PM7K3QAZBB')
  })
})
