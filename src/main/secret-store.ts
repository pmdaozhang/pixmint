import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface SecretData {
  translationKey?: string
}

export class SecretStore {
  private readonly filePath: string
  private data: SecretData = {}

  constructor() {
    this.filePath = join(app.getPath('userData'), 'secrets.json')
    if (existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(readFileSync(this.filePath, 'utf8')) as SecretData
      } catch {
        this.data = {}
      }
    }
  }

  hasTranslationKey(): boolean {
    return Boolean(this.data.translationKey)
  }

  setTranslationKey(key: string): boolean {
    if (!key.trim()) {
      this.data.translationKey = undefined
      this.persist()
      return false
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用，无法保存 API Key')
    }
    this.data.translationKey = safeStorage.encryptString(key.trim()).toString('base64')
    this.persist()
    return true
  }

  getTranslationKey(): string | null {
    if (!this.data.translationKey) return null
    try {
      return safeStorage.decryptString(Buffer.from(this.data.translationKey, 'base64'))
    } catch {
      return null
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
  }
}
