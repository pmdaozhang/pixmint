import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import { addBreadcrumb, getBreadcrumbs } from './breadcrumbs'
import { flushDiagnosticsSync } from './diagnostics'
import { safeModeRequested } from './safe-mode'
import {
  sanitizeDiagnosticData,
  sanitizeDiagnosticText,
  type Breadcrumb
} from '../shared/diagnostics'

const MAX_CRASH_REPORTS = 20

export type CrashKind =
  | 'uncaughtException'
  | 'unhandledRejection'
  | 'render-process-gone'
  | 'child-process-gone'
  | 'unresponsive'

export interface CrashReport {
  id: string
  at: string
  kind: CrashKind
  message: string
  stack?: string
  details?: Record<string, unknown>
  appVersion: string
  platform: string
  arch: string
  osVersion: string
  safeMode: boolean
  breadcrumbs: Breadcrumb[]
  memory: NodeJS.MemoryUsage
}

let installed = false

/**
 * 背景：主进程和渲染进程都可能在用户机器上异常退出，现有代码只覆盖覆盖层。
 * 设计意图：把异常转成一份可读的本地报告，保留版本、系统、最近操作和内存状态。
 * 关键约束：报告只写本地 userData；不上传、不包含截图、OCR 文字或剪贴板内容。
 */
export function buildCrashReport(
  kind: CrashKind,
  error: unknown,
  details?: Record<string, unknown>
): CrashReport {
  const value = error instanceof Error ? error : new Error(String(error ?? 'unknown error'))
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind,
    message: sanitizeDiagnosticText(value.message, 2000),
    stack: value.stack ? sanitizeDiagnosticText(value.stack, 8000) : undefined,
    details: details
      ? (sanitizeDiagnosticData(details) as Record<string, unknown>)
      : undefined,
    appVersion: safeAppVersion(),
    platform: process.platform,
    arch: process.arch,
    osVersion: release(),
    safeMode: safeModeRequested(),
    breadcrumbs: getBreadcrumbs(),
    memory: process.memoryUsage()
  }
}

export function crashReportsDirectory(): string {
  return join(app.getPath('userData'), 'crash-reports')
}

export interface CrashReportSummary {
  count: number
  latestFile: string | null
  latestAt: string | null
}

/**
 * 背景：设置页需要显示崩溃报告数量和最近一次时间，但不应该读取报告内容。
 * 设计意图：只扫描目录和 mtime，返回轻量摘要。
 * 关键约束：目录不存在或读取失败时返回空摘要，不能让设置页加载失败。
 */
export function getCrashReportSummary(): CrashReportSummary {
  try {
    const dir = crashReportsDirectory()
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const filePath = join(dir, name)
        return { filePath, time: statSync(filePath).mtimeMs }
      })
      .sort((a, b) => b.time - a.time)
    return {
      count: files.length,
      latestFile: files[0]?.filePath ?? null,
      latestAt: files[0] ? new Date(files[0].time).toISOString() : null
    }
  } catch {
    return { count: 0, latestFile: null, latestAt: null }
  }
}

/**
 * 背景：崩溃报告需要在下一次启动时还能被找到，不能只存在内存。
 * 设计意图：按时间命名写入 JSON，并只保留最近 20 份，避免无限占磁盘。
 * 关键约束：写盘失败只输出控制台，不能递归触发异常处理。
 */
export function writeCrashReport(report: CrashReport): string | null {
  try {
    const dir = crashReportsDirectory()
    mkdirSync(dir, { recursive: true })
    const fileName = `${Date.now()}-${report.kind}-${report.id.slice(0, 8)}.json`
    const filePath = join(dir, fileName)
    writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8')
    pruneCrashReports(dir)
    return filePath
  } catch (error) {
    console.error('CRASH_REPORT_WRITE_FAILED', error)
    return null
  }
}

/**
 * 背景：长时间使用后崩溃报告会累积。
 * 设计意图：按文件名时间排序，只保留最新 20 份。
 * 关键约束：删除失败不影响新报告写入。
 */
function pruneCrashReports(dir: string): void {
  try {
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({ name, time: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
    for (const file of files.slice(MAX_CRASH_REPORTS)) {
      try {
        unlinkSync(join(dir, file.name))
      } catch {
        // 单个文件删除失败不影响其余报告
      }
    }
  } catch (error) {
    console.warn('CRASH_REPORT_PRUNE_FAILED', error)
  }
}

/**
 * 背景：只有覆盖层监听了 render-process-gone，设置页/OCR/录制窗崩溃会静默丢失。
 * 设计意图：在应用级别统一接入所有进程退出、无响应和未捕获异常。
 * 关键约束：只安装一次；致命异常写盘并同步 flush 日志后退出，避免状态不确定继续运行。
 */
export function installCrashHandlers(): void {
  if (installed) return
  installed = true

  process.on('uncaughtException', (error) => {
    const report = buildCrashReport('uncaughtException', error)
    const filePath = writeCrashReport(report)
    addBreadcrumb('crash', 'uncaughtException', { filePath })
    flushDiagnosticsSync()
    console.error('UNCAUGHT_EXCEPTION', error)
    setTimeout(() => app.exit(1), 50)
  })

  process.on('unhandledRejection', (reason) => {
    const report = buildCrashReport('unhandledRejection', reason)
    const filePath = writeCrashReport(report)
    addBreadcrumb('crash', 'unhandledRejection', { filePath })
    flushDiagnosticsSync()
    console.error('UNHANDLED_REJECTION', reason)
  })

  app.on('render-process-gone', (_event, contents, details) => {
    const report = buildCrashReport('render-process-gone', new Error('renderer exited'), {
      rendererId: safeRendererId(contents),
      reason: details.reason,
      exitCode: details.exitCode
    })
    const filePath = writeCrashReport(report)
    addBreadcrumb('crash', 'render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      filePath
    })
    flushDiagnosticsSync()
    console.error('RENDER_PROCESS_GONE', details.reason, details.exitCode)
  })

  app.on('child-process-gone', (_event, details) => {
    const report = buildCrashReport('child-process-gone', new Error('child process exited'), {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode
    })
    const filePath = writeCrashReport(report)
    addBreadcrumb('crash', 'child-process-gone', {
      type: details.type,
      reason: details.reason,
      filePath
    })
    flushDiagnosticsSync()
    console.error('CHILD_PROCESS_GONE', details.type, details.reason)
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.on('unresponsive', () => {
      const report = buildCrashReport('unresponsive', new Error('renderer unresponsive'), {
        rendererId: safeRendererId(contents)
      })
      const filePath = writeCrashReport(report)
      addBreadcrumb('crash', 'renderer unresponsive', {
        rendererId: safeRendererId(contents),
        filePath
      })
      console.error('RENDERER_UNRESPONSIVE', safeRendererId(contents))
    })
    contents.on('responsive', () => {
      addBreadcrumb('crash', 'renderer responsive', {
        rendererId: safeRendererId(contents)
      })
    })
  })
}

function safeAppVersion(): string {
  try {
    return app.getVersion()
  } catch {
    return 'unknown'
  }
}

function safeRendererId(contents: Electron.WebContents): number | null {
  try {
    return contents.id
  } catch {
    return null
  }
}
