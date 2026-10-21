import { describe, expect, it, vi } from 'vitest'
import {
  buildDeepLTranslationRequest,
  buildFreeTranslationRequest,
  buildMyMemoryTranslationRequest,
  buildOpenAiTranslationRequest,
  parseDeepLTranslation,
  parseFreeTranslation,
  parseMyMemoryTranslation,
  parseOpenAiTranslation,
  translateText
} from '../src/shared/translation'
import type { Settings } from '../src/shared/types'

const settings: Settings = {
  shortcut: 'F1',
  theme: 'system',
  language: 'zh-CN',
  launchAtLogin: false,
  onboardingCompleted: true,
  translationProvider: 'openai',
  translationEndpoint: 'https://api.example.com/v1',
  translationModel: 'test-model',
  translationTarget: 'zh-CN'
}

describe('translation requests', () => {
  it('builds an OpenAI-compatible request', () => {
    const request = buildOpenAiTranslationRequest('Hello', settings, 'secret')
    expect(request.url).toBe('https://api.example.com/v1/chat/completions')
    expect(request.headers.Authorization).toBe('Bearer secret')
    const body = JSON.parse(request.body) as { model: string }
    expect(body.model).toBe('test-model')
  })

  it('builds a DeepL request', () => {
    const request = buildDeepLTranslationRequest(
      'Hello',
      { ...settings, translationProvider: 'deepl', translationEndpoint: '' },
      'deepl-key'
    )
    expect(request.url).toContain('deepl')
    expect(request.body).toContain('target_lang=ZH')
    expect(request.headers.Authorization).toBe('DeepL-Auth-Key deepl-key')
  })

  it('builds a free Google request without a key', () => {
    const request = buildFreeTranslationRequest('Hello', {
      ...settings,
      translationProvider: 'free'
    })
    expect(request.method).toBe('GET')
    expect(request.url).toContain('translate.googleapis.com')
    expect(request.url).toContain('tl=zh-CN')
  })

  it('builds a MyMemory fallback request', () => {
    const request = buildMyMemoryTranslationRequest('Hello', {
      ...settings,
      translationProvider: 'free'
    })
    expect(request.url).toContain('mymemory.translated.net')
    expect(request.url).toContain('langpair=en|zh-CN')
  })

  it('parses provider responses', () => {
    expect(
      parseOpenAiTranslation({ choices: [{ message: { content: '你好' } }] })
    ).toBe('你好')
    expect(parseDeepLTranslation({ translations: [{ text: '你好' }] })).toBe('你好')
    expect(parseFreeTranslation([[['你好', 'Hello']]])).toBe('你好')
    expect(parseMyMemoryTranslation({ responseData: { translatedText: '你好' } })).toBe('你好')
  })
})

describe('translateText', () => {
  it('returns the translated text', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '你好' } }] })
      }) as Response
    )
    await expect(translateText('Hello', settings, 'secret', fetchMock)).resolves.toBe('你好')
  })

  it('uses the free provider without an API key', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        json: async () => [[['你好', 'Hello']]]
      }) as Response
    )
    await expect(
      translateText(
        'Hello',
        { ...settings, translationProvider: 'free' },
        '',
        fetchMock
      )
    ).resolves.toBe('你好')
  })

  it('falls back to MyMemory when the free Google endpoint fails', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('network blocked')
      return {
        ok: true,
        json: async () => ({ responseData: { translatedText: '你好' } })
      } as Response
    })
    await expect(
      translateText(
        'Hello',
        { ...settings, translationProvider: 'free' },
        '',
        fetchMock
      )
    ).resolves.toBe('你好')
    expect(calls).toBe(2)
  })

  it('rejects without an API key', async () => {
    await expect(translateText('Hello', settings, '')).rejects.toThrow('API Key')
  })

  it('rejects when the provider returns an error', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: false,
        status: 401,
        text: async () => 'unauthorized'
      }) as Response
    )
    await expect(translateText('Hello', settings, 'bad', fetchMock)).rejects.toThrow('401')
  })
})
