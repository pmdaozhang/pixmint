import { registerDiagnosticsIpc } from './diagnostics'
import { registerOcrIpc } from './ocr'
import { registerOverlayIpc } from './overlay'
import { registerPinIpc } from './pin'
import { registerRecorderIpc } from './recorder'
import { registerSettingsIpc } from './settings'
import { registerSystemIpc } from './system'
import type { IpcContext } from './types'

export type { IpcContext } from './types'

/**
 * 背景：原先一个 registerIpc() 里平铺了 40 多个频道，任何新增功能都要改同一个函数。
 * 设计意图：按窗口/领域拆成独立模块，这里只做编排；新增插件时可以平行追加。
 * 关键约束：注册顺序不影响行为（频道名唯一），但同一频道不能注册两次。
 */
export function registerIpc(ctx: IpcContext): void {
  registerOverlayIpc(ctx)
  registerRecorderIpc(ctx)
  registerPinIpc(ctx)
  registerSettingsIpc(ctx)
  registerOcrIpc(ctx)
  registerDiagnosticsIpc(ctx)
  registerSystemIpc(ctx)
}
