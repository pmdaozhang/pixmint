import { describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  backupCorruptFile,
  normalizeSettings,
  writeJsonAtomic
} from '../src/main/settings-utils'

describe('settings utils', () => {
  it('normalizes invalid values and drops unknown fields', () => {
    const result = normalizeSettings({
      shortcut: '   ',
      theme: 'neon',
      language: 'fr',
      launchAtLogin: 'yes',
      onboardingCompleted: true,
      translationProvider: 'unknown',
      translationEndpoint: 'javascript:alert(1)',
      translationModel: '   ',
      translationTarget: 'en-US',
      unknown: 'ignored'
    })
    expect(result.shortcut).toBe(DEFAULT_SETTINGS.shortcut)
    expect(result.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(result.language).toBe(DEFAULT_SETTINGS.language)
    expect(result.launchAtLogin).toBe(false)
    expect(result.onboardingCompleted).toBe(true)
    expect(result.translationProvider).toBe(DEFAULT_SETTINGS.translationProvider)
    expect(result.translationEndpoint).toBe(DEFAULT_SETTINGS.translationEndpoint)
    expect(result.translationModel).toBe(DEFAULT_SETTINGS.translationModel)
    expect(result.translationTarget).toBe('en-US')
    expect('unknown' in result).toBe(false)
  })

  it('preserves valid settings and stamps the schema version', () => {
    const result = normalizeSettings({
      shortcut: 'CommandOrControl+Shift+A',
      theme: 'dark',
      language: 'en-US',
      launchAtLogin: true,
      onboardingCompleted: true,
      translationProvider: 'deepl',
      translationEndpoint: 'https://api-free.deepl.com/v2/translate',
      translationModel: 'custom-model',
      translationTarget: 'zh-CN'
    })
    expect(result.schemaVersion).toBe(1)
    expect(result.shortcut).toBe('CommandOrControl+Shift+A')
    expect(result.theme).toBe('dark')
    expect(result.language).toBe('en-US')
    expect(result.translationProvider).toBe('deepl')
  })

  it('writes JSON atomically without leaving a temp file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixmint-settings-'))
    const filePath = join(dir, 'settings.json')
    try {
      writeJsonAtomic(filePath, { value: 1 })
      writeJsonAtomic(filePath, { value: 2 })
      expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ value: 2 })
      expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('backs up a corrupt settings file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixmint-corrupt-'))
    const filePath = join(dir, 'settings.json')
    try {
      writeFileSync(filePath, '{broken', 'utf8')
      const backup = backupCorruptFile(filePath)
      expect(backup).not.toBeNull()
      expect(existsSync(backup as string)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
