import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { SidecarClient } from '../src/main/sidecar/client'

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin: Writable
  killCount = 0

  constructor(
    responder: (line: string) => string | null,
    private readonly deferExit = false
  ) {
    super()
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        const response = responder(chunk.toString().trim())
        if (response) process.nextTick(() => this.stdout.write(`${response}\n`))
        callback()
      }
    })
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killCount += 1
    if (!this.deferExit) this.emit('exit', null, signal ?? 'SIGTERM')
    return true
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
      expect(child.killCount).toBeGreaterThan(0)
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

  it('does not let an old child exit cancel a new request', async () => {
    const first = new FakeChild(() => null, true)
    const second = new FakeChild((line) => {
      const [id] = line.split(',')
      return `${id}|new-ok`
    })
    let spawnCount = 0
    const client = new SidecarClient({
      name: 'test-sidecar',
      launch: () => ({ command: 'fake-sidecar', args: [] }),
      defaultTimeoutMs: 50,
      spawnImpl: (() => {
        spawnCount += 1
        return spawnCount === 1 ? first : second
      }) as unknown as typeof import('node:child_process').spawn
    })
    try {
      await expect(client.request('old', 10)).resolves.toBeNull()
      const next = client.request('new', 200)
      first.emit('exit', null, 'SIGTERM')
      await expect(next).resolves.toBe('new-ok')
    } finally {
      client.dispose()
    }
  })
})
