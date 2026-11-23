import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const { showSaveDialog, saveImageBytes } = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  saveImageBytes: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => 'C:/Users/test/Pictures' },
  dialog: { showSaveDialog },
  screen: {}
}))

vi.mock('../src/main/image-utils', () => ({
  imageFromBytes: () => ({ isEmpty: () => false }),
  copyImageBytes: vi.fn(),
  notify: vi.fn(),
  saveImageBytes
}))

vi.mock('../src/main/breadcrumbs', () => ({ addBreadcrumb: vi.fn() }))
vi.mock('../src/main/diagnostics', () => ({ logDiagnostic: vi.fn() }))

import { handleOverlayComplete, type CaptureDeps } from '../src/main/services/capture-service'

function makeDeps(): CaptureDeps {
  return {
    settingsStore: { get: () => ({ language: 'zh-CN' }) }
  } as unknown as CaptureDeps
}

const payload = {
  action: 'save' as const,
  displayId: 1,
  selection: { x: 0, y: 0, width: 10, height: 10 },
  pngBytes: new Uint8Array([137, 80, 78, 71]),
  autoTranslate: false
}

const capture = {
  displayId: 1,
  bounds: { x: 0, y: 0, width: 10, height: 10 },
  scaleFactor: 1,
  imageWidth: 10,
  imageHeight: 10
} as never

const fakeWindow = {} as unknown as BrowserWindow

describe('handleOverlayComplete save', () => {
  beforeEach(() => {
    showSaveDialog.mockReset()
    saveImageBytes.mockReset()
  })

  it('全屏等场景有父窗口时，以覆盖层窗口为 owner 弹出保存对话框', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:/out.png' })

    await handleOverlayComplete(makeDeps(), payload, capture, fakeWindow)

    expect(showSaveDialog).toHaveBeenCalledTimes(1)
    expect(showSaveDialog.mock.calls[0][0]).toBe(fakeWindow)
    expect(showSaveDialog.mock.calls[0][1]).toMatchObject({
      title: '保存截图',
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    })
    expect(saveImageBytes).toHaveBeenCalledWith(payload.pngBytes, 'C:/out.png')
  })

  it('没有父窗口时退回无 owner 的对话框（普通窗口路径不变）', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true })

    await handleOverlayComplete(makeDeps(), payload, capture)

    expect(showSaveDialog).toHaveBeenCalledTimes(1)
    // 单参调用：第一个参数就是选项对象
    expect(showSaveDialog.mock.calls[0]).toHaveLength(1)
    expect(saveImageBytes).not.toHaveBeenCalled()
  })

  it('取消保存时不写文件', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })

    await handleOverlayComplete(makeDeps(), payload, capture, fakeWindow)

    expect(saveImageBytes).not.toHaveBeenCalled()
  })
})
