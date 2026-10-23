import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import type { Language, Settings, ThemeSetting } from '../shared/types'

export const SETTINGS_SCHEMA_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  shortcut: 'F1',
  theme: 'system',
  language: 'zh-CN',
  launchAtLogin: false,
  onboardingCompleted: false,
  translationProvider: 'free',
  translationEndpoint: 'https://api.openai.com/v1',
  translationModel: 'gpt-4o-mini',
  translationTarget: 'zh-CN'
}

const THEMES: ThemeSetting[] = ['system', 'dark', 'light']
const LANGUAGES: Language[] = ['zh-CN', 'en-US']
const PROVIDERS: Settings['translationProvider'][] = ['none', 'free', 'openai', 'deepl']
const TARGETS: Settings['translationTarget'][] = ['zh-CN', 'en-US']

/**
 * 背景：设置文件来自用户机器，可能是旧版本、手工修改或崩溃时写坏的内容。
 * 设计意图：只接受白名单字段和合法类型，未知字段直接丢弃，避免脏数据进入业务层。
 * 关键约束：任何非法值都回退默认值，不能让应用因设置损坏而启动失败。
 */
export function normalizeSettings(input: unknown): Settings {
  const source = isRecord(input) ? input : {}
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    shortcut: stringOr(source.shortcut, DEFAULT_SETTINGS.shortcut, 64),
    theme: enumOr(source.theme, THEMES, DEFAULT_SETTINGS.theme),
    language: enumOr(source.language, LANGUAGES, DEFAULT_SETTINGS.language),
    launchAtLogin: booleanOr(source.launchAtLogin, DEFAULT_SETTINGS.launchAtLogin),
    onboardingCompleted: booleanOr(
      source.onboardingCompleted,
      DEFAULT_SETTINGS.onboardingCompleted
    ),
    translationProvider: enumOr(
      source.translationProvider,
      PROVIDERS,
      DEFAULT_SETTINGS.translationProvider
    ),
    translationEndpoint: urlOr(
      source.translationEndpoint,
      DEFAULT_SETTINGS.translationEndpoint
    ),
    translationModel: stringOr(
      source.translationModel,
      DEFAULT_SETTINGS.translationModel,
      120
    ),
    translationTarget: enumOr(
      source.translationTarget,
      TARGETS,
      DEFAULT_SETTINGS.translationTarget
    )
  }
}

/**
 * 背景：直接 writeFileSync 覆盖设置文件时，进程崩溃可能留下半截 JSON。
 * 设计意图：先写同目录临时文件，再 rename 替换；Windows 拒绝覆盖时保留 .bak 再替换。
 * 关键约束：写入失败会抛出给调用方，不能假装保存成功。
 */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8')
  try {
    renameSync(tempPath, filePath)
  } catch (error) {
    try {
      if (existsSync(filePath)) copyFileSync(filePath, `${filePath}.bak`)
      if (existsSync(filePath)) unlinkSync(filePath)
      renameSync(tempPath, filePath)
    } catch (retryError) {
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath)
      } catch {
        // 临时文件清理失败不应掩盖原始写入错误
      }
      throw retryError instanceof Error ? retryError : error
    }
  }
}

/**
 * 背景：设置损坏时需要保留现场，方便用户恢复或开发者定位。
 * 设计意图：复制为带时间戳的 .corrupt- 文件，不覆盖原始内容。
 * 关键约束：备份失败返回 null，不能阻断应用使用默认设置启动。
 */
export function backupCorruptFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  const backupPath = `${filePath}.corrupt-${Date.now()}.json`
  try {
    copyFileSync(filePath, backupPath)
    return backupPath
  } catch (error) {
    console.warn('SETTINGS_BACKUP_FAILED', error)
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.slice(0, maxLength)
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function urlOr(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed)) return fallback
  return trimmed.slice(0, 500)
}
