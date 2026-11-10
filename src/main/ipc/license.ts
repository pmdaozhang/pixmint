import { z } from 'zod'
import type { PaymentProvider } from '../../shared/license'
import type { IpcContext } from './types'
import { handle, on } from './validate'

const codeSchema = z.string().trim().min(4).max(4096)
const emailSchema = z.string().trim().email().max(200)
const deviceHashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const planSchema = z.enum(['monthly', 'yearly', 'lifetime'])
const providerSchema = z.enum(['alipay', 'wechat'])

/** 授权、购买订单与邀请试用。 */
export function registerLicenseIpc(ctx: IpcContext): void {
  const license = ctx.licenseService

  handle('license:status', z.tuple([]), () => license.status())
  handle('license:activate', z.tuple([codeSchema]), (_event, [code]) => license.activate(code))
  handle('license:restore', z.tuple([]), () => license.restoreByDevice())
  handle('license:refresh', z.tuple([]), () => license.refresh())
  handle('license:email', z.tuple([emailSchema]), (_event, [email]) =>
    license.emailCode(email)
  )
  handle('license:devices', z.tuple([]), () => license.devices())
  handle('license:unbind', z.tuple([deviceHashSchema]), (_event, [deviceHash]) =>
    license.unbind(deviceHash)
  )
  handle('license:trial', z.tuple([z.string().trim().min(4).max(32)]), (_event, [code]) =>
    license.trial(code)
  )

  handle(
    'purchase:create-order',
    z.tuple([planSchema, providerSchema]),
    (_event, [plan, provider]) => license.createOrder(plan, provider as PaymentProvider)
  )
  handle(
    'purchase:create-manual-order',
    z.tuple([planSchema, providerSchema, emailSchema]),
    (_event, [plan, provider, email]) =>
      license.createManualOrder(plan, provider as PaymentProvider, email)
  )
  handle(
    'purchase:submit-manual-order',
    z.tuple([z.string().min(1).max(120), z.string().min(1).max(200)]),
    (_event, [orderId, orderToken]) => license.submitManualOrder(orderId, orderToken)
  )
  handle(
    'purchase:manual-order-status',
    z.tuple([z.string().min(1).max(120), z.string().min(1).max(200)]),
    (_event, [orderId, orderToken]) => license.manualOrderStatus(orderId, orderToken)
  )
  handle(
    'purchase:order-status',
    z.tuple([z.string().min(1).max(120), z.string().min(1).max(200)]),
    (_event, [orderId, orderToken]) => license.orderStatus(orderId, orderToken)
  )
  on(
    'purchase:open',
    z.tuple([z.enum(['ocr', 'translate', 'gif', 'video']).optional()]),
    (_event, [feature]) => ctx.openPurchaseWindow(feature)
  )
}
