import { describe, expect, it } from 'vitest'
import {
  MEMORY_MIN_SESSIONS_BEFORE_RECYCLE,
  MEMORY_RECYCLE_THRESHOLD_BYTES,
  evaluateMemoryGrowth
} from '../src/main/runtime/memory-governor'

const MB = 1024 * 1024

describe('evaluateMemoryGrowth', () => {
  const baseline = 200 * MB

  it('会话数不足时一律保留', () => {
    expect(
      evaluateMemoryGrowth({
        baselineBytes: baseline,
        currentBytes: baseline + 500 * MB,
        sessionsSinceBaseline: MEMORY_MIN_SESSIONS_BEFORE_RECYCLE - 1
      })
    ).toBe('keep')
  })

  it('增长低于阈值时保留', () => {
    expect(
      evaluateMemoryGrowth({
        baselineBytes: baseline,
        currentBytes: baseline + MEMORY_RECYCLE_THRESHOLD_BYTES - 1,
        sessionsSinceBaseline: 100
      })
    ).toBe('keep')
  })

  it('达到阈值且会话数足够时重建', () => {
    expect(
      evaluateMemoryGrowth({
        baselineBytes: baseline,
        currentBytes: baseline + MEMORY_RECYCLE_THRESHOLD_BYTES,
        sessionsSinceBaseline: 100
      })
    ).toBe('recycle')
  })

  it('缺失采样数据时不做判断', () => {
    expect(
      evaluateMemoryGrowth({
        baselineBytes: 0,
        currentBytes: baseline,
        sessionsSinceBaseline: 100
      })
    ).toBe('keep')
  })

  it('内存回落时绝不重建', () => {
    expect(
      evaluateMemoryGrowth({
        baselineBytes: baseline,
        currentBytes: baseline - 20 * MB,
        sessionsSinceBaseline: 100
      })
    ).toBe('keep')
  })
})
