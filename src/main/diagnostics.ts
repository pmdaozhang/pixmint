import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let resolvedPath = ''

/**
 * 背景：用户反馈“没变化”时，主进程和渲染层的 console 在托盘启动模式下看不到。
 * 设计意图：把录制/覆盖层关键日志持久化到 userData，下一次可直接读取定位。
 * 关键约束：日志写入失败不能影响截图和录制，单条消息截断到 2000 字符。
 */
function logPath(): string {
  if (resolvedPath) return resolvedPath
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  resolvedPath = join(dir, 'snapglass.log')
  return resolvedPath
}

export function logDiagnostic(scope: string, message: string): void {
  try {
    const line = `${new Date().toISOString()} [${scope}] ${message.slice(0, 2000)}\n`
    appendFileSync(logPath(), line, 'utf8')
  } catch (error) {
    console.warn('DIAG_LOG_FAILED', error)
  }
}

export function diagnosticsPath(): string {
  return logPath()
}
