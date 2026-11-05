import { readFileSync } from 'node:fs'

/**
 * 仅用于 --smoke-overlay 的假屏幕，避免依赖系统屏幕捕获权限。
 * 设置 PIXMINT_FAKE_SCREEN 指向一张 PNG 时，可替换为真实文档截图，
 * 供宣传素材录制使用；未设置时仍使用内置渐变图。
 */
const DEFAULT_FAKE_SCREEN_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAASCAIAAAC1qksFAAAAUklEQVR4nO2U0QnAQAhDX/TGuu/O1PHLKS5Q6k8RRKJIJATVvm5DjiJb4iitmkr8bmZhggwr8CVeeCM7R4E3shMLGtkpBeMB4wFzB5pfxI9/0QPdpASQ4E1zpwAAAABJRU5ErkJggg=='

function loadFakeScreen(): string {
  const file = process.env.PIXMINT_FAKE_SCREEN?.trim()
  if (!file) return DEFAULT_FAKE_SCREEN_PNG
  try {
    return `data:image/png;base64,${readFileSync(file).toString('base64')}`
  } catch {
    return DEFAULT_FAKE_SCREEN_PNG
  }
}

export const FAKE_SCREEN_PNG = loadFakeScreen()
