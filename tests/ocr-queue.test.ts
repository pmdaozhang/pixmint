import { describe, expect, it } from 'vitest'
import { enqueueOcr } from '../src/main/ocr/queue'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('OCR queue', () => {
  it('serializes tasks in submission order', async () => {
    const order: string[] = []
    const first = enqueueOcr(async () => {
      await delay(20)
      order.push('first')
      return 1
    })
    const second = enqueueOcr(async () => {
      order.push('second')
      return 2
    })
    await expect(first).resolves.toBe(1)
    await expect(second).resolves.toBe(2)
    expect(order).toEqual(['first', 'second'])
  })

  it('continues after a failed task', async () => {
    await expect(
      enqueueOcr(async () => {
        throw new Error('ocr failed')
      })
    ).rejects.toThrow('ocr failed')
    await expect(enqueueOcr(async () => 'recovered')).resolves.toBe('recovered')
  })
})
