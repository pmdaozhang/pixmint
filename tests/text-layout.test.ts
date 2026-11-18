import { describe, expect, it } from 'vitest'
import { layoutText } from '../src/shared/text-layout'

// 等宽测量：每个字符 10px，便于稳定断言断行位置。
const measure = (text: string): number => text.length * 10
const LINE_HEIGHT = 1.2

function layout(text: string, maxWidth: number, maxHeight: number, fontSize = 15) {
  return layoutText(text, measure, fontSize, maxWidth, maxHeight)
}

describe('layoutText 断行', () => {
  it('中文按字断行', () => {
    const result = layout('一二三四', 30, 100)
    expect(result.lines).toEqual(['一二三', '四'])
    expect(result.height).toBeCloseTo(2 * 15 * LINE_HEIGHT)
  })

  it('英文按词断行，不把单词拆开', () => {
    const result = layout('hello world', 60, 100)
    expect(result.lines).toEqual(['hello', 'world'])
  })

  it('超长的英文单词按字符强制断开', () => {
    const result = layout('abcdefghij', 30, 100)
    expect(result.lines).toEqual(['abc', 'def', 'ghi', 'j'])
  })

  it('保留显式换行', () => {
    const result = layout('你好\n世界', 100, 100)
    expect(result.lines).toEqual(['你好', '世界'])
  })

  it('显式换行与其他行一起参与高度计算', () => {
    const result = layout('一\n二\n三', 100, 100, 15)
    expect(result.lines).toEqual(['一', '二', '三'])
    expect(result.height).toBeCloseTo(3 * 15 * LINE_HEIGHT)
  })

  it('宽度超过最大宽度时按最大宽度断行', () => {
    const result = layout('一二三四五', 40, 100)
    expect(result.lines).toEqual(['一二三四', '五'])
    expect(result.width).toBeLessThanOrEqual(40)
  })
})

describe('layoutText 溢出', () => {
  it('高度超过最大高度时标记溢出', () => {
    const fontSize = 15
    const result = layout('一\n二\n三', 100, fontSize * LINE_HEIGHT * 2 - 1, fontSize)
    expect(result.lines).toHaveLength(3)
    expect(result.overflow).toBe(true)
  })

  it('高度未超过最大高度时不溢出', () => {
    const fontSize = 15
    const result = layout('一\n二', 100, fontSize * LINE_HEIGHT * 2, fontSize)
    expect(result.overflow).toBe(false)
  })

  it('空文本至少一行，且不溢出', () => {
    const result = layout('', 100, 20)
    expect(result.lines).toEqual([''])
    expect(result.height).toBeCloseTo(15 * LINE_HEIGHT)
    expect(result.overflow).toBe(false)
  })

  it('最大宽度非正时按最小宽度处理，不抛错', () => {
    const result = layout('一二三', 0, 100)
    expect(result.lines.length).toBeGreaterThan(0)
    expect(result.overflow).toBe(true)
  })
})
