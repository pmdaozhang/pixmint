import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import { logDiagnostic } from '../diagnostics'
import { isTrustedAppUrl } from '../security'

/**
 * 背景：所有 IPC 频道此前直接调用 ipcMain.handle/on，参数不做运行时校验，
 * 也不统一校验发送方来源。
 * 设计意图：用一个薄包装统一做"来源可信 + 参数 schema 校验 + 失败可诊断"，
 *          业务模块只关心拿到已经过校验的参数。
 * 关键约束：参数按"调用参数列表"整体校验，schema 一律写成 z.tuple([...])；
 *          校验失败时 handle 抛错、on 记日志后丢弃（send 通道抛错会变成未捕获异常）。
 */

function senderUrl(event: IpcMainEvent | IpcMainInvokeEvent): string {
  try {
    return event.senderFrame?.url ?? event.sender.getURL()
  } catch {
    return ''
  }
}

function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return isTrustedAppUrl(senderUrl(event))
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}

export function handle<S extends z.ZodTypeAny, R>(
  channel: string,
  schema: S,
  handler: (event: IpcMainInvokeEvent, args: z.output<S>) => R | Promise<R>
): void {
  ipcMain.handle(channel, (event, ...raw: unknown[]) => {
    if (!isTrustedSender(event)) {
      logDiagnostic('ipc', `拒绝不可信来源: ${channel}`, 'warn')
      throw new Error(`IPC 来源不可信: ${channel}`)
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      const detail = describeIssues(parsed.error)
      logDiagnostic('ipc', `参数校验失败 ${channel}: ${detail}`, 'warn')
      throw new Error(`IPC 参数校验失败: ${channel}: ${detail}`)
    }
    return handler(event, parsed.data as z.output<S>)
  })
}

export function on<S extends z.ZodTypeAny>(
  channel: string,
  schema: S,
  handler: (event: IpcMainEvent, args: z.output<S>) => void
): void {
  ipcMain.on(channel, (event, ...raw: unknown[]) => {
    if (!isTrustedSender(event)) {
      logDiagnostic('ipc', `拒绝不可信来源: ${channel}`, 'warn')
      return
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      const detail = describeIssues(parsed.error)
      logDiagnostic('ipc', `参数校验失败 ${channel}: ${detail}`, 'warn')
      return
    }
    handler(event, parsed.data as z.output<S>)
  })
}
