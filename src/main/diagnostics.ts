import { app } from 'electron'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { addBreadcrumb } from './breadcrumbs'
import { sanitizeDiagnosticText, type DiagnosticLevel } from '../shared/diagnostics'

const MAX_LOG_BYTES = 2 * 1024 * 1024
const MAX_LOG_FILES = 3
const FLUSH_DELAY_MS = 250
const MAX_QUEUED_LINES = 1000

let resolvedPath = ''
let queue: string[] = []
let flushTimer: NodeJS.Timeout | null = null
let flushing = false

/**
 * 背景：开发机和用户机器上，日志目录可能因权限或启动阶段不可用。
 * 设计意图：优先 userData，失败时回退 APPDATA/LOCALAPPDATA，保证诊断不阻断主流程。
 * 关键约束：只负责路径解析，不在这里创建目录。
 */
function dataDir(): string {
  try {
    return app.getPath('userData')
  } catch (error) {
    console.warn('DIAG_USER_DATA_FALLBACK', error)
    return join(
      process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(),
      'pixmint'
    )
  }
}

function logPath(): string {
  if (resolvedPath) return resolvedPath
  resolvedPath = join(dataDir(), 'snapglass.log')
  return resolvedPath
}

function ensureLogDir(): void {
  mkdirSync(dataDir(), { recursive: true })
}

/**
 * 背景：debug 级别在生产环境价值低，而且可能放大日志量和隐私暴露面。
 * 设计意图：默认只落 info/warn/error，需要时再通过显式调用打开 debug。
 * 关键约束：这个开关是进程内常量，不读取用户设置，避免设置损坏时日志失效。
 */
function shouldWrite(level: DiagnosticLevel): boolean {
  return level !== 'debug'
}

function formatLine(scope: string, message: string, level: DiagnosticLevel): string {
  return `${new Date().toISOString()} [${level}] [${sanitizeDiagnosticText(scope, 40)}] ${sanitizeDiagnosticText(
    message,
    2000
  )}\n`
}

/**
 * 背景：旧实现每条日志都 appendFileSync，渲染层高频 console 会阻塞主进程。
 * 设计意图：先在内存排队，按 250ms 批量异步写入，同时把关键日志转成面包屑。
 * 关键约束：日志失败不能抛到业务层；队列有上限，宁可丢弃最旧日志也不能无限占内存。
 */
export function logDiagnostic(
  scope: string,
  message: string,
  level: DiagnosticLevel = 'info'
): void {
  addBreadcrumb(scope, message, { level })
  if (!shouldWrite(level)) return

  queue.push(formatLine(scope, message, level))
  if (queue.length > MAX_QUEUED_LINES) {
    queue = queue.slice(queue.length - MAX_QUEUED_LINES)
  }
  if (queue.length >= 50) {
    void flushDiagnostics()
    return
  }
  scheduleFlush()
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushDiagnostics()
  }, FLUSH_DELAY_MS)
}

/**
 * 背景：异步批量写入必须避免并发 append 造成顺序错乱。
 * 设计意图：同一时刻只允许一个 flush，写完后如果又有新日志再排下一轮。
 * 关键约束：写入失败只警告，不把异常抛给截图/录制调用方。
 */
export async function flushDiagnostics(): Promise<void> {
  if (flushing || queue.length === 0) return
  flushing = true
  const lines = queue.splice(0)
  try {
    ensureLogDir()
    rotateIfNeeded(lines.join('').length)
    await appendFile(logPath(), lines.join(''), 'utf8')
  } catch (error) {
    console.warn('DIAG_LOG_WRITE_FAILED', error)
  } finally {
    flushing = false
    if (queue.length > 0) scheduleFlush()
  }
}

/**
 * 背景：崩溃和退出时异步队列可能还没落盘，必须同步兜底。
 * 设计意图：停止定时器，把当前队列一次性同步写入，保证最后几条关键日志不丢。
 * 关键约束：只在崩溃/退出路径调用，不能放进高频业务路径。
 */
export function flushDiagnosticsSync(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (queue.length === 0) return
  const lines = queue.splice(0)
  try {
    ensureLogDir()
    rotateIfNeeded(lines.join('').length)
    appendFileSync(logPath(), lines.join(''), 'utf8')
  } catch (error) {
    console.warn('DIAG_LOG_FLUSH_FAILED', error)
  }
}

/**
 * 背景：日志长期运行会无限增长，必须限制磁盘占用。
 * 设计意图：单个文件 2MB，最多保留 3 个文件，超出后按 .1/.2 滚动。
 * 关键约束：只做尽力而为的轮转；轮转失败不能让日志功能失效。
 */
function rotateIfNeeded(nextBytes: number): void {
  try {
    if (statSync(logPath()).size + nextBytes <= MAX_LOG_BYTES) return
  } catch {
    return
  }

  const base = logPath()
  try {
    for (let index = MAX_LOG_FILES - 1; index >= 1; index -= 1) {
      const from = index === 1 ? base : base.replace(/\.log$/, `.${index - 1}.log`)
      const to = base.replace(/\.log$/, `.${index}.log`)
      if (existsSync(to)) unlinkSync(to)
      if (existsSync(from)) renameSync(from, to)
    }
  } catch (error) {
    console.warn('DIAG_LOG_ROTATE_FAILED', error)
  }
}

export function diagnosticsPath(): string {
  return logPath()
}

export function diagnosticsDirectory(): string {
  return dataDir()
}

export function ensureDiagnosticsDirectory(): string {
  ensureLogDir()
  return dataDir()
}
