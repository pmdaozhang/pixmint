import { describe, expect, it } from 'vitest'
import { trayIconDataUrl, type TrayDownloadFrame } from '../src/main/tray-icon'

function pngSize(dataUrl: string): { width: number; height: number } {
  const base64 = dataUrl.split(',')[1]
  const bytes = Buffer.from(base64, 'base64')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('托盘图标帧', () => {
  it('普通帧和下载帧都是 32×32，且下载两帧互不相同', () => {
    const normal = trayIconDataUrl(true)
    const first = trayIconDataUrl(true, 0)
    const second = trayIconDataUrl(true, 1)

    for (const url of [normal, first, second]) {
      expect(pngSize(url)).toEqual({ width: 32, height: 32 })
    }
    expect(first).not.toBe(normal)
    expect(first).not.toBe(second)
  })

  it('浅色和深色任务栏使用各自的帧', () => {
    const dark: TrayDownloadFrame = 0
    expect(trayIconDataUrl(true, dark)).not.toBe(trayIconDataUrl(false, dark))
    expect(trayIconDataUrl(true)).not.toBe(trayIconDataUrl(false))
  })
})
