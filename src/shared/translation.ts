import type { Settings } from './types'

const TRANSLATION_TIMEOUT_MS = 15_000
// 国内网络访问 Google 免费接口通常直接超时。两个免费接口并行请求，
// 哪个先返回用哪个，避免先等 Google 超时再走 MyMemory。
const FREE_GOOGLE_TIMEOUT_MS = 5_000

export interface TranslationRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body: string
}

export function buildOpenAiTranslationRequest(
  text: string,
  settings: Settings,
  apiKey: string
): TranslationRequest {
  const base = (settings.translationEndpoint || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
  const target = settings.translationTarget === 'en-US' ? 'English' : 'Simplified Chinese'
  return {
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: settings.translationModel || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `Translate the user's text to ${target}. Return only the translation, no explanation.`
        },
        { role: 'user', content: text }
      ]
    })
  }
}

export function buildDeepLTranslationRequest(
  text: string,
  settings: Settings,
  apiKey: string
): TranslationRequest {
  const url =
    settings.translationEndpoint || 'https://api-free.deepl.com/v2/translate'
  const target = settings.translationTarget === 'en-US' ? 'EN-US' : 'ZH'
  return {
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `DeepL-Auth-Key ${apiKey}`
    },
    body: new URLSearchParams({ text, target_lang: target }).toString()
  }
}

export function buildFreeTranslationRequest(
  text: string,
  settings: Settings
): TranslationRequest {
  const target = settings.translationTarget === 'en-US' ? 'en' : 'zh-CN'
  return {
    url: `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`,
    method: 'GET',
    headers: {},
    body: ''
  }
}

export function buildMyMemoryTranslationRequest(
  text: string,
  settings: Settings
): TranslationRequest {
  const target = settings.translationTarget === 'en-US' ? 'en-US' : 'zh-CN'
  const source = target === 'zh-CN' ? 'en' : 'zh-CN'
  return {
    url: `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`,
    method: 'GET',
    headers: {},
    body: ''
  }
}

export function parseOpenAiTranslation(json: unknown): string {
  const value = json as { choices?: Array<{ message?: { content?: string } }> }
  return value.choices?.[0]?.message?.content?.trim() ?? ''
}

export function parseDeepLTranslation(json: unknown): string {
  const value = json as { translations?: Array<{ text?: string }> }
  return value.translations?.[0]?.text?.trim() ?? ''
}

export function parseFreeTranslation(json: unknown): string {
  const value = json as Array<Array<[string]>> | undefined
  if (!Array.isArray(value?.[0])) return ''
  return value[0]
    .map((segment) => (Array.isArray(segment) ? segment[0] : ''))
    .join('')
    .trim()
}

export function parseMyMemoryTranslation(json: unknown): string {
  const value = json as { responseData?: { translatedText?: string } }
  return (value.responseData?.translatedText ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

async function requestTranslation(
  request: TranslationRequest,
  parse: (json: unknown) => string,
  fetchImpl: typeof fetch,
  timeoutMs = TRANSLATION_TIMEOUT_MS
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'POST' ? request.body : undefined,
      signal: controller.signal
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `翻译请求失败 (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`
      )
    }
    const json = (await response.json()) as unknown
    const translated = parse(json)
    if (!translated) throw new Error('翻译服务没有返回译文')
    return translated
  } catch (error) {
    if (controller.signal.aborted) throw new Error('翻译请求超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function translateText(
  text: string,
  settings: Settings,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = TRANSLATION_TIMEOUT_MS
): Promise<string> {
  if (!text.trim()) throw new Error('没有可翻译的文字')
  if (settings.translationProvider === 'none') throw new Error('未配置翻译服务')
  if (settings.translationProvider !== 'free' && !apiKey.trim()) {
    throw new Error('未配置翻译 API Key')
  }
  if (settings.translationProvider === 'free') {
    // 并行请求两个免费接口，取最先成功的那个。Google 在国内经常被墙，
    // 串行会先白等满超时；并行后 MyMemory 通常 1–3 秒就能出结果。
    const attempts = [
      requestTranslation(
        buildFreeTranslationRequest(text, settings),
        parseFreeTranslation,
        fetchImpl,
        Math.min(timeoutMs, FREE_GOOGLE_TIMEOUT_MS)
      ),
      requestTranslation(
        buildMyMemoryTranslationRequest(text, settings),
        parseMyMemoryTranslation,
        fetchImpl,
        timeoutMs
      )
    ]
    try {
      return await Promise.any(attempts)
    } catch (error) {
      // 两个都失败时保留第一个（Google）的错误，便于用户看到真实原因。
      const failures = (error as AggregateError).errors
      throw failures?.[0] ?? error
    }
  }
  const request =
    settings.translationProvider === 'deepl'
      ? buildDeepLTranslationRequest(text, settings, apiKey)
      : buildOpenAiTranslationRequest(text, settings, apiKey)
  return requestTranslation(
    request,
    settings.translationProvider === 'deepl'
      ? parseDeepLTranslation
      : parseOpenAiTranslation,
    fetchImpl,
    timeoutMs
  )
}
