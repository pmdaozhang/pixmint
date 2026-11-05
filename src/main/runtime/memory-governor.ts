/**
 * 背景：ROADMAP 记录了覆盖层私有内存随截图次数线性增长且尚未封顶。
 * 托盘常驻工具会被按几十上百次/天，一旦加上插件，单靠 Chromium 自身回收不可控。
 * 设计意图：把"什么时候重建渲染进程"抽成纯策略，便于单测，也方便以后复用到插件宿主。
 * 关键约束：策略只给建议，不执行销毁；回收必须发生在会话结束、窗口已隐藏时。
 */

/**
 * 三个阈值都支持环境变量覆盖，仅用于压测时强制触发回收分支。
 * 生产环境不设置这些变量，行为固定为 25 次采样 / 50 次后判定 / 64MB 阈值。
 */
function positiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : fallback
}

/** 每完成多少次截图会话采样一次渲染进程内存。 */
export const MEMORY_SAMPLE_EVERY_SESSIONS = positiveIntEnv('PIXMINT_MEMORY_SAMPLE_EVERY', 25)

/** 基线建立后，至少要积累这么多次会话才允许判定回收，避免刚启动就误判。 */
export const MEMORY_MIN_SESSIONS_BEFORE_RECYCLE = positiveIntEnv(
  'PIXMINT_MEMORY_MIN_SESSIONS',
  50
)

/** 私有内存相对基线增长超过 64MB 即重建渲染进程。 */
export const MEMORY_RECYCLE_THRESHOLD_BYTES =
  positiveIntEnv('PIXMINT_MEMORY_RECYCLE_MB', 64) * 1024 * 1024

export interface MemoryGrowthInput {
  baselineBytes: number
  currentBytes: number
  sessionsSinceBaseline: number
  thresholdBytes?: number
  minSessions?: number
}

export type MemoryDecision = 'keep' | 'recycle'

export function evaluateMemoryGrowth(input: MemoryGrowthInput): MemoryDecision {
  const threshold = input.thresholdBytes ?? MEMORY_RECYCLE_THRESHOLD_BYTES
  const minSessions = input.minSessions ?? MEMORY_MIN_SESSIONS_BEFORE_RECYCLE
  if (input.baselineBytes <= 0 || input.currentBytes <= 0) return 'keep'
  if (input.sessionsSinceBaseline < minSessions) return 'keep'
  return input.currentBytes - input.baselineBytes >= threshold ? 'recycle' : 'keep'
}
