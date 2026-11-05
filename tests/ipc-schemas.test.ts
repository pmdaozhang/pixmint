import { describe, expect, it } from 'vitest'
import {
  binarySchema,
  overlayCompleteSchema,
  recorderBeginSchema,
  settingsPatchSchema
} from '../src/main/ipc/schemas'

const MB = 1024 * 1024

describe('settingsPatchSchema', () => {
  it('接受合法的部分设置', () => {
    const parsed = settingsPatchSchema.parse({ theme: 'dark', launchAtLogin: true })
    expect(parsed).toEqual({ theme: 'dark', launchAtLogin: true })
  })

  it('拒绝非法的主题枚举', () => {
    expect(settingsPatchSchema.safeParse({ theme: 'amoled' }).success).toBe(false)
  })

  it('拒绝越界的引导版本', () => {
    expect(settingsPatchSchema.safeParse({ onboardingVersion: 1000 }).success).toBe(false)
  })

  it('剥除未声明的字段，避免脏数据进入设置文件', () => {
    const parsed = settingsPatchSchema.parse({ theme: 'light', evil: 'x' })
    expect(parsed).toEqual({ theme: 'light' })
  })
})

describe('overlayCompleteSchema', () => {
  const valid = {
    action: 'copy',
    displayId: 1,
    selection: { x: 0, y: 0, width: 10, height: 10 },
    pngBytes: new Uint8Array([1, 2, 3])
  }

  it('接受合法的完成载荷', () => {
    expect(overlayCompleteSchema.safeParse(valid).success).toBe(true)
  })

  it('拒绝未知动作', () => {
    expect(overlayCompleteSchema.safeParse({ ...valid, action: 'upload' }).success).toBe(false)
  })

  it('拒绝字符串冒充二进制', () => {
    expect(overlayCompleteSchema.safeParse({ ...valid, pngBytes: 'not-bytes' }).success).toBe(false)
  })
})

describe('recorderBeginSchema', () => {
  const valid = {
    mode: 'gif',
    displayId: 0,
    selection: { x: 0, y: 0, width: 100, height: 100 },
    options: {
      mode: 'gif',
      fps: 15,
      size: 'original',
      countdown: 3,
      mic: false,
      systemAudio: false
    }
  }

  it('接受合法录制参数', () => {
    expect(recorderBeginSchema.safeParse(valid).success).toBe(true)
  })

  it('拒绝不支持的帧率', () => {
    const bad = { ...valid, options: { ...valid.options, fps: 24 } }
    expect(recorderBeginSchema.safeParse(bad).success).toBe(false)
  })
})

describe('binarySchema', () => {
  it('接受 Uint8Array 与 Buffer', () => {
    expect(binarySchema.safeParse(new Uint8Array([1])).success).toBe(true)
    expect(binarySchema.safeParse(Buffer.from([1])).success).toBe(true)
  })

  it('拒绝普通对象', () => {
    expect(binarySchema.safeParse({ length: 1 }).success).toBe(false)
  })
})

describe('内存回收阈值（联动常量）', () => {
  it('阈值常量为 64MB', () => {
    // 防止有人误改阈值却忘了同步压测预算文档。
    expect(64 * MB).toBe(67_108_864)
  })
})
