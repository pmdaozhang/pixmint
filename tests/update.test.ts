import { describe, expect, it } from 'vitest'
import {
  describeUpdate,
  formatBytes,
  mapUpdateError,
  normalizeReleaseNotes
} from '../src/shared/update'
import type { UpdateState } from '../src/shared/types'

describe('formatBytes', () => {
  it('formats zero and small byte counts', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
  })

  it('formats decimal KB and MB', () => {
    expect(formatBytes(1000)).toBe('1.0 KB')
    expect(formatBytes(1500)).toBe('1.5 KB')
    expect(formatBytes(119059768)).toBe('119 MB')
  })
})

describe('normalizeReleaseNotes', () => {
  it('keeps a plain string and trims it', () => {
    expect(normalizeReleaseNotes('  fix: ocr  \n')).toBe('fix: ocr')
  })

  it('joins release note arrays', () => {
    expect(
      normalizeReleaseNotes([{ note: '修复 A' }, { note: '修复 B' }])
    ).toBe('修复 A\n修复 B')
  })

  it('returns undefined for empty input', () => {
    expect(normalizeReleaseNotes(null)).toBeUndefined()
    expect(normalizeReleaseNotes([])).toBeUndefined()
  })
})

describe('mapUpdateError', () => {
  it('maps missing channel to source unavailable', () => {
    expect(mapUpdateError(new Error('Cannot find latest.yml in the latest release'))).toBe(
      '更新源不可用，请稍后重试'
    )
  })

  it('maps checksum failure', () => {
    expect(mapUpdateError(new Error('sha512 checksum mismatch'))).toBe(
      '安装包校验失败，已阻止安装'
    )
  })

  it('maps network failures', () => {
    expect(mapUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(
      '检查更新失败：无法连接更新源'
    )
    expect(mapUpdateError(new Error('getaddrinfo ENOTFOUND github.com'))).toBe(
      '检查更新失败：无法连接更新源'
    )
  })

  it('maps disk and install failures', () => {
    expect(mapUpdateError(new Error('ENOSPC: no space left'))).toBe(
      '磁盘空间不足，无法下载更新'
    )
    expect(mapUpdateError(new Error('installer exited with code 1'))).toBe(
      '安装失败，请手动下载最新版本'
    )
  })

  it('keeps unknown errors readable', () => {
    expect(mapUpdateError(new Error('unexpected state'))).toBe(
      '检查更新失败：unexpected state'
    )
  })
})

describe('describeUpdate', () => {
  const state = (patch: Partial<UpdateState>): UpdateState => ({
    status: 'idle',
    ...patch
  })

  it('renders idle as a check action', () => {
    const view = describeUpdate(state({ status: 'idle' }), '0.4.0')
    expect(view.title).toBe('Pixmint v0.4.0')
    expect(view.description).toBe('检查更新，获取最新功能与修复')
    expect(view.actionLabel).toBe('检查更新')
    expect(view.actionKind).toBe('check')
    expect(view.actionDisabled).toBe(false)
  })

  it('disables the action while checking', () => {
    const view = describeUpdate(state({ status: 'checking' }), '0.4.0')
    expect(view.actionDisabled).toBe(true)
    expect(view.actionKind).toBe('none')
    expect(view.description).toBe('正在检查更新…')
  })

  it('shows an up-to-date state in green tone', () => {
    const view = describeUpdate(state({ status: 'up-to-date' }), '0.4.0')
    expect(view.description).toBe('已是最新版本')
    expect(view.tone).toBe('ok')
    expect(view.actionLabel).toBe('再次检查')
  })

  it('shows the new version and download action', () => {
    const view = describeUpdate(
      state({ status: 'available', version: '0.4.1', sizeBytes: 119059768 }),
      '0.4.0'
    )
    expect(view.description).toBe('发现新版本 0.4.1')
    expect(view.showBadge).toBe(true)
    expect(view.actionKind).toBe('download')
    expect(view.actionVariant).toBe('primary')
    expect(view.note).toContain('119 MB')
  })

  it('renders download progress with transferred and total', () => {
    const view = describeUpdate(
      state({
        status: 'downloading',
        version: '0.4.1',
        progress: { percent: 42, transferred: 50000000, total: 119059768 }
      }),
      '0.4.0'
    )
    expect(view.showProgress).toBe(true)
    expect(view.progressPercent).toBe(42)
    expect(view.progressLabel).toBe('正在下载 0.4.1 · 50.0 MB / 119 MB')
    expect(view.actionDisabled).toBe(true)
  })

  it('renders verification and downloaded states', () => {
    const verifying = describeUpdate(state({ status: 'verifying', version: '0.4.1' }), '0.4.0')
    expect(verifying.progressPercent).toBe(100)
    expect(verifying.actionDisabled).toBe(true)

    const downloaded = describeUpdate(
      state({ status: 'downloaded', version: '0.4.1' }),
      '0.4.0'
    )
    expect(downloaded.description).toContain('重启后安装')
    expect(downloaded.actionKind).toBe('install')
    expect(downloaded.actionLabel).toBe('重启并安装')
  })

  it('renders install progress', () => {
    const view = describeUpdate(state({ status: 'installing', version: '0.4.1' }), '0.4.0')
    expect(view.description).toContain('正在安装 0.4.1')
    expect(view.actionDisabled).toBe(true)
    expect(view.progressPercent).toBe(100)
  })

  it('renders errors with retry action', () => {
    const view = describeUpdate(
      state({ status: 'error', error: '检查更新失败：无法连接更新源' }),
      '0.4.0'
    )
    expect(view.description).toBe('检查更新失败：无法连接更新源')
    expect(view.actionLabel).toBe('重试')
    expect(view.noteTone).toBe('error')
    expect(view.tone).toBe('error')
  })

  it('disables updates outside packaged Windows', () => {
    const view = describeUpdate(
      state({ status: 'disabled', error: '开发模式不检查更新' }),
      '0.4.0'
    )
    expect(view.actionDisabled).toBe(true)
    expect(view.actionKind).toBe('none')
    expect(view.description).toBe('开发模式不检查更新')
  })
})
