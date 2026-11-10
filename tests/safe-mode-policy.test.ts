import { describe, expect, it } from 'vitest'
import {
  SAFE_MODE_CLEAN_SESSIONS_TO_EXIT,
  shouldExitSafeMode
} from '../src/main/runtime/safe-mode-policy'

describe('safe mode clean-session policy', () => {
  it('keeps compatibility mode for the first clean sessions', () => {
    expect(shouldExitSafeMode(0)).toBe(false)
    expect(shouldExitSafeMode(1)).toBe(false)
    expect(shouldExitSafeMode(SAFE_MODE_CLEAN_SESSIONS_TO_EXIT - 1)).toBe(false)
  })

  it('exits compatibility mode once enough clean sessions pass', () => {
    expect(shouldExitSafeMode(SAFE_MODE_CLEAN_SESSIONS_TO_EXIT)).toBe(true)
    expect(shouldExitSafeMode(SAFE_MODE_CLEAN_SESSIONS_TO_EXIT + 5)).toBe(true)
  })

  it('ignores invalid counter values', () => {
    expect(shouldExitSafeMode(Number.NaN)).toBe(false)
    expect(shouldExitSafeMode(Number.POSITIVE_INFINITY)).toBe(false)
    expect(shouldExitSafeMode(-1)).toBe(false)
  })
})
