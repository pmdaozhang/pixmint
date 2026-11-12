import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageStore } from '../src/main/usage-store'
import { UsageService } from '../src/main/services/usage-service'
import type { LicenseService } from '../src/main/license/service'

const dirs: string[] = []
const AT = new Date('2026-11-05T10:00:00').getTime()

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pixmint-usage-'))
  dirs.push(dir)
  return join(dir, 'usage.json')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('UsageStore', () => {
  it('落盘后重新读取保持计数', () => {
    const file = tempFile()
    const store = new UsageStore(file, () => AT, { ocr: 2 })
    expect(store.consume('ocr').allowed).toBe(true)
    expect(store.consume('ocr').allowed).toBe(true)
    expect(store.consume('ocr').allowed).toBe(false)
    const reloaded = new UsageStore(file, () => AT, { ocr: 2 })
    expect(reloaded.snapshot().used.ocr).toBe(2)
    expect(reloaded.snapshot().remaining.ocr).toBe(0)
  })

  it('损坏 JSON 回退为空并保留 .bak', () => {
    const file = tempFile()
    writeFileSync(file, '{not json', 'utf8')
    const store = new UsageStore(file, () => AT)
    expect(store.snapshot().used.ocr).toBe(0)
  })

  it('第二天自动归零', () => {
    const file = tempFile()
    const first = new UsageStore(file, () => AT, { gif: 1 })
    expect(first.consume('gif').allowed).toBe(true)
    const nextDay = new UsageStore(file, () => AT + 86_400_000, { gif: 1 })
    expect(nextDay.snapshot().used.gif).toBe(0)
    expect(nextDay.consume('gif').allowed).toBe(true)
  })
})

describe('UsageService', () => {
  it('Pro 用户不计数且无限', () => {
    const store = new UsageStore(tempFile(), () => AT, { video: 0 })
    const license = { isPro: () => true } as unknown as LicenseService
    const service = new UsageService({ store, license, now: () => AT })
    const result = service.consume('video')
    expect(result.allowed).toBe(true)
    expect(store.snapshot().used.video).toBe(0)
  })

  it('开发版无限次数且不写计数', () => {
    const store = new UsageStore(tempFile(), () => AT, { video: 0 })
    const license = { isPro: () => false } as unknown as LicenseService
    const service = new UsageService({
      store,
      license,
      now: () => AT,
      devUnlimited: true
    })
    expect(service.consume('video').allowed).toBe(true)
    expect(store.snapshot().used.video).toBe(0)
    expect(service.view().unlimited).toBe(true)
  })

  it('超限触发一次购买窗回调', () => {
    const store = new UsageStore(tempFile(), () => AT, { video: 0 })
    const license = { isPro: () => false } as unknown as LicenseService
    let opened = 0
    const service = new UsageService({
      store,
      license,
      now: () => AT,
      onExceeded: () => {
        opened += 1
      }
    })
    expect(service.consume('video').allowed).toBe(false)
    service.consume('video')
    expect(opened).toBe(2)
  })
})
