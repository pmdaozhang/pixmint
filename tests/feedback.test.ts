import { describe, expect, it } from 'vitest'
import {
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_MAX_MESSAGE_LENGTH,
  feedbackRetryDelay,
  isValidFeedbackRequestId,
  normalizeFeedbackContent,
  validateFeedbackInput,
  type FeedbackAttachment,
  type FeedbackSubmitInput
} from '../src/shared/feedback'

const requestId = '7d0f2dad-3c55-4a48-8c26-44f26c2631e5'

function attachment(bytes: number): FeedbackAttachment {
  return {
    name: 'shot.png',
    mimeType: 'image/png',
    bytes: new Uint8Array(bytes)
  }
}

function input(overrides: Partial<FeedbackSubmitInput> = {}): FeedbackSubmitInput {
  return {
    content: '托盘菜单偶尔会停留一秒。',
    requestId,
    attachments: [],
    ...overrides
  }
}

describe('feedback validation', () => {
  it('normalizes Windows line endings and trims blank space', () => {
    expect(normalizeFeedbackContent('  first\r\nsecond  ')).toBe('first\nsecond')
  })

  it('accepts a normal submission with a UUID request id', () => {
    const result = validateFeedbackInput(input())
    expect(result.ok).toBe(true)
    expect(result.content).toBe('托盘菜单偶尔会停留一秒。')
  })

  it('rejects empty content', () => {
    expect(validateFeedbackInput(input({ content: '   \r\n ' })).error).toBe('content_required')
  })

  it('rejects non-UUID request ids', () => {
    expect(validateFeedbackInput(input({ requestId: 'retry-me' })).error).toBe(
      'request_id_invalid'
    )
    expect(isValidFeedbackRequestId('7d0f2dad-3c55-4a48-8c26-44f26c2631e5')).toBe(true)
  })

  it('rejects more than ten screenshots', () => {
    const attachments = Array.from({ length: FEEDBACK_MAX_IMAGES + 1 }, () =>
      attachment(1024)
    )
    expect(validateFeedbackInput(input({ attachments })).error).toBe('too_many_images')
  })

  it('rejects content above one thousand characters', () => {
    expect(
      validateFeedbackInput(input({ content: 'a'.repeat(FEEDBACK_MAX_MESSAGE_LENGTH + 1) }))
        .error
    ).toBe('content_too_long')
  })

  it('rejects an image above five megabytes', () => {
    expect(
      validateFeedbackInput(
        input({ attachments: [attachment(FEEDBACK_MAX_IMAGE_BYTES + 1)] })
      ).error
    ).toBe('image_too_large')
  })

  it('rejects unsupported image types', () => {
    const gif = {
      ...attachment(10),
      mimeType: 'image/gif'
    } as unknown as FeedbackAttachment
    expect(validateFeedbackInput(input({ attachments: [gif] })).error).toBe(
      'image_type_unsupported'
    )
  })

  it('accepts the maximum number of small screenshots', () => {
    const attachments = Array.from({ length: FEEDBACK_MAX_IMAGES }, () => attachment(1024))
    expect(validateFeedbackInput(input({ attachments })).ok).toBe(true)
  })
})

describe('feedback retry schedule', () => {
  it('uses two, eight and thirty second retries before the queue revisit interval', () => {
    expect(feedbackRetryDelay(0)).toBe(0)
    expect(feedbackRetryDelay(1)).toBe(2000)
    expect(feedbackRetryDelay(2)).toBe(8000)
    expect(feedbackRetryDelay(3)).toBe(30000)
    expect(feedbackRetryDelay(4)).toBe(5 * 60 * 1000)
  })
})

