import { describe, expect, it } from 'vitest'
import { CaptureGate } from '../src/main/services/capture-gate'

describe('CaptureGate', () => {
  it('ignores a second trigger while the first screenshot is still running', async () => {
    const gate = new CaptureGate()
    let release = (): void => {}
    let runs = 0

    const first = gate.run(async () => {
      runs += 1
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    const second = gate.run(async () => {
      runs += 1
    })

    await Promise.resolve()
    expect(runs).toBe(1)
    expect(gate.busy).toBe(true)

    release()
    await Promise.all([first, second])
    expect(runs).toBe(1)
    expect(gate.busy).toBe(false)
  })

  it('allows the next trigger after the previous screenshot finished', async () => {
    const gate = new CaptureGate()
    let runs = 0

    await gate.run(async () => {
      runs += 1
    })
    await gate.run(async () => {
      runs += 1
    })

    expect(runs).toBe(2)
  })

  it('releases the gate when the screenshot flow throws', async () => {
    const gate = new CaptureGate()

    await expect(
      gate.run(async () => {
        throw new Error('capture failed')
      })
    ).rejects.toThrow('capture failed')
    expect(gate.busy).toBe(false)

    let ran = false
    await gate.run(async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })
})
