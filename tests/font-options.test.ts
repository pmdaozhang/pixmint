import { describe, expect, it } from 'vitest'
import {
  canUseFontChoice,
  FONT_CHOICES,
  fontChoiceId
} from '../src/renderer/src/overlay/options'

describe('font choices', () => {
  it('默认字体免费可用，会员也可用', () => {
    const defaultChoice = FONT_CHOICES.find((choice) => choice.id === 'default')
    expect(defaultChoice).toBeDefined()
    expect(canUseFontChoice(defaultChoice as never, false)).toBe(true)
    expect(canUseFontChoice(defaultChoice as never, true)).toBe(true)
  })

  it('会员字体免费不可用、会员可用', () => {
    const proChoices = FONT_CHOICES.filter((choice) => choice.pro)
    expect(proChoices.length).toBeGreaterThan(0)
    for (const choice of proChoices) {
      expect(canUseFontChoice(choice, false)).toBe(false)
      expect(canUseFontChoice(choice, true)).toBe(true)
    }
  })

  it('字体清单至少 10 项，且标签与族名完整', () => {
    expect(FONT_CHOICES.length).toBeGreaterThanOrEqual(10)
    for (const choice of FONT_CHOICES) {
      expect(choice.label.length).toBeGreaterThan(0)
      expect(choice.family.length).toBeGreaterThan(0)
    }
  })

  it('按族名解析选项 id，未知回退默认', () => {
    expect(fontChoiceId('sans-serif')).toBe('default')
    expect(fontChoiceId('PixmintFoxi')).toBe('foxi')
    expect(fontChoiceId('不存在的字体')).toBe('default')
  })
})
