import type { UpdateState } from './types'

export type UpdateActionKind = 'check' | 'download' | 'install' | 'none'
export type UpdateTone = 'neutral' | 'ok' | 'new' | 'error'
export type UpdateNoteTone = 'neutral' | 'error'

export interface UpdateView {
  title: string
  description: string
  actionLabel: string
  actionKind: UpdateActionKind
  actionVariant: 'secondary' | 'primary'
  actionDisabled: boolean
  showBadge: boolean
  tone: UpdateTone
  showProgress: boolean
  progressPercent: number
  progressLabel: string
  note: string
  noteTone: UpdateNoteTone
}

/**
 * 背景：安装包和下载进度来自不同阶段，单位不统一会让用户难以判断剩余量。
 * 设计意图：统一使用十进制 KB/MB/GB，和 Windows 安装包体积展示保持一致。
 * 关键约束：非法值按 0 处理，避免 UI 出现 NaN。
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

/**
 * 背景：electron-updater 的 releaseNotes 既可能是字符串，也可能是分段数组。
 * 设计意图：只保留用户可读的纯文本摘要，限制长度，避免把 HTML 直接渲染进设置页。
 * 关键约束：不解析 HTML，不拼接外部链接。
 */
export function normalizeReleaseNotes(notes: unknown): string | undefined {
  if (typeof notes === 'string') {
    const trimmed = notes.trim()
    return trimmed ? trimmed.slice(0, 500) : undefined
  }
  if (Array.isArray(notes)) {
    const text = notes
      .map((item) => {
        if (item && typeof item === 'object' && 'note' in item) {
          const note = (item as { note?: unknown }).note
          return typeof note === 'string' ? note : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
    return text ? text.slice(0, 500) : undefined
  }
  return undefined
}

/**
 * 背景：GitHub 仓库一个 Release 都没有时，electron-updater 会抛错而不是返回空版本。
 * 设计意图：把这个“还没有发布记录”的环境状态和真正的网络/校验失败区分开。
 * 关键约束：只匹配明确的 no published versions 文案，不吞掉其他错误。
 */
export function isNoPublishedReleaseError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    message.includes('no published versions on github') ||
    message.includes('no published versions') ||
    message.includes('no published release')
  )
}

/**
 * 背景：electron-updater 的错误语义混在英文 message 里，直接给用户看没有可操作性。
 * 设计意图：按常见网络、404、校验、磁盘和安装失败归类成中文提示。
 * 关键约束：未知错误保留原始信息，便于诊断，不吞掉细节。
 */
export function mapUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (isNoPublishedReleaseError(error)) {
    return '更新源暂无发布版本'
  }
  if (
    lower.includes('404') ||
    lower.includes('latest.yml') ||
    lower.includes('not found') ||
    lower.includes('cannot find channel')
  ) {
    return '更新源不可用，请稍后重试'
  }
  if (
    lower.includes('sha512') ||
    lower.includes('checksum') ||
    lower.includes('checksum mismatch')
  ) {
    return '安装包校验失败，已阻止安装'
  }
  if (
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('econnreset') ||
    lower.includes('network') ||
    lower.includes('net::')
  ) {
    return '检查更新失败：无法连接更新源'
  }
  if (lower.includes('enospc') || lower.includes('no space')) {
    return '磁盘空间不足，无法下载更新'
  }
  if (
    lower.includes('enoent') ||
    lower.includes('install') ||
    lower.includes('installer')
  ) {
    return '安装失败，请手动下载最新版本'
  }
  return `检查更新失败：${message}`
}

/**
 * 背景：设置页需要把主进程状态稳定映射成文案和按钮，不能在 JSX 里散落 if/else。
 * 设计意图：单一纯函数输出完整视图模型，渲染层只负责绑定事件。
 * 关键约束：不读取全局状态；同一输入必须得到同一输出，便于单测和回归。
 */
export function describeUpdate(state: UpdateState, currentVersion: string): UpdateView {
  const version = state.version ?? ''
  const title = currentVersion ? `Pixmint v${currentVersion}` : 'Pixmint'
  const base = {
    title,
    showBadge: false,
    tone: 'neutral' as UpdateTone,
    showProgress: false,
    progressPercent: 0,
    progressLabel: '',
    noteTone: 'neutral' as UpdateNoteTone
  }

  switch (state.status) {
    case 'checking':
      return {
        ...base,
        description: '正在检查更新…',
        actionLabel: '检查中…',
        actionKind: 'none',
        actionVariant: 'secondary',
        actionDisabled: true,
        note: '正在连接更新源，通常不超过 15 秒'
      }
    case 'up-to-date':
      return {
        ...base,
        description: '已是最新版本',
        actionLabel: '再次检查',
        actionKind: 'check',
        actionVariant: 'secondary',
        actionDisabled: false,
        tone: 'ok',
        note:
          state.reason === 'no-release'
            ? '更新源暂无发布记录 · 发布新版本后会自动检测'
            : '更新源 GitHub Releases · 已检查最新版本'
      }
    case 'available':
      return {
        ...base,
        description: `发现新版本 ${version}`,
        actionLabel: '下载更新',
        actionKind: 'download',
        actionVariant: 'primary',
        actionDisabled: false,
        showBadge: true,
        tone: 'new',
        note: state.sizeBytes
          ? `安装包约 ${formatBytes(state.sizeBytes)} · 下载完成后会校验 SHA-512`
          : '下载完成后会校验 SHA-512'
      }
    case 'downloading': {
      const progress = state.progress ?? { percent: 0, transferred: 0, total: 0 }
      return {
        ...base,
        description: `正在下载 ${version}`,
        actionLabel: '下载中…',
        actionKind: 'none',
        actionVariant: 'secondary',
        actionDisabled: true,
        tone: 'new',
        showProgress: true,
        progressPercent: progress.percent,
        progressLabel:
          progress.total > 0
            ? `正在下载 ${version} · ${formatBytes(progress.transferred)} / ${formatBytes(progress.total)}`
            : `正在下载 ${version}`,
        note: '下载在后台进行，可以继续使用截图和 OCR'
      }
    }
    case 'verifying':
      return {
        ...base,
        description: '正在校验安装包…',
        actionLabel: '校验中…',
        actionKind: 'none',
        actionVariant: 'secondary',
        actionDisabled: true,
        tone: 'new',
        showProgress: true,
        progressPercent: 100,
        progressLabel: '安装包已下载 · 正在校验 SHA-512',
        note: '校验失败会阻止安装并提示重试'
      }
    case 'downloaded':
      return {
        ...base,
        description: `${version} 已下载并校验完成，重启后安装`,
        actionLabel: '重启并安装',
        actionKind: 'install',
        actionVariant: 'primary',
        actionDisabled: false,
        tone: 'ok',
        showProgress: true,
        progressPercent: 100,
        progressLabel: '安装包已校验',
        note: '重启会关闭当前窗口，安装完成后自动重新启动 Pixmint'
      }
    case 'installing':
      return {
        ...base,
        description: `正在安装 ${version}，应用即将重启…`,
        actionLabel: '安装中…',
        actionKind: 'none',
        actionVariant: 'secondary',
        actionDisabled: true,
        tone: 'new',
        showProgress: true,
        progressPercent: 100,
        progressLabel: '正在替换程序文件',
        note: '请不要手动关闭进程，安装完成后会自动启动'
      }
    case 'error':
      return {
        ...base,
        description: state.error ?? '检查更新失败',
        actionLabel: '重试',
        actionKind: 'check',
        actionVariant: 'secondary',
        actionDisabled: false,
        tone: 'error',
        showProgress: Boolean(state.progress),
        progressPercent: state.progress?.percent ?? 0,
        progressLabel: state.progress
          ? `已下载 ${formatBytes(state.progress.transferred)}`
          : '',
        note: '已写入诊断日志，可稍后重试',
        noteTone: 'error'
      }
    case 'disabled':
      return {
        ...base,
        description: state.error ?? '当前环境不检查更新',
        actionLabel: '检查更新',
        actionKind: 'none',
        actionVariant: 'secondary',
        actionDisabled: true,
        note: '更新功能仅在打包版 Windows 中启用'
      }
    case 'idle':
    default:
      return {
        ...base,
        description: '检查更新，获取最新功能与修复',
        actionLabel: '检查更新',
        actionKind: 'check',
        actionVariant: 'secondary',
        actionDisabled: false,
        note: '更新源 GitHub Releases · 下载后校验 SHA-512 · 重启后完成安装'
      }
  }
}
