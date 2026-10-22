import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { SidecarClient } from '../src/main/sidecar/client'

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin: Writable
  readonly kill = vi.fn(() => {
    this.emit('exit', null, 'SIGTERM')
    return true
  })

  constructor(responder: (line: string) => string | null) {
    super()
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        const response = responder(chunk.toString().trim())
        if (response) process.nextTick(() => this.stdout.write(`${response}\n`))
        callback()
      }
    })
  }
}

function createClient(child: FakeChild, timeoutMs = 100): SidecarClient {
  return new SidecarClient({
    name: 'test-sidecar',
    launch: () => ({ command: 'fake-sidecar', args: [] }),
    defaultTimeoutMs: timeoutMs,
    spawnImpl: (() => child) as unknown as typeof import('node:child_process').spawn
  })
}

describe('SidecarClient', () => {
  it('sends a request and resolves the matching payload', async () => {
    const child = new FakeChild((line) => {
      const [id, ...rest] = line.split(',')
      return `${id}|ok:${rest.join(',')}`
    })
    const client = createClient(child)
    try {
      await expect(client.request('1,2,3', 100)).resolves.toBe('ok:1,2,3')
    } finally {
      client.dispose()
    }
  })

  it('returns null and restarts on timeout', async () => {
    const child = new FakeChild(() => null)
    const client = createClient(child, 20)
    try {
      await expect(client.request('1,2', 10)).resolves.toBeNull()
      expect(child.kill).toHaveBeenCalled()
    } finally {
      client.dispose()
    }
  })

  it('resolves pending requests when disposed', async () => {
    const child = new FakeChild(() => null)
    const client = createClient(child)
    const pending = client.request('1,2', 500)
    client.dispose()
    await expect(pending).resolves.toBeNull()
  })
})
