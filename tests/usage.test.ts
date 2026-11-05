import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DAILY_LIMITS,
  consumeUsage,
  dayKey,
  emptyUsage,
  evaluateUsage,
  normalizeUsage,
  refundUsage,
  snapshotUsage
} from '../src/shared/usage'

const AT = (iso: string): number => new Date(iso).getTime()

describe('dayKey', () => {
  it('按本地日期生成 key', () => {
    expect(dayKey(AT('2026-11-05T10:00:00'))).toBe('2026-11-05')
    expect(dayKey(AT('2026-11-05T23:59:59'))).toBe('2026-11-05')
    expect(dayKey(AT('2026-11-06T00:00:01'))).toBe('2026-11-06')
  })
})

describe('consumeUsage', () => {
  it('递增到上限后拒绝，且拒绝时状态不变', () => {
    const day = dayKey(AT('2026-11-05T10:00:00'))
    let state = emptyUsage(day)
    for (let index = 0; index < 3; index += 1) {
      const result = consumeUsage(state, 'gif', 3, AT('2026-11-05T10:00:00'))
      expect(result.evaluation.allowed).toBe(true)
      state = result.state
    }
    const denied = consumeUsage(state, 'gif', 3, AT('2026-11-05T10:00:00'))
    expect(denied.evaluation.allowed).toBe(false)
    expect(denied.evaluation.remaining).toBe(0)
    expect(denied.state.counts.gif).toBe(3)
  })

  it('跨天自动归零', () => {
    const state = consumeUsage(
      emptyUsage(dayKey(AT('2026-11-05T10:00:00'))),
      'ocr',
      2,
      AT('2026-11-05T10:00:00')
    ).state
    const nextDay = evaluateUsage(state, 'ocr', 2, AT('2026-11-06T00:00:01'))
    expect(nextDay.used).toBe(0)
    expect(nextDay.allowed).toBe(true)
  })
})

describe('normalizeUsage', () => {
  it('损坏/旧数据回退为空，且限制非法值', () => {
    const now = AT('2026-11-05T10:00:00')
    expect(normalizeUsage(null, now).counts.ocr).toBe(0)
    expect(normalizeUsage({ day: '2026-11-04', counts: { ocr: 9 } }, now).counts.ocr).toBe(0)
    expect(
      normalizeUsage({ day: '2026-11-05', counts: { ocr: -3, gif: 'x' } }, now).counts
    ).toEqual({ ocr: 0, translate: 0, gif: 0, video: 0 })
    expect(
      normalizeUsage({ day: '2026-11-05', counts: { ocr: 12.8 } }, now).counts.ocr
    ).toBe(12)
  })
})

describe('refundUsage', () => {
  it('只退当天，且不会退成负数', () => {
    const day = dayKey(AT('2026-11-05T10:00:00'))
    let state = consumeUsage(emptyUsage(day), 'translate', 10, AT('2026-11-05T10:00:00')).state
    state = refundUsage(state, 'translate', AT('2026-11-05T10:00:00'))
    expect(state.counts.translate).toBe(0)
    state = refundUsage(state, 'translate', AT('2026-11-05T10:00:00'))
    expect(state.counts.translate).toBe(0)
    const otherDay = refundUsage({ ...state, day: '2026-11-04' }, 'translate', AT('2026-11-05T10:00:00'))
    expect(otherDay.day).toBe('2026-11-04')
  })
})

describe('snapshotUsage', () => {
  it('返回四项的已用与剩余', () => {
    const day = dayKey(AT('2026-11-05T10:00:00'))
    const state = consumeUsage(emptyUsage(day), 'video', 1, AT('2026-11-05T10:00:00')).state
    const snapshot = snapshotUsage(state, DEFAULT_DAILY_LIMITS, AT('2026-11-05T10:00:00'))
    expect(snapshot.remaining.video).toBe(0)
    expect(snapshot.remaining.ocr).toBe(DEFAULT_DAILY_LIMITS.ocr)
  })
})
