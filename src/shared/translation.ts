import type { Settings } from './types'

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
  fetchImpl: typeof fetch
): Promise<string> {
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.method === 'POST' ? request.body : undefined
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`翻译请求失败 (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }
  const json = (await response.json()) as unknown
  const translated = parse(json)
  if (!translated) throw new Error('翻译服务没有返回译文')
  return translated
}

export async function translateText(
  text: string,
  settings: Settings,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (!text.trim()) throw new Error('没有可翻译的文字')
  if (settings.translationProvider === 'none') throw new Error('未配置翻译服务')
  if (settings.translationProvider !== 'free' && !apiKey.trim()) {
    throw new Error('未配置翻译 API Key')
  }
  if (settings.translationProvider === 'free') {
    try {
      return await requestTranslation(
        buildFreeTranslationRequest(text, settings),
        parseFreeTranslation,
        fetchImpl
      )
    } catch (firstError) {
      try {
        return await requestTranslation(
          buildMyMemoryTranslationRequest(text, settings),
          parseMyMemoryTranslation,
          fetchImpl
        )
      } catch {
        throw firstError
      }
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
    fetchImpl
  )
}
