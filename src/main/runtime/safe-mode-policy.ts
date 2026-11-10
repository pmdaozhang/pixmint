/**
 * 背景：兼容模式是异常会话后的降级开关，但一次误触发会永久关闭硬件加速。
 * 设计意图：把“连续多少次正常会话后自动退出”抽成纯策略，便于单测和调整阈值。
 * 关键约束：只做计数判断，不读写文件、不依赖 Electron。
 */
export const SAFE_MODE_CLEAN_SESSIONS_TO_EXIT = 3

export function shouldExitSafeMode(cleanSessions: number): boolean {
  return Number.isFinite(cleanSessions) && cleanSessions >= SAFE_MODE_CLEAN_SESSIONS_TO_EXIT
}
