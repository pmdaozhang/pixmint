import { describe, expect, it } from 'vitest'
import { parseScrollResult, parseScrollTarget } from '../src/shared/scroll-target'

describe('parseScrollTarget', () => {
  it('parses a valid target', () => {
    const target = parseScrollTarget(
      '{"hwnd":123,"className":"Chrome_WidgetWin_1","title":"Test Page","foreground":true,"rect":{"x":10,"y":20,"width":800,"height":600}}'
    )
    expect(target).toEqual({
      hwnd: 123,
      className: 'Chrome_WidgetWin_1',
      title: 'Test Page',
      foreground: true,
      rect: { x: 10, y: 20, width: 800, height: 600 }
    })
  })

  it('accepts a JSON payload with a prefix', () => {
    const target = parseScrollTarget(
      'note: {"hwnd":5,"className":"Notepad","title":"Untitled","foreground":false,"rect":{"x":0,"y":0,"width":100,"height":80}}'
    )
    expect(target?.hwnd).toBe(5)
  })

  it('rejects null and malformed payloads', () => {
    expect(parseScrollTarget(null)).toBeNull()
    expect(parseScrollTarget('null')).toBeNull()
    expect(parseScrollTarget('not json')).toBeNull()
  })

  it('rejects invalid handles and rectangles', () => {
    expect(
      parseScrollTarget(
        '{"hwnd":0,"className":"X","foreground":true,"rect":{"x":0,"y":0,"width":10,"height":10}}'
      )
    ).toBeNull()
    expect(
      parseScrollTarget(
        '{"hwnd":1,"className":"X","foreground":true,"rect":{"x":0,"y":0,"width":0,"height":10}}'
      )
    ).toBeNull()
  })
})

describe('parseScrollResult', () => {
  it('parses success', () => {
    expect(parseScrollResult('ok')).toEqual({ ok: true })
  })

  it('preserves helper errors', () => {
    expect(parseScrollResult('error:foreground')).toEqual({
      ok: false,
      error: 'error:foreground'
    })
    expect(parseScrollResult(null).ok).toBe(false)
  })
})
