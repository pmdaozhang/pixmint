import { z } from 'zod'

/**
 * 背景：渲染层传来的 IPC 参数此前只有编译期类型，运行时完全不校验，
 * 与 ARCHITECTURE.md 第 5 条"IPC 参数必须经过运行时校验"相悖。
 * 设计意图：为每个频道声明一份 schema，集中在本文件，注册器统一执行。
 * 关键约束：二进制载荷用 range/类型双重校验；未知字段由 zod 默认剥除，
 *          不让渲染层塞进设置里没有定义的内容。
 */

const finiteNumber = z.number().finite()
const byteLength = z.number().int().nonnegative()

export const rectSchema = z.object({
  x: finiteNumber,
  y: finiteNumber,
  width: finiteNumber,
  height: finiteNumber
})

/** Electron structured clone 可能把 Uint8Array 还原成 Buffer，两者都放行。 */
export const binarySchema = z.custom<Uint8Array>(
  (value) => value instanceof Uint8Array || ArrayBuffer.isView(value),
  { message: '需要二进制字节数据' }
)

export const arrayBufferSchema = z.custom<ArrayBuffer>(
  (value) => value instanceof ArrayBuffer,
  { message: '需要 ArrayBuffer' }
)

export const overlayCompleteSchema = z.object({
  action: z.enum(['copy', 'save', 'pin', 'ocr']),
  displayId: z.number().int(),
  selection: rectSchema,
  pngBytes: binarySchema,
  autoTranslate: z.boolean().optional()
})

export const settingsPatchSchema = z.object({
  schemaVersion: z.number().int().optional(),
  shortcut: z.string().max(64).optional(),
  theme: z.enum(['system', 'dark', 'light']).optional(),
  language: z.enum(['zh-CN', 'en-US']).optional(),
  launchAtLogin: z.boolean().optional(),
  onboardingCompleted: z.boolean().optional(),
  onboardingVersion: z.number().int().min(0).max(99).optional(),
  skippedUpdateVersion: z.string().max(32).optional(),
  translationProvider: z.enum(['none', 'free', 'openai', 'deepl']).optional(),
  translationEndpoint: z.string().max(500).optional(),
  translationModel: z.string().max(120).optional(),
  translationTarget: z.enum(['zh-CN', 'en-US']).optional(),
  hasTranslationKey: z.unknown().optional()
})

const recorderModeSchema = z.enum(['gif', 'video'])

export const recorderBeginSchema = z.object({
  mode: recorderModeSchema,
  displayId: z.number().int(),
  selection: rectSchema,
  options: z.object({
    mode: recorderModeSchema,
    fps: z.union([z.literal(10), z.literal(15), z.literal(30)]),
    size: z.enum(['original', '1080', '720', '480']),
    countdown: z.union([z.literal(3), z.literal(1), z.literal(0)]),
    mic: z.boolean(),
    systemAudio: z.boolean()
  })
})

export const recorderStatePatchSchema = z.object({
  phase: z
    .enum(['preparing', 'countdown', 'recording', 'paused', 'encoding', 'result'])
    .optional(),
  elapsedMs: z.number().nonnegative().optional(),
  message: z.string().optional(),
  mic: z.boolean().optional(),
  systemAudio: z.boolean().optional(),
  width: byteLength.optional(),
  height: byteLength.optional()
})

export const gifDoneMetaSchema = z.object({
  width: byteLength,
  height: byteLength,
  fps: z.number().positive(),
  durationMs: z.number().nonnegative(),
  frameCount: byteLength,
  firstFrameDataUrl: z.string().optional()
})

export const videoDoneMetaSchema = z.object({
  mimeType: z.string().min(1),
  extension: z.string().min(1),
  width: byteLength,
  height: byteLength,
  fps: z.number().positive(),
  durationMs: z.number().nonnegative(),
  mic: z.boolean(),
  systemAudio: z.boolean(),
  hasAudio: z.boolean(),
  note: z.string().optional()
})

export const recorderControlCommandSchema = z.object({
  type: z.enum(['stop', 'cancel', 'pause', 'resume'])
})

export const feedbackSubmitSchema = z.object({
  content: z.string(),
  requestId: z.string(),
  attachments: z.array(
    z.object({
      name: z.string(),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      bytes: binarySchema
    })
  )
})

export type SettingsPatch = z.output<typeof settingsPatchSchema>
