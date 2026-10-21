import { describe, expect, it } from 'vitest'
import { lookupWord, normalizeDictionaryWord } from '../src/shared/dictionary'

describe('built-in dictionary', () => {
  it('normalizes punctuation and case', () => {
    expect(normalizeDictionaryWord(' Hello! ')).toBe('hello')
  })

  it('looks up a known English word', () => {
    const entry = lookupWord('hello')
    expect(entry?.phonetic).toBeTruthy()
    expect(entry?.definitions.length).toBeGreaterThan(0)
  })

  it('looks up a known Chinese word', () => {
    expect(lookupWord('你好')?.definitions.length).toBeGreaterThan(0)
  })

  it('returns null for unknown words instead of fabricating definitions', () => {
    expect(lookupWord('zzzzunknown')).toBeNull()
  })
})
