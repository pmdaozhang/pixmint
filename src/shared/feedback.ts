/**
 * 背景：反馈窗口、主进程队列和后台契约共用一套输入约束，避免 UI 能提交、
 * 主进程却拒绝，或客户端与后台对上限理解不一致。
 * 关键约束：截图只允许在内存中流转；附件单张上限 5MB，最多 10 张。
 */
export const FEEDBACK_TOOL = 'pixmint'
export const FEEDBACK_TYPE = 'other'
export const FEEDBACK_MAX_MESSAGE_LENGTH = 1000
export const FEEDBACK_MAX_IMAGES = 10
export const FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const FEEDBACK_MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024
export const FEEDBACK_RETRY_DELAYS_MS = [2_000, 8_000, 30_000] as const
export const FEEDBACK_QUEUE_REVISIT_MS = 5 * 60 * 1000
export const FEEDBACK_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type FeedbackImageMimeType = (typeof FEEDBACK_IMAGE_MIME_TYPES)[number]

export interface FeedbackAttachment {
  name: string
  mimeType: FeedbackImageMimeType
  bytes: Uint8Array
}

export interface FeedbackSubmitInput {
  content: string
  requestId: string
  attachments: FeedbackAttachment[]
}

export interface FeedbackAttachmentUploadResult {
  uploaded: number
  failed: number
  error?: string
}

export interface FeedbackSubmitResult {
  status: 'sent' | 'queued' | 'rejected'
  requestId: string
  id?: string
  error?: string
  attachments?: FeedbackAttachmentUploadResult
}

export interface FeedbackStatusEvent {
  requestId: string
  status: 'sent' | 'failed'
  id?: string
  error?: string
  attachments?: FeedbackAttachmentUploadResult
}

export interface FeedbackQueueItem {
  requestId: string
  type: string
  content: string
  version: string
  platform: string
  osVersion: string
  arch: string
  createdAt: number
  attempts: number
  nextAttemptAt: number
  lastError?: string
}

export interface FeedbackQueueFile {
  schemaVersion: 1
  items: FeedbackQueueItem[]
}

export interface FeedbackValidationResult {
  ok: boolean
  content: string
  error?: string
}

const REQUEST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidFeedbackRequestId(value: string): boolean {
  return REQUEST_ID_RE.test(value)
}

export function normalizeFeedbackContent(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

export function validateFeedbackInput(input: FeedbackSubmitInput): FeedbackValidationResult {
  const content = normalizeFeedbackContent(input.content)
  if (!content) return { ok: false, content, error: 'content_required' }
  if (content.length > FEEDBACK_MAX_MESSAGE_LENGTH) {
    return { ok: false, content, error: 'content_too_long' }
  }
  if (!isValidFeedbackRequestId(input.requestId)) {
    return { ok: false, content, error: 'request_id_invalid' }
  }
  if (input.attachments.length > FEEDBACK_MAX_IMAGES) {
    return { ok: false, content, error: 'too_many_images' }
  }

  let totalBytes = 0
  for (const attachment of input.attachments) {
    if (!FEEDBACK_IMAGE_MIME_TYPES.includes(attachment.mimeType)) {
      return { ok: false, content, error: 'image_type_unsupported' }
    }
    if (attachment.bytes.byteLength === 0) {
      return { ok: false, content, error: 'image_empty' }
    }
    if (attachment.bytes.byteLength > FEEDBACK_MAX_IMAGE_BYTES) {
      return { ok: false, content, error: 'image_too_large' }
    }
    totalBytes += attachment.bytes.byteLength
    if (totalBytes > FEEDBACK_MAX_TOTAL_ATTACHMENT_BYTES) {
      return { ok: false, content, error: 'attachments_too_large' }
    }
  }

  return { ok: true, content }
}

/**
 * 首次失败后等待 2 秒，第二次 8 秒，第三次 30 秒；之后留在本地队列，
 * 每 5 分钟再尝试，避免后台持续故障时高频请求。
 */
export function feedbackRetryDelay(attempts: number): number {
  if (attempts <= 0) return 0
  return FEEDBACK_RETRY_DELAYS_MS[attempts - 1] ?? FEEDBACK_QUEUE_REVISIT_MS
}

