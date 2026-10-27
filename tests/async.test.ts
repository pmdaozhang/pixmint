import { describe, expect, it } from 'vitest'
import { withTimeout } from '../src/shared/async'

describe('withTimeout', () => {
  it('resolves before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'timeout')).resolves.toBe('ok')
  })

  it('rejects when the promise does not settle', async () => {
    await expect(withTimeout(new Promise(() => {}), 10, 'timeout')).rejects.toThrow('timeout')
  })

  it('preserves the original rejection', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('native failure')), 50, 'timeout')
    ).rejects.toThrow('native failure')
  })
})
