import { app, dialog, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  crashReportsDirectory,
  getCrashReportSummary
} from '../crash-report'
import {
  diagnosticsPath,
  ensureDiagnosticsDirectory,
  flushDiagnosticsSync
} from '../diagnostics'
import { writeDiagnosticsExport } from '../diagnostics-export'
import { formatStamp } from '../runtime/format-stamp'
import { safeModeRequested } from '../safe-mode'
import type { IpcContext } from './types'
import { handle } from './validate'

/** 诊断信息、日志/崩溃目录、报告导出。 */
export function registerDiagnosticsIpc(ctx: IpcContext): void {
  handle('diagnostics:info', z.tuple([]), () => {
    const summary = getCrashReportSummary()
    return {
      version: app.getVersion(),
      platform: process.platform,
      logPath: diagnosticsPath(),
      crashReportsDir: crashReportsDirectory(),
      crashReportCount: summary.count,
      latestCrashFile: summary.latestFile,
      latestCrashAt: summary.latestAt,
      safeMode: safeModeRequested()
    }
  })

  handle('diagnostics:open-log-folder', z.tuple([]), () =>
    shell.openPath(ensureDiagnosticsDirectory())
  )

  handle('diagnostics:open-crash-folder', z.tuple([]), () => {
    const dir = crashReportsDirectory()
    mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })

  handle('diagnostics:flush', z.tuple([]), () => {
    flushDiagnosticsSync()
  })

  handle('diagnostics:export-report', z.tuple([]), async () => {
    const result = await dialog.showSaveDialog({
      title: '导出诊断报告',
      defaultPath: join(
        app.getPath('documents'),
        `Pixmint-diagnostics-${formatStamp()}.json`
      ),
      filters: [{ name: 'JSON 诊断报告', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    writeDiagnosticsExport(result.filePath, ctx.settingsStore.get())
    return result.filePath
  })
}
