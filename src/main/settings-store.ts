import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings } from '../shared/types'

export class SettingsStore {
  private readonly filePath: string
  private data: Settings

  constructor() {
    const dir = app.getPath('userData')
    this.filePath = join(dir, 'settings.json')
    this.data = {
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
    if (existsSync(this.filePath)) {
      try {
        this.data = { ...this.data, ...(JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<Settings>) }
      } catch {
        // 坏文件回退默认值，避免应用启动失败
      }
    }
  }

  get(): Settings {
    return { ...this.data }
  }

  update(patch: Partial<Settings>): Settings {
    this.data = { ...this.data, ...patch }
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
    return this.get()
  }
}
