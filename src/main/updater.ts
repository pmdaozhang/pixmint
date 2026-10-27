import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/types'
import {
  isNoPublishedReleaseError,
  mapUpdateError,
  normalizeReleaseNotes
} from '../shared/update'
import { logDiagnostic } from './diagnostics'

const CHECK_DELAY_MS = 15_000

let snapshot: UpdateState = { status: 'idle' }
let initialized = false
let checkTimer: ReturnType<typeof setTimeout> | null = null
let installRequested = false

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send('updater:state', snapshot)
  }
}

function setState(patch: Partial<UpdateState>): UpdateState {
  snapshot = { ...snapshot, ...patch }
  broadcast()
  return snapshot
}

function isBusy(): boolean {
  return (
    snapshot.status === 'checking' ||
    snapshot.status === 'downloading' ||
    snapshot.status === 'verifying' ||
    snapshot.status === 'installing'
  )
}

function rawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 背景：仓库还没有 Release 时，GitHub provider 会抛错；这不是用户网络故障。
 * 设计意图：把这种情况收敛成绿色的“已是最新”，并保留诊断日志。
 * 关键约束：只在检查阶段使用；下载和安装阶段仍按真实错误处理。
 */
function applyCheckFailure(error: unknown): void {
  const raw = rawErrorMessage(error)
  logDiagnostic('updater', `check raw error: ${raw}`, 'error')
  if (isNoPublishedReleaseError(error)) {
    logDiagnostic('updater', 'no published releases; treated as up-to-date')
    setState({
      status: 'up-to-date',
      error: undefined,
      reason: 'no-release',
      checkedAt: new Date().toISOString()
    })
    return
  }
  const message = mapUpdateError(error)
  logDiagnostic('updater', `check failed: ${message}`, 'error')
  setState({ status: 'error', error: message, reason: undefined })
}

export function getUpdateState(): UpdateState {
  return { ...snapshot }
}

/**
 * 背景：手动检查和启动检查可能同时触发，重复请求会放大网络和状态竞争。
 * 设计意图：检查、下载、校验、安装期间直接复用当前快照，不产生并发请求。
 * 关键约束：开发模式和已下载待安装状态不重新检查。
 */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!initialized || snapshot.status === 'disabled') return getUpdateState()
  if (isBusy() || snapshot.status === 'downloaded') return getUpdateState()

  setState({ status: 'checking', error: undefined, reason: undefined })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    applyCheckFailure(error)
  }
  return getUpdateState()
}

/**
 * 背景：更新包体积较大，默认自动下载会占用用户带宽并让状态不可控。
 * 设计意图：只有用户明确点击后才开始下载，下载期间由 electron-updater 校验 SHA-512。
 * 关键约束：只允许从 available 进入，避免重复下载和覆盖已下载结果。
 */
export async function downloadUpdate(): Promise<UpdateState> {
  if (snapshot.status !== 'available') return getUpdateState()

  setState({
    status: 'downloading',
    reason: undefined,
    progress: { percent: 0, transferred: 0, total: snapshot.sizeBytes ?? 0 }
  })
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    logDiagnostic('updater', `download raw error: ${rawErrorMessage(error)}`, 'error')
    const message = mapUpdateError(error)
    logDiagnostic('updater', `download failed: ${message}`, 'error')
    setState({ status: 'error', error: message })
  }
  return getUpdateState()
}

/**
 * 背景：NSIS 安装必须退出当前进程，不能热替换正在运行的文件。
 * 设计意图：先切到 installing 状态并落日志，再交给安装器退出和重启。
 * 关键约束：只有 downloaded 状态允许安装；安装器异常由 error 事件兜底。
 */
export function installUpdate(): void {
  if (snapshot.status !== 'downloaded') return

  installRequested = true
  const version = snapshot.version ?? ''
  setState({ status: 'installing' })
  logDiagnostic('updater', `installing ${version || 'downloaded update'}`)
  setImmediate(() => {
    try {
      // 辅助安装器（oneClick=false）必须显式静默，否则会弹出需要用户点击的 NSIS 向导。
      autoUpdater.quitAndInstall(true, true)
    } catch (error) {
      logDiagnostic('updater', `install raw error: ${rawErrorMessage(error)}`, 'error')
      const message = mapUpdateError(error)
      logDiagnostic('updater', `install failed: ${message}`, 'error')
      setState({ status: 'error', error: message })
    }
  })
}

/**
 * 背景：开发模式没有 app-update.yml，直接检查会产生无意义错误。
 * 设计意图：所有环境都注册 IPC，但只在打包版 Windows 真正启用检查。
 * 关键约束：启动检查延迟 15 秒，避开冷启动和覆盖层预热。
 */
export function initUpdater(): void {
  if (initialized) return
  initialized = true

  ipcMain.handle('updater:get-state', () => getUpdateState())
  ipcMain.handle('updater:check', () => checkForUpdates())
  ipcMain.handle('updater:download', () => downloadUpdate())
  ipcMain.handle('updater:install', () => {
    installUpdate()
  })

  if (!app.isPackaged) {
    setState({ status: 'disabled', error: '开发模式不检查更新' })
    return
  }
  if (process.platform !== 'win32') {
    setState({ status: 'disabled', error: '当前平台暂不支持应用内更新' })
    return
  }

  const feedOverride = process.env.PIXMINT_UPDATE_URL?.trim()
  if (feedOverride) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedOverride })
    logDiagnostic('updater', `using override feed ${feedOverride}`)
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  if (process.env.PIXMINT_DISABLE_DIFFERENTIAL === '1') {
    autoUpdater.disableDifferentialDownload = true
  }
  autoUpdater.logger = {
    info: (message?: unknown, ...optionalParams: unknown[]) => {
      logDiagnostic(
        'updater',
        `[info] ${String(message)} ${optionalParams.map(String).join(' ')}`
      )
    },
    warn: (message?: unknown, ...optionalParams: unknown[]) => {
      logDiagnostic(
        'updater',
        `[warn] ${String(message)} ${optionalParams.map(String).join(' ')}`,
        'warn'
      )
    },
    error: (message?: unknown, ...optionalParams: unknown[]) => {
      logDiagnostic(
        'updater',
        `[error] ${String(message)} ${optionalParams.map(String).join(' ')}`,
        'error'
      )
    },
    debug: () => {}
  }

  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking', error: undefined, reason: undefined })
  })
  autoUpdater.on('update-available', (info) => {
    const size = info.files?.[0]?.size
    setState({
      status: 'available',
      version: info.version,
      sizeBytes: typeof size === 'number' ? size : undefined,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      error: undefined,
      reason: undefined
    })
  })
  autoUpdater.on('update-not-available', () => {
    setState({
      status: 'up-to-date',
      error: undefined,
      reason: undefined,
      checkedAt: new Date().toISOString()
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, progress.percent))
    setState({
      status: percent >= 100 ? 'verifying' : 'downloading',
      progress: {
        percent,
        transferred: progress.transferred,
        total: progress.total
      }
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    setState({
      status: 'downloaded',
      version: info.version,
      error: undefined,
      progress: snapshot.progress
        ? { ...snapshot.progress, percent: 100 }
        : { percent: 100, transferred: 0, total: 0 }
    })
  })
  autoUpdater.on('error', (error) => {
    if (
      snapshot.status === 'downloading' ||
      snapshot.status === 'verifying' ||
      snapshot.status === 'installing'
    ) {
      logDiagnostic('updater', `raw error: ${rawErrorMessage(error)}`, 'error')
      const message = mapUpdateError(error)
      logDiagnostic(
        'updater',
        `${installRequested ? 'install' : 'update'} error: ${message}`,
        'error'
      )
      setState({ status: 'error', error: message, reason: undefined })
      return
    }
    applyCheckFailure(error)
  })

  logDiagnostic('updater', `initialized for ${app.getVersion()}`)
  checkTimer = setTimeout(() => {
    checkTimer = null
    void checkForUpdates()
  }, CHECK_DELAY_MS)
}

export function disposeUpdater(): void {
  if (checkTimer) {
    clearTimeout(checkTimer)
    checkTimer = null
  }
}
