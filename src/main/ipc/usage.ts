import { z } from 'zod'
import type { IpcContext } from './types'
import { handle } from './validate'

/** 免费额度查询，供购买窗和设置页展示。 */
export function registerUsageIpc(ctx: IpcContext): void {
  handle('usage:get', z.tuple([]), () => ctx.usageService.view())
}
