import { describe, expect, it } from 'vitest'
import { isTrustedAppUrl } from '../src/main/security'

describe('application URL trust', () => {
  it('allows local app pages', () => {
    expect(isTrustedAppUrl('file:///D:/app/out/renderer/index.html')).toBe(true)
    expect(isTrustedAppUrl('http://localhost:5173/overlay')).toBe(true)
    expect(isTrustedAppUrl('http://127.0.0.1:5173/settings')).toBe(true)
    expect(isTrustedAppUrl('http://[::1]:5173/')).toBe(true)
  })

  it('rejects external and executable URLs', () => {
    expect(isTrustedAppUrl('https://example.com')).toBe(false)
    expect(isTrustedAppUrl('http://192.168.1.10:5173')).toBe(false)
    expect(isTrustedAppUrl('javascript:alert(1)')).toBe(false)
    expect(isTrustedAppUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isTrustedAppUrl('')).toBe(false)
  })
})
