import { app, net } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WordCardEntry } from '../shared/types'

type RawEntry = { p?: string; t?: string[]; pos?: string[] }
type PhoneticCache = { uk?: string; us?: string; at: number }

const CACHE_TTL = 30 * 24 * 60 * 60 * 1000
const WORD_RE = /^[a-z][a-z'-]{1,23}$/

let dictionary: Map<string, RawEntry> | null = null
let phoneticCache: Record<string, PhoneticCache> | null = null

function dictionaryPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'dict', 'ecdict-common.json')
    : join(app.getAppPath(), 'assets', 'dict', 'ecdict-common.json')
}

function cachePath(): string {
  return join(app.getPath('userData'), 'dictionary-cache.json')
}

/**
 * 背景：ECDICT 全量 66MB 不适合随包，构建时已裁成常用 3 万词（约 2.8MB）。
 * 设计意图：首次查询时懒加载进 Map，之后只做内存查找。
 * 关键约束：资源缺失时返回 null，不能影响 OCR/翻译主流程。
 */
function loadDictionary(): Map<string, RawEntry> | null {
  if (dictionary) return dictionary
  try {
    const filePath = dictionaryPath()
    if (!existsSync(filePath)) return null
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, RawEntry>
    dictionary = new Map(Object.entries(raw))
    return dictionary
  } catch (error) {
    console.warn('DICTIONARY_LOAD_FAILED', error)
    return null
  }
}

function loadCache(): Record<string, PhoneticCache> {
  if (phoneticCache) return phoneticCache
  try {
    const filePath = cachePath()
    phoneticCache = existsSync(filePath)
      ? (JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, PhoneticCache>)
      : {}
  } catch {
    phoneticCache = {}
  }
  return phoneticCache
}

function saveCache(): void {
  if (!phoneticCache) return
  try {
    writeFileSync(cachePath(), JSON.stringify(phoneticCache), 'utf8')
  } catch (error) {
    console.warn('DICTIONARY_CACHE_FAILED', error)
  }
}

function parsePhonetics(payload: unknown): { uk?: string; us?: string } {
  const list = Array.isArray(payload) ? payload : []
  let uk = ''
  let us = ''
  let general = ''
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const phonetics = (item as { phonetics?: unknown }).phonetics
    if (!Array.isArray(phonetics)) continue
    for (const entry of phonetics) {
      if (!entry || typeof entry !== 'object') continue
      const text =
        typeof (entry as { text?: unknown }).text === 'string'
          ? ((entry as { text: string }).text || '').trim()
          : ''
      const audio =
        typeof (entry as { audio?: unknown }).audio === 'string'
          ? (entry as { audio: string }).audio
          : ''
      if (!text) continue
      if (!general) general = text
      if (!uk && /-uk\./i.test(audio)) uk = text
      if (!us && /-us\./i.test(audio)) us = text
    }
  }
  return { uk: uk || general || undefined, us: us || general || undefined }
}

async function fetchPhonetics(word: string): Promise<{ uk?: string; us?: string }> {
  const response = await net.fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
    { signal: AbortSignal.timeout(4000) }
  )
  if (!response.ok) throw new Error(`dictionary api ${response.status}`)
  return parsePhonetics(await response.json())
}

export async function lookupDictionary(input: string): Promise<WordCardEntry | null> {
  const word = input.trim().toLowerCase()
  if (!WORD_RE.test(word)) return null
  const dict = loadDictionary()
  const raw = dict?.get(word)
  if (!raw) return null

  const cache = loadCache()
  let phonetics: { uk?: string; us?: string } = {}
  const cached = cache[word]
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    phonetics = { uk: cached.uk, us: cached.us }
  } else {
    try {
      phonetics = await fetchPhonetics(word)
      // 空结果不缓存，避免接口短暂失败后 30 天都拿不到音标。
      if (phonetics.uk || phonetics.us) {
        cache[word] = { ...phonetics, at: Date.now() }
        saveCache()
      }
    } catch {
      // 离线或接口不可用时退回 ECDICT 的单套音标
    }
  }

  return {
    word,
    phonetic: raw.p ?? '',
    uk: phonetics.uk,
    us: phonetics.us,
    pos: (raw.pos ?? []).slice(0, 4),
    meanings: (raw.t ?? [])
      .map((item) => item.replace(/^(n|v|vt|vi|adj|adv|prep|pron|conj|num|art|int|aux|abbr)\.\s*/i, ''))
      .slice(0, 3)
  }
}
