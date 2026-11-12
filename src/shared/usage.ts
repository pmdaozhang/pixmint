/**
 * 背景：OCR / 翻译 / 录制从 0.8.1 起有每日免费次数，Pro 不限。
 * 设计意图：把「今天用了几次、还能不能用」做成纯函数，主进程与单测共用，
 *          时间通过参数注入，避免测试依赖系统时钟。
 * 关键约束：日期按本机时区划分，跨天自动归零；计数只增不减，退款单独处理。
 */

export type UsageFeature = 'ocr' | 'translate' | 'gif' | 'video'

export const USAGE_FEATURES: UsageFeature[] = ['ocr', 'translate', 'gif', 'video']

export const DEFAULT_DAILY_LIMITS: Record<UsageFeature, number> = {
  ocr: 20,
  translate: 10,
  gif: 3,
  video: 1
}

export const USAGE_SCHEMA_VERSION = 1

export interface UsageState {
  version: number
  day: string
  counts: Record<UsageFeature, number>
}

export interface UsageEvaluation {
  feature: UsageFeature
  day: string
  limit: number
  used: number
  remaining: number
  allowed: boolean
}

export interface UsageSnapshot {
  day: string
  limits: Record<UsageFeature, number>
  used: Record<UsageFeature, number>
  remaining: Record<UsageFeature, number>
}

export interface UsageView extends UsageSnapshot {
  pro: boolean
  /** 开发版（未打包）默认不限次数；打包发布版和强制测试模式下为 false。 */
  unlimited: boolean
}

export interface UsageConsumeResult {
  state: UsageState
  evaluation: UsageEvaluation
}

export function isUsageFeature(value: unknown): value is UsageFeature {
  return typeof value === 'string' && (USAGE_FEATURES as string[]).includes(value)
}

/** 本地时区的 YYYY-MM-DD。 */
export function dayKey(nowMs: number): string {
  const date = new Date(nowMs)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function emptyUsage(day: string): UsageState {
  return {
    version: USAGE_SCHEMA_VERSION,
    day,
    counts: { ocr: 0, translate: 0, gif: 0, video: 0 }
  }
}

function countOr(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1_000_000, Math.floor(value)))
}

/**
 * 读取 usage.json 时使用：脏数据不能影响启动，跨天直接归零。
 */
export function normalizeUsage(input: unknown, nowMs: number): UsageState {
  const day = dayKey(nowMs)
  if (!input || typeof input !== 'object') return emptyUsage(day)
  const source = input as {
    version?: unknown
    day?: unknown
    counts?: Record<string, unknown>
  }
  if (source.day !== day) return emptyUsage(day)
  const counts = source.counts
  return {
    version: USAGE_SCHEMA_VERSION,
    day,
    counts: {
      ocr: countOr(counts?.ocr),
      translate: countOr(counts?.translate),
      gif: countOr(counts?.gif),
      video: countOr(counts?.video)
    }
  }
}

export interface LimitOverrides {
  [feature: string]: number | undefined
}

export function limitsWithOverrides(overrides?: LimitOverrides): Record<UsageFeature, number> {
  if (!overrides) return { ...DEFAULT_DAILY_LIMITS }
  const next = { ...DEFAULT_DAILY_LIMITS }
  for (const feature of USAGE_FEATURES) {
    const text = overrides[feature]
    if (typeof text === 'number' && Number.isFinite(text) && text >= 0) {
      next[feature] = Math.floor(text)
    }
  }
  return next
}

/** 只读检查，不改变计数。 */
export function evaluateUsage(
  state: UsageState,
  feature: UsageFeature,
  limit: number,
  nowMs: number
): UsageEvaluation {
  const day = dayKey(nowMs)
  if (state.day !== day) {
    return { feature, day, limit, used: 0, remaining: limit, allowed: true }
  }
  const used = countOr(state.counts[feature])
  const remaining = Math.max(0, limit - used)
  return { feature, day, limit, used, remaining, allowed: used < limit }
}

/** 尝试扣一次；达到上限时返回 allowed=false 且状态不变。 */
export function consumeUsage(
  state: UsageState,
  feature: UsageFeature,
  limit: number,
  nowMs: number
): UsageConsumeResult {
  const day = dayKey(nowMs)
  const base = state.day === day ? state : emptyUsage(day)
  const evaluation = evaluateUsage(base, feature, limit, nowMs)
  if (!evaluation.allowed) return { state: base, evaluation }
  const used = base.counts[feature] + 1
  return {
    state: {
      ...base,
      day,
      counts: { ...base.counts, [feature]: used }
    },
    evaluation: {
      ...evaluation,
      used,
      remaining: Math.max(0, limit - used),
      allowed: true
    }
  }
}

/** 操作失败时退回一次；不会退成负数，也不会跨天退。 */
export function refundUsage(state: UsageState, feature: UsageFeature, nowMs: number): UsageState {
  const day = dayKey(nowMs)
  if (state.day !== day) return state
  return {
    ...state,
    counts: {
      ...state.counts,
      [feature]: Math.max(0, state.counts[feature] - 1)
    }
  }
}

export function snapshotUsage(
  state: UsageState,
  limits: Record<UsageFeature, number>,
  nowMs: number
): UsageSnapshot {
  const day = dayKey(nowMs)
  const used = state.day === day ? state.counts : emptyUsage(day).counts
  return {
    day,
    limits: { ...limits },
    used: { ...used },
    remaining: {
      ocr: Math.max(0, limits.ocr - used.ocr),
      translate: Math.max(0, limits.translate - used.translate),
      gif: Math.max(0, limits.gif - used.gif),
      video: Math.max(0, limits.video - used.video)
    }
  }
}
