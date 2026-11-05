import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { writeJsonAtomic } from '../settings-utils'

/**
 * 本地授权状态。token 是服务端签发的设备绑定凭证，code 是用户可备份的激活码。
 * 加密由外部注入，生产用 Electron safeStorage；单测用明文实现。
 */
export interface LicenseCipher {
  encrypt(text: string): string
  decrypt(text: string): string
}

export const PLAIN_CIPHER: LicenseCipher = {
  encrypt: (text) => `plain:${Buffer.from(text, 'utf8').toString('base64')}`,
  decrypt: (text) => {
    if (!text.startsWith('plain:')) throw new Error('unsupported cipher')
    return Buffer.from(text.slice(6), 'base64').toString('utf8')
  }
}

export interface LicenseRecord {
  version: number
  code: string
  token: string
  email: string
  lastRefreshAt: number
  lastSeenAt: number
  devicesUsed: number
  devicesMax: number
}

const EMPTY: LicenseRecord = {
  version: 1,
  code: '',
  token: '',
  email: '',
  lastRefreshAt: 0,
  lastSeenAt: 0,
  devicesUsed: 0,
  devicesMax: 3
}

export class LicenseStore {
  private cached: LicenseRecord | null = null

  constructor(
    private readonly filePath: string,
    private readonly cipher: LicenseCipher = PLAIN_CIPHER
  ) {}

  get(): LicenseRecord {
    if (!this.cached) this.cached = this.load()
    return this.cached
  }

  save(patch: Partial<LicenseRecord>): LicenseRecord {
    const next: LicenseRecord = { ...this.get(), ...patch, version: 1 }
    this.cached = next
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeJsonAtomic(this.filePath, {
      version: 1,
      data: this.cipher.encrypt(JSON.stringify(next))
    })
    return next
  }

  clear(): void {
    this.cached = { ...EMPTY }
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeJsonAtomic(this.filePath, {
      version: 1,
      data: this.cipher.encrypt(JSON.stringify(this.cached))
    })
  }

  touch(now: number): LicenseRecord {
    return this.save({ lastSeenAt: now })
  }

  private load(): LicenseRecord {
    try {
      if (!existsSync(this.filePath)) return { ...EMPTY }
      const raw = JSON.parse(
        readFileSync(this.filePath, 'utf8').replace(/^﻿/, '')
      ) as {
        data?: unknown
      }
      if (typeof raw.data !== 'string') return { ...EMPTY }
      const parsed = JSON.parse(this.cipher.decrypt(raw.data)) as Partial<LicenseRecord>
      return {
        version: 1,
        code: typeof parsed.code === 'string' ? parsed.code : '',
        token: typeof parsed.token === 'string' ? parsed.token : '',
        email: typeof parsed.email === 'string' ? parsed.email : '',
        lastRefreshAt:
          typeof parsed.lastRefreshAt === 'number' ? parsed.lastRefreshAt : 0,
        lastSeenAt: typeof parsed.lastSeenAt === 'number' ? parsed.lastSeenAt : 0,
        devicesUsed: typeof parsed.devicesUsed === 'number' ? parsed.devicesUsed : 0,
        devicesMax: typeof parsed.devicesMax === 'number' ? parsed.devicesMax : 3
      }
    } catch {
      return { ...EMPTY }
    }
  }
}

/** safeStorage 实现（仅在 Electron 主进程可用）。 */
export function safeStorageCipher(safeStorage: {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}): LicenseCipher {
  return {
    encrypt: (text) => {
      if (!safeStorage.isEncryptionAvailable()) return PLAIN_CIPHER.encrypt(text)
      return `safe:${safeStorage.encryptString(text).toString('base64')}`
    },
    decrypt: (text) => {
      if (text.startsWith('safe:')) {
        return safeStorage.decryptString(Buffer.from(text.slice(5), 'base64'))
      }
      return PLAIN_CIPHER.decrypt(text)
    }
  }
}
