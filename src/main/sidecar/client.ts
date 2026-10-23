import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { encodeSidecarRequest, LineBuffer, parseSidecarResponse } from './protocol'

export interface SidecarLaunchConfig {
  command: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export interface SidecarClientOptions {
  name: string
  launch: () => SidecarLaunchConfig
  defaultTimeoutMs: number
  onLog?: (message: string) => void
  spawnImpl?: typeof spawn
}

interface PendingRequest {
  id: number
  resolve: (payload: string | null) => void
  timer: NodeJS.Timeout
}

const MAX_BUFFER_BYTES = 64 * 1024 * 1024

/**
 * 背景：fast-capture 和 window-snap 各自实现了一套 spawn、行缓冲、超时和重启。
 * 设计意图：抽成通用客户端，Windows PowerShell 和未来 macOS Swift helper 共用协议。
 * 关键约束：同一时刻只保留一个待处理请求；新请求会取消旧请求，避免旧响应错配。
 */
export class SidecarClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly lines = new LineBuffer()
  private pending: PendingRequest | null = null
  private nextId = 1
  private disposed = false
  private readonly spawnImpl: typeof spawn

  constructor(private readonly options: SidecarClientOptions) {
    this.spawnImpl = options.spawnImpl ?? spawn
  }

  get isRunning(): boolean {
    return Boolean(this.child?.stdin.writable)
  }

  /**
   * 背景：应用启动或首次请求时需要预热 helper。
   * 设计意图：幂等启动，已运行时直接返回。
   * 关键约束：启动失败只记录日志，调用方仍可通过返回值降级。
   */
  ensureStarted(): void {
    if (this.child || this.disposed) return
    try {
      const config = this.options.launch()
      const child = this.spawnImpl(config.command, config.args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: config.cwd,
        env: config.env
      })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => this.onData(chunk))
      child.stderr.on('data', (chunk: string) => {
        this.log(`stderr: ${chunk.trim().slice(0, 500)}`)
      })
      child.on('error', (error) => {
        this.log(`spawn error: ${error.message}`)
        const wasCurrent = this.child === child
        if (wasCurrent) {
          this.child = null
          this.finish(null)
        }
      })
      child.on('exit', (code, signal) => {
        const wasCurrent = this.child === child
        if (wasCurrent) {
          this.child = null
          this.lines.clear()
          this.finish(null)
        }
        this.log(`exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
      })
      this.child = child
    } catch (error) {
      this.log(`start failed: ${error instanceof Error ? error.message : String(error)}`)
      this.child = null
    }
  }

  /**
   * 背景：截图/窗口查询都是“最新请求优先”，旧请求失去意义。
   * 设计意图：发送请求并返回原始 payload；超时或进程退出时返回 null。
   * 关键约束：新请求会 resolve 旧请求为 null；超时会重启 helper，避免半死进程继续占用。
   */
  request(payload: string, timeoutMs = this.options.defaultTimeoutMs): Promise<string | null> {
    if (this.disposed) return Promise.resolve(null)
    this.ensureStarted()
    const child = this.child
    if (!child?.stdin.writable) return Promise.resolve(null)

    this.cancelPending()

    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return
        this.pending = null
        this.log(`timeout id=${id}`)
        this.restart()
        resolve(null)
      }, timeoutMs)
      this.pending = { id, resolve, timer }
      try {
        child.stdin.write(`${encodeSidecarRequest(id, payload)}\n`)
      } catch (error) {
        this.log(`write failed: ${error instanceof Error ? error.message : String(error)}`)
        this.finishWithId(id, null)
        this.restart()
      }
    })
  }

  dispose(): void {
    this.disposed = true
    this.cancelPending()
    this.child?.kill()
    this.child = null
    this.lines.clear()
  }

  private onData(chunk: string): void {
    for (const line of this.lines.push(chunk)) {
      const response = parseSidecarResponse(line)
      if (!response) {
        this.log(`invalid response: ${line.slice(0, 200)}`)
        continue
      }
      this.finishWithId(response.id, response.payload)
    }
    if (this.lines.size > MAX_BUFFER_BYTES) {
      this.log('response buffer exceeded limit')
      this.finish(null)
      this.restart()
    }
  }

  private cancelPending(): void {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    const { resolve } = this.pending
    this.pending = null
    resolve(null)
  }

  private finish(payload: string | null): void {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    const { resolve } = this.pending
    this.pending = null
    resolve(payload)
  }

  private finishWithId(id: number, payload: string | null): void {
    if (!this.pending || this.pending.id !== id) return
    this.finish(payload)
  }

  private restart(): void {
    this.child?.kill()
    this.child = null
    this.lines.clear()
  }

  private log(message: string): void {
    this.options.onLog?.(`[${this.options.name}] ${message}`)
  }
}
