import { app } from 'electron'
import { writeFileSync } from 'node:fs'
import { release } from 'node:os'
import { getBreadcrumbs } from './breadcrumbs'
import { getCrashReportSummary, readRecentCrashReports } from './crash-report'
import {
  diagnosticsPath,
  readRecentDiagnosticLogs
} from './diagnostics'
import { getMetricsSamples } from './metrics'
import { safeModeRequested } from './safe-mode'
import type { Settings } from '../shared/types'

export interface DiagnosticsExportPayload {
  generatedAt: string
  appVersion: string
  platform: string
  arch: string
  osVersion: string
  safeMode: boolean
  logPath: string
  memory: NodeJS.MemoryUsage
  settings: {
    shortcut: string
    theme: Settings['theme']
    language: Settings['language']
    translationProvider: Settings['translationProvider']
    onboardingCompleted: boolean
  }
  breadcrumbs: ReturnType<typeof getBreadcrumbs>
  metrics: ReturnType<typeof getMetricsSamples>
  crashSummary: ReturnType<typeof getCrashReportSummary>
  crashReports: ReturnType<typeof readRecentCrashReports>
  logs: ReturnType<typeof readRecentDiagnosticLogs>
}

/**
 * 背景：用户遇到问题时，让他自己找日志和崩溃 JSON 成本太高。
 * 设计意图：把定位所需信息汇总成一个 JSON 文件，方便直接发送。
 * 关键约束：不包含截图、OCR 文字、剪贴板、文件路径中的用户名和密钥；日志导出前再次脱敏。
 */
export function buildDiagnosticsExport(settings: Settings): DiagnosticsExportPayload {
  return {
    generatedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    osVersion: release(),
    safeMode: safeModeRequested(),
    logPath: diagnosticsPath(),
    memory: process.memoryUsage(),
    settings: {
      shortcut: settings.shortcut,
      theme: settings.theme,
      language: settings.language,
      translationProvider: settings.translationProvider,
      onboardingCompleted: settings.onboardingCompleted
    },
    breadcrumbs: getBreadcrumbs(),
    metrics: getMetricsSamples(),
    crashSummary: getCrashReportSummary(),
    crashReports: readRecentCrashReports(5),
    logs: readRecentDiagnosticLogs()
  }
}

export function writeDiagnosticsExport(filePath: string, settings: Settings): void {
  writeFileSync(filePath, JSON.stringify(buildDiagnosticsExport(settings), null, 2), 'utf8')
}
