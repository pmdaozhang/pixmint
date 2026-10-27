import { describe, expect, it } from 'vitest'
import {
  pushBreadcrumb,
  sanitizeDiagnosticData,
  sanitizeDiagnosticText,
  type Breadcrumb
} from '../src/shared/diagnostics'

describe('diagnostics utils', () => {
  it('redacts Windows user paths and credentials', () => {
    const result = sanitizeDiagnosticText(
      'C:\\Users\\alice\\AppData\\Roaming\\pixmint\\settings.json Bearer abc.def api_key=secret'
    )
    expect(result).toContain('C:\\Users\\<user>\\AppData')
    expect(result).toContain('Bearer <redacted>')
    expect(result).toContain('api_key=<redacted>')
    expect(result).not.toContain('alice')
    expect(result).not.toContain('abc.def')
    expect(result).not.toContain('secret')
  })

  it('redacts macOS and Linux home paths', () => {
    expect(sanitizeDiagnosticText('/Users/alice/Library/Logs')).toContain('/Users/<user>')
    expect(sanitizeDiagnosticText('/home/alice/.config')).toContain('/home/<user>')
  })

  it('limits nested diagnostic data', () => {
    const result = sanitizeDiagnosticData({
      a: { b: { c: { d: 'too deep' } } },
      list: Array.from({ length: 30 }, (_, index) => index),
      token: 'Bearer abcdef'
    }) as Record<string, unknown>
    expect(result.token).toBe('Bearer <redacted>')
    expect((result.list as number[]).length).toBe(20)
    expect(JSON.stringify(result)).toContain('<truncated>')
  })

  it('keeps only the newest breadcrumbs', () => {
    const item = (index: number): Breadcrumb => ({
      at: new Date(index).toISOString(),
      scope: 'test',
      message: String(index)
    })
    const list = [item(1), item(2)].reduce(
      (items, next) => pushBreadcrumb(items, next, 2),
      [] as Breadcrumb[]
    )
    const result = pushBreadcrumb(list, item(3), 2)
    expect(result.map((entry) => entry.message)).toEqual(['2', '3'])
  })
})
