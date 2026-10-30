import { app, net } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { arch, release } from 'node:os'
import { join } from 'node:path'
import {
  FEEDBACK_TOOL,
  FEEDBACK_TYPE,
  feedbackRetryDelay,
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_MESSAGE_LENGTH,
  isValidFeedbackRequestId,
  normalizeFeedbackContent,
  validateFeedbackInput,
  type FeedbackAttachment,
  type FeedbackAttachmentUploadResult,
  type FeedbackQueueFile,
  type FeedbackQueueItem,
  type FeedbackStatusEvent,
  type FeedbackSubmitInput,
  type FeedbackSubmitResult
} from '../shared/feedback'
import { backupCorruptFile, writeJsonAtomic } from './settings-utils'

const DEFAULT_ENDPOINT = 'https://data.hugproducthub.top/api/v1/feedback'
const QUEUE_SCHEMA_VERSION = 1
const TEXT_TIMEOUT_MS = 15_000
const ATTACHMENT_TIMEOUT_MS = 20_000

interface FeedbackServiceOptions {
  onStatus?: (event: FeedbackStatusEvent) => void
}

interface TextAttempt {
  ok: boolean
  retryable: boolean
  id?: string
  error?: string
}

function feedbackEndpoint(): string {
  return (process.env.PIXMINT_FEEDBACK_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, '')
}

function attachmentEndpoint(feedbackId: string): string {
  return `${feedbackEndpoint()}/${encodeURIComponent(feedbackId)}/attachments`
}

function queuePath(): string {
  return (
    process.env.PIXMINT_FEEDBACK_QUEUE_PATH ||
    join(app.getPath('userData'), 'feedback-queue.json')
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function textOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeQueueItem(value: unknown): FeedbackQueueItem | null {
  const source = asRecord(value)
  if (!source) return null
  const requestId = textOr(source.requestId)
  const content = normalizeFeedbackContent(textOr(source.content))
  if (!isValidFeedbackRequestId(requestId) || !content) return null
  if (content.length > FEEDBACK_MAX_MESSAGE_LENGTH) return null
  return {
    requestId,
    type: textOr(source.type, FEEDBACK_TYPE),
    content,
    version: textOr(source.version, app.getVersion()),
    platform: textOr(source.platform, process.platform),
    osVersion: textOr(source.osVersion, release()),
    arch: textOr(source.arch, arch()),
    createdAt: numberOr(source.createdAt, Date.now()),
    attempts: Math.max(0, Math.floor(numberOr(source.attempts, 0))),
    nextAttemptAt: numberOr(source.nextAttemptAt, 0),
    lastError: textOr(source.lastError) || undefined
  }
}

async function parseResponseBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return asRecord(await response.json())
  } catch {
    return null
  }
}

function responseError(body: Record<string, unknown> | null, status: number): string {
  const error = body && typeof body.error === 'string' ? body.error : ''
  return error || `http_${status}`
}

/**
 * 背景：反馈可能发生在断网或后台维护时，不能要求用户一直停留在窗口里等待。
 * 设计意图：首次失败立即返回可理解状态，后续由主进程队列按 2s/8s/30s 自动补发。
 * 关键约束：队列只持久化文字和环境信息；截图只在本次进程内存中等待上传。
 */
export class FeedbackService {
  private queue: FeedbackQueueItem[] = []
  private readonly pendingAttachments = new Map<string, FeedbackAttachment[]>()
  private retryTimer: NodeJS.Timeout | null = null
  private flushing = false

  constructor(private readonly options: FeedbackServiceOptions = {}) {
    this.queue = this.loadQueue()
  }

  start(): void {
    void this.flushDue()
  }

  dispose(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.pendingAttachments.clear()
  }

  async submit(input: FeedbackSubmitInput): Promise<FeedbackSubmitResult> {
    const validation = validateFeedbackInput(input)
    if (!validation.ok) {
      return {
        status: 'rejected',
        requestId: input.requestId,
        error: validation.error || 'invalid_feedback'
      }
    }

    if (input.attachments.length > 0) {
      this.pendingAttachments.set(input.requestId, input.attachments)
    }

    const existing = this.queue.find((item) => item.requestId === input.requestId)
    if (existing) {
      void this.flushDue()
      return { status: 'queued', requestId: input.requestId }
    }

    const item = this.createQueueItem(input.requestId, validation.content)
    const attempt = await this.sendText(item)
    if (attempt.ok) {
      const attachments = await this.uploadPendingAttachments(item.requestId, attempt.id)
      return {
        status: 'sent',
        requestId: input.requestId,
        id: attempt.id,
        attachments
      }
    }

    if (attempt.retryable) {
      item.attempts = 1
      item.lastError = attempt.error
      item.nextAttemptAt = Date.now() + feedbackRetryDelay(item.attempts)
      this.queue.push(item)
      this.persistQueue()
      this.scheduleNextFlush()
      return {
        status: 'queued',
        requestId: input.requestId,
        error: attempt.error
      }
    }

    this.pendingAttachments.delete(input.requestId)
    return {
      status: 'rejected',
      requestId: input.requestId,
      error: attempt.error || 'submit_failed'
    }
  }

  private createQueueItem(requestId: string, content: string): FeedbackQueueItem {
    return {
      requestId,
      type: FEEDBACK_TYPE,
      content,
      version: app.getVersion(),
      platform: process.platform,
      osVersion: release(),
      arch: arch(),
      createdAt: Date.now(),
      attempts: 0,
      nextAttemptAt: 0
    }
  }

  private async flushDue(): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    try {
      const now = Date.now()
      const due = this.queue.filter((item) => item.nextAttemptAt <= now)
      for (const item of due) {
        const attempt = await this.sendText(item)
        if (attempt.ok) {
          this.queue = this.queue.filter((entry) => entry.requestId !== item.requestId)
          this.persistQueue()
          const attachments = await this.uploadPendingAttachments(item.requestId, attempt.id)
          this.options.onStatus?.({
            requestId: item.requestId,
            status: 'sent',
            id: attempt.id,
            attachments
          })
          continue
        }

        if (attempt.retryable) {
          item.attempts += 1
          item.lastError = attempt.error
          item.nextAttemptAt = Date.now() + feedbackRetryDelay(item.attempts)
          this.persistQueue()
          continue
        }

        this.queue = this.queue.filter((entry) => entry.requestId !== item.requestId)
        this.pendingAttachments.delete(item.requestId)
        this.persistQueue()
        this.options.onStatus?.({
          requestId: item.requestId,
          status: 'failed',
          error: attempt.error || 'submit_failed'
        })
      }
      this.scheduleNextFlush()
    } finally {
      this.flushing = false
    }
  }

  private scheduleNextFlush(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.queue.length === 0) return
    const nextAt = Math.min(...this.queue.map((item) => item.nextAttemptAt || Date.now()))
    const delay = Math.max(50, nextAt - Date.now() + 30)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.flushDue()
    }, delay)
  }

  private async sendText(item: FeedbackQueueItem): Promise<TextAttempt> {
    try {
      const response = await net.fetch(feedbackEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: FEEDBACK_TOOL,
          type: item.type,
          content: item.content,
          version: item.version,
          request_id: item.requestId,
          platform: item.platform,
          os_version: item.osVersion,
          arch: item.arch
        }),
        signal: AbortSignal.timeout(TEXT_TIMEOUT_MS)
      })
      const body = await parseResponseBody(response)
      if (response.ok) {
        const id = body && typeof body.id === 'string' ? body.id : ''
        return { ok: true, retryable: false, id }
      }
      const status = response.status
      return {
        ok: false,
        retryable: status === 408 || status === 429 || status >= 500,
        error: responseError(body, status)
      }
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        error: error instanceof Error ? error.message : 'network_error'
      }
    }
  }

  private async uploadPendingAttachments(
    requestId: string,
    feedbackId?: string
  ): Promise<FeedbackAttachmentUploadResult | undefined> {
    const attachments = this.pendingAttachments.get(requestId)
    if (!attachments || attachments.length === 0) return undefined
    this.pendingAttachments.delete(requestId)

    if (!feedbackId) {
      return {
        uploaded: 0,
        failed: attachments.length,
        error: 'missing_feedback_id'
      }
    }

    let uploaded = 0
    let failed = 0
    let lastError = ''
    for (const attachment of attachments) {
      if (attachment.bytes.byteLength > FEEDBACK_MAX_IMAGE_BYTES) {
        failed += 1
        lastError = 'image_too_large'
        continue
      }
      try {
        const buffer = new ArrayBuffer(attachment.bytes.byteLength)
        new Uint8Array(buffer).set(attachment.bytes)
        const form = new FormData()
        form.append('request_id', requestId)
        form.append(
          'file',
          new Blob([buffer], { type: attachment.mimeType }),
          attachment.name
        )
        const response = await net.fetch(attachmentEndpoint(feedbackId), {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(ATTACHMENT_TIMEOUT_MS)
        })
        if (response.ok) {
          uploaded += 1
        } else {
          failed += 1
          lastError = responseError(await parseResponseBody(response), response.status)
        }
      } catch (error) {
        failed += 1
        lastError = error instanceof Error ? error.message : 'attachment_network_error'
      }
    }

    return {
      uploaded,
      failed,
      error: lastError || undefined
    }
  }

  private loadQueue(): FeedbackQueueItem[] {
    const filePath = queuePath()
    if (!existsSync(filePath)) return []
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
      const record = asRecord(parsed)
      const rawItems = Array.isArray(parsed)
        ? parsed
        : record && Array.isArray(record.items)
          ? record.items
          : []
      return rawItems
        .map(normalizeQueueItem)
        .filter((item): item is FeedbackQueueItem => Boolean(item))
    } catch (error) {
      const backup = backupCorruptFile(filePath)
      console.warn(
        'FEEDBACK_QUEUE_LOAD_FAILED',
        error,
        backup ? `backup=${backup}` : 'backup unavailable'
      )
      return []
    }
  }

  private persistQueue(): void {
    try {
      const payload: FeedbackQueueFile = {
        schemaVersion: QUEUE_SCHEMA_VERSION,
        items: this.queue
      }
      writeJsonAtomic(queuePath(), payload)
    } catch (error) {
      console.warn('FEEDBACK_QUEUE_WRITE_FAILED', error)
    }
  }
}

