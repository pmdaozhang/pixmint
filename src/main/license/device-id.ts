import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * 设备标识只用于授权绑定，不上传原始硬件信息。
 * 优先读取系统 MachineGuid / IOPlatformUUID / machine-id，失败时退化为随机 UUID，
 * 并持久化到 userData/device.json，保证同一台机器重装应用后仍可恢复（除非用户删除数据）。
 */
export function readMachineId(): string | null {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync(
        'reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8', windowsHide: true }
      )
      const match = output.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/)
      return match?.[1] ?? null
    }
    if (process.platform === 'darwin') {
      const output = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
        encoding: 'utf8'
      })
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
      return match?.[1] ?? null
    }
    if (existsSync('/etc/machine-id')) {
      return readFileSync('/etc/machine-id', 'utf8').trim() || null
    }
  } catch {
    return null
  }
  return null
}

export function hashDeviceId(machineId: string): string {
  return createHash('sha256').update(`pixmint-v1:${machineId}`).digest('hex')
}

interface DeviceFile {
  version: number
  machineId?: string
  deviceId: string
}

export class DeviceIdStore {
  private cached: string | null = null

  constructor(private readonly filePath: string) {}

  get(): string {
    if (this.cached) return this.cached
    const stored = this.load()
    if (stored) {
      this.cached = stored
      return stored
    }
    const machineId = readMachineId()
    const deviceId = machineId ? hashDeviceId(machineId) : hashDeviceId(randomUUID())
    this.save({ version: 1, machineId: machineId ?? undefined, deviceId })
    this.cached = deviceId
    return deviceId
  }

  private load(): string | null {
    try {
      if (!existsSync(this.filePath)) return null
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<DeviceFile>
      if (typeof parsed.deviceId === 'string' && /^[0-9a-f]{64}$/.test(parsed.deviceId)) {
        return parsed.deviceId
      }
    } catch {
      // 文件损坏时重新生成
    }
    return null
  }

  private save(file: DeviceFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf8')
  }
}
