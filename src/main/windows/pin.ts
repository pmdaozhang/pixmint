import { app, BrowserWindow, dialog, Menu, screen } from 'electron'
import { join } from 'node:path'
import { clamp } from '../../shared/geometry'
import type { PinEditLayout, PinInit, Point } from '../../shared/types'
import { clampOpacity, fitPinWindowSize, nextPinSize } from '../pin-state'
import { copyImageBytes, notify, saveImageBytes } from '../image-utils'
import { loadRoute } from './load'

interface PinState {
  window: BrowserWindow
  imageBytes: Uint8Array
  width: number
  height: number
  opacity: number
  dragging: boolean
  normalBounds: Electron.Rectangle | null
}

const SHADOW_PADDING = 20
// 钉图右上角操作条：放在图片上方，不遮挡内容
const ACTION_BAR_HEIGHT = 34
const EDIT_TOOLBAR_HEIGHT = 104
const EDIT_TOOLBAR_WIDTH = 739
const EDIT_GAP = 8

export class PinManager {
  private readonly pins = new Map<number, PinState>()

  constructor(private readonly preloadPath: string) {}

  create(imageBytes: Uint8Array, width: number, height: number, position: Point): BrowserWindow {
    const display = screen.getDisplayNearestPoint(position)
    const workArea = display.workArea
    const size = fitPinWindowSize(
      width,
      height,
      workArea.width,
      workArea.height - ACTION_BAR_HEIGHT,
      SHADOW_PADDING
    )
    const pinWidth = size.width
    const pinHeight = size.height
    const totalWidth = size.totalWidth
    // 窗口比图片多出顶部操作条的高度
    const totalHeight = size.totalHeight + ACTION_BAR_HEIGHT
    const x = clamp(
      position.x - SHADOW_PADDING,
      workArea.x,
      workArea.x + workArea.width - totalWidth
    )
    // 向上多让出操作条，图片仍落在用户框选的位置
    const y = clamp(
      position.y - SHADOW_PADDING - ACTION_BAR_HEIGHT,
      workArea.y,
      workArea.y + workArea.height - totalHeight
    )
    const window = new BrowserWindow({
      x,
      y,
      width: totalWidth,
      height: totalHeight,
      frame: false,
      thickFrame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    const keepOnTop = (): void => {
      if (window.isDestroyed()) return
      window.setAlwaysOnTop(true, 'screen-saver')
      window.moveTop()
    }
    keepOnTop()
    window.on('blur', keepOnTop)
    window.on('show', keepOnTop)
    const id = window.webContents.id
    const state: PinState = {
      window,
      imageBytes,
      width: pinWidth,
      height: pinHeight,
      opacity: 1,
      dragging: false,
      normalBounds: null
    }
    this.pins.set(id, state)
    window.on('closed', () => this.pins.delete(id))
    loadRoute(window, 'pin')
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show()
    })
    return window
  }

  initFor(webContentsId: number): PinInit | null {
    const state = this.pins.get(webContentsId)
    if (!state) return null
    return {
      id: String(webContentsId),
      imageBytes: state.imageBytes,
      width: state.width,
      height: state.height,
      opacity: state.opacity
    }
  }

  /**
   * 背景：钉图文字选择需要识别当前图片，但渲染层不应拿到可修改的主进程状态。
   * 设计意图：返回字节副本给 OCR 调用方，避免识别过程或后续编辑影响钉图原数据。
   * 关键约束：窗口已关闭或 webContents 不匹配时返回 null。
   */
  imageBytesFor(webContentsId: number): Uint8Array | null {
    const state = this.pins.get(webContentsId)
    return state ? new Uint8Array(state.imageBytes) : null
  }

  close(webContentsId: number): void {
    this.pins.get(webContentsId)?.window.close()
  }

  copy(webContentsId: number): void {
    const state = this.pins.get(webContentsId)
    if (!state) return
    copyImageBytes(state.imageBytes)
    notify('贴图已复制到剪贴板')
  }

  async save(webContentsId: number): Promise<string | null> {
    const state = this.pins.get(webContentsId)
    if (!state) return null
    const result = await dialog.showSaveDialog({
      title: '保存贴图',
      defaultPath: join(app.getPath('pictures'), `Pixmint-${stamp()}.png`),
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) return null
    saveImageBytes(state.imageBytes, result.filePath)
    notify('贴图已保存')
    return result.filePath
  }

  setOpacity(webContentsId: number, opacity: number): number {
    const state = this.pins.get(webContentsId)
    if (!state) return 1
    state.opacity = clampOpacity(opacity)
    state.window.setOpacity(state.opacity)
    return state.opacity
  }

  dragStart(webContentsId: number): void {
    const state = this.pins.get(webContentsId)
    if (!state) return
    state.dragging = true
  }

  dragMove(webContentsId: number, dx: number, dy: number): void {
    const state = this.pins.get(webContentsId)
    if (!state?.dragging) return
    const bounds = state.window.getBounds()
    state.window.setPosition(Math.round(bounds.x + dx), Math.round(bounds.y + dy))
  }

  dragEnd(webContentsId: number): void {
    const state = this.pins.get(webContentsId)
    if (state) state.dragging = false
  }

  zoom(webContentsId: number, direction: 1 | -1): { width: number; height: number } {
    const state = this.pins.get(webContentsId)
    if (!state) return { width: 0, height: 0 }
    const bounds = state.window.getBounds()
    const next = nextPinSize(state.width, state.height, direction)
    const centerX = bounds.x + bounds.width / 2
    // 以图片区域中心缩放，顶部操作条不参与，避免图片上下漂移
    const imageCenterY =
      bounds.y + SHADOW_PADDING + ACTION_BAR_HEIGHT + state.height / 2
    const totalWidth = next.width + SHADOW_PADDING * 2
    const totalHeight = next.height + ACTION_BAR_HEIGHT + SHADOW_PADDING * 2
    state.width = next.width
    state.height = next.height
    state.window.setBounds({
      x: Math.round(centerX - totalWidth / 2),
      y: Math.round(
        imageCenterY - SHADOW_PADDING - ACTION_BAR_HEIGHT - next.height / 2
      ),
      width: totalWidth,
      height: totalHeight
    })
    return next
  }

  /**
   * 背景：钉图进入编辑模式后要在图片下方放完整工具栏，原窗口高度不够。
   * 设计意图：进入时向下扩展并在工作区内夹取，退出时恢复原 bounds，避免钉图位置漂移。
   * 关键约束：编辑期间禁用拖拽/缩放；扩展尺寸必须和 PinApp 的布局常量保持一致。
   */
  setEditMode(webContentsId: number, active: boolean): PinEditLayout | null {
    const state = this.pins.get(webContentsId)
    if (!state || state.window.isDestroyed()) return null
    if (active) {
      if (!state.normalBounds) state.normalBounds = state.window.getBounds()
      const bounds = state.window.getBounds()
      const workArea = screen.getDisplayMatching(bounds).workArea
      const width = Math.min(
        workArea.width,
        Math.max(state.width, EDIT_TOOLBAR_WIDTH) + SHADOW_PADDING * 2
      )
      const height = Math.min(
        workArea.height,
        state.height +
          ACTION_BAR_HEIGHT +
          EDIT_TOOLBAR_HEIGHT +
          EDIT_GAP +
          SHADOW_PADDING * 2
      )
      state.window.setBounds({
        x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - width),
        y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - height),
        width,
        height
      })
      return {
        width,
        height,
        imageWidth: state.width,
        imageHeight: state.height,
        toolbarWidth: EDIT_TOOLBAR_WIDTH
      }
    }
    if (state.normalBounds) {
      state.window.setBounds(state.normalBounds)
      state.normalBounds = null
    }
    return {
      width: state.width + SHADOW_PADDING * 2,
      height: state.height + ACTION_BAR_HEIGHT + SHADOW_PADDING * 2,
      imageWidth: state.width,
      imageHeight: state.height,
      toolbarWidth: EDIT_TOOLBAR_WIDTH
    }
  }

  commitEdit(webContentsId: number, imageBytes: Uint8Array): boolean {
    const state = this.pins.get(webContentsId)
    if (!state) return false
    state.imageBytes = imageBytes
    return true
  }

  contextMenu(webContentsId: number): void {
    const state = this.pins.get(webContentsId)
    if (!state) return
    const opacityItems = [1, 0.9, 0.8, 0.7, 0.6, 0.5].map((value) => ({
      label: `${Math.round(value * 100)}%`,
      type: 'radio' as const,
      checked: Math.abs(state.opacity - value) < 0.01,
      click: () => this.setOpacity(webContentsId, value)
    }))
    const menu = Menu.buildFromTemplate([
      {
        label: '不透明度',
        submenu: opacityItems
      },
      { type: 'separator' },
      { label: '复制图像', click: () => this.copy(webContentsId) },
      {
        label: '保存图像',
        click: () => {
          void this.save(webContentsId)
        }
      },
      { label: '关闭贴图', click: () => this.close(webContentsId) }
    ])
    menu.popup({ window: state.window })
  }

  destroyAll(): void {
    for (const state of this.pins.values()) {
      if (!state.window.isDestroyed()) state.window.destroy()
    }
    this.pins.clear()
  }
}

function stamp(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')
}
