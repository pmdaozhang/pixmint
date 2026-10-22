import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings } from '../shared/types'
import {
  DEFAULT_SETTINGS,
  backupCorruptFile,
  normalizeSettings,
  writeJsonAtomic
} from './settings-utils'

export class SettingsStore {
  private readonly filePath: string
  private data: Settings

  constructor() {
    const dir = app.getPath('userData')
    this.filePath = join(dir, 'settings.json')
    this.data = { ...DEFAULT_SETTINGS }
    if (existsSync(this.filePath)) {
      try {
        this.data = normalizeSettings(JSON.parse(readFileSync(this.filePath, 'utf8')))
      } catch (error) {
        const backupPath = backupCorruptFile(this.filePath)
        console.warn(
          'SETTINGS_LOAD_FAILED',
          error,
          backupPath ? `backup=${backupPath}` : 'backup unavailable'
        )
        this.data = { ...DEFAULT_SETTINGS }
        try {
          writeJsonAtomic(this.filePath, this.data)
        } catch (writeError) {
          console.warn('SETTINGS_REBUILD_FAILED', writeError)
        }
      }
    }
  }

  get(): Settings {
    return { ...this.data }
  }

  update(patch: Partial<Settings>): Settings {
    const next = normalizeSettings({ ...this.data, ...patch })
    writeJsonAtomic(this.filePath, next)
    this.data = next
    return this.get()
  }
}
