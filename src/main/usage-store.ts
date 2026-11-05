import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { writeJsonAtomic } from './settings-utils'
import {
  DEFAULT_DAILY_LIMITS,
  consumeUsage,
  emptyUsage,
  evaluateUsage,
  dayKey,
  limitsWithOverrides,
  normalizeUsage,
  refundUsage,
  snapshotUsage,
  type LimitOverrides,
  type UsageEvaluation,
  type UsageFeature,
  type UsageSnapshot,
  type UsageState
} from '../shared/usage'

/**
 * 每日配额只由主进程读写；渲染层看不到文件，也无法直接改计数。
 * 跨天后的第一次读取会把计数归零并落盘。
 */
export class UsageStore {
  private state: UsageState
  private readonly limits: Record<UsageFeature, number>

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
    overrides?: LimitOverrides
  ) {
    this.limits = limitsWithOverrides(overrides ?? envLimits())
    this.state = this.load()
    const day = dayKey(this.now())
    if (this.state.day !== day) {
      this.state = emptyUsage(day)
      this.persist()
    }
  }

  snapshot(): UsageSnapshot {
    this.ensureDay()
    return snapshotUsage(this.state, this.limits, this.now())
  }

  getLimits(): Record<UsageFeature, number> {
    return { ...this.limits }
  }

  evaluate(feature: UsageFeature): UsageEvaluation {
    this.ensureDay()
    return evaluateUsage(this.state, feature, this.limits[feature], this.now())
  }

  consume(feature: UsageFeature): UsageEvaluation {
    this.ensureDay()
    const result = consumeUsage(this.state, feature, this.limits[feature], this.now())
    if (result.evaluation.allowed) {
      this.state = result.state
      this.persist()
    }
    return result.evaluation
  }

  refund(feature: UsageFeature): void {
    this.ensureDay()
    const next = refundUsage(this.state, feature, this.now())
    if (next !== this.state) {
      this.state = next
      this.persist()
    }
  }

  private ensureDay(): void {
    const day = dayKey(this.now())
    if (this.state.day === day) return
    this.state = emptyUsage(day)
    this.persist()
  }

  private persist(): void {
    writeJsonAtomic(this.filePath, this.state)
  }

  private load(): UsageState {
    const day = dayKey(this.now())
    if (!existsSync(this.filePath)) return emptyUsage(day)
    try {
      const parsed: unknown = JSON.parse(
        readFileSync(this.filePath, 'utf8').replace(/^﻿/, '')
      )
      return normalizeUsage(parsed, this.now())
    } catch {
      try {
        copyFileSync(this.filePath, `${this.filePath}.bak`)
      } catch {
        // 备份失败不影响重置
      }
      return emptyUsage(day)
    }
  }
}

/** E2E / 本地验证可临时调低额度，生产不设置该环境变量。 */
function envLimits(): LimitOverrides | undefined {
  const raw = process.env.PIXMINT_DAILY_LIMITS?.trim()
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    return parsed as LimitOverrides
  } catch {
    return undefined
  }
}

export { DEFAULT_DAILY_LIMITS }
