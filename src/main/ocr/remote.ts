import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { OcrResult } from '../../shared/types'
import { logDiagnostic } from '../diagnostics'

/**
 * 背景：OCR 推理移入 utilityProcess 后，主进程需要一个可靠的请求/响应通道。
 * 设计意图：懒启动、单飞重试、超时与崩溃统一兜底；任何失败都让上层回退到进程内实现。
 * 关键约束：同一时间只允许一个请求在途（旧实现也用队列串行化），避免子进程内存叠加。
 */

export interface OcrWorkerRequest {
  width: number
  height: number
  rgba: Uint8Array
  modelsDir: string
}

/** 子进程只负责 Paddle；需要 Windows OCR 时回一个 fallback 信号，由主进程用原图兜底。 */
export type OcrWorkerOutcome =
  | { kind: 'result'; result: OcrResult }
  | { kind: 'fallback' }

interface PendingRequest {
  resolve: (value: OcrWorkerOutcome) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface WorkerReply {
  id?: number
  ok?: boolean
  result?: OcrResult
  fallback?: 'windows'
  error?: string
}

const REQUEST_TIMEOUT_MS = 90_000

class OcrWorkerClient {
  private child: UtilityProcess | null = null
  private readonly pending = new Map<number, PendingRequest>()
  private sequence = 0
  private disposed = false

  recognize(request: OcrWorkerRequest): Promise<OcrWorkerOutcome> {
    return new Promise<OcrWorkerOutcome>((resolve, reject) => {
      const child = this.ensureChild()
      if (!child) {
        reject(new Error('OCR 子进程不可用'))
        return
      }
      const id = ++this.sequence
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('OCR 子进程超时'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      try {
        child.postMessage({ id, ...request })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  dispose(): void {
    this.disposed = true
    this.failAll(new Error('OCR 子进程已关闭'))
    try {
      this.child?.kill()
    } catch {
      // 关闭阶段忽略
    }
    this.child = null
  }

  private ensureChild(): UtilityProcess | null {
    if (this.disposed) return null
    if (this.child) return this.child
    try {
      const child = utilityProcess.fork(join(__dirname, 'ocr-worker.js'), [], {
        serviceName: 'pixmint-ocr',
        stdio: 'pipe'
      })
      child.on('message', (message) => this.handleReply(message as WorkerReply))
      child.on('exit', (code) => this.handleExit(code))
      child.on('spawn', () => logDiagnostic('ocr', 'worker spawned'))
      // 子进程的 console 输出走管道，转发到主进程控制台，便于 smoke/现场诊断。
      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text) console.log(text)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text) logDiagnostic('ocr', `worker stderr: ${text}`, 'warn')
      })
      this.child = child
      return child
    } catch (error) {
      logDiagnostic('ocr', `worker fork failed: ${String(error)}`, 'error')
      return null
    }
  }

  private handleReply(reply: WorkerReply): void {
    const id = typeof reply?.id === 'number' ? reply.id : -1
    const entry = this.pending.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(id)
    if (reply.ok && reply.fallback === 'windows') {
      entry.resolve({ kind: 'fallback' })
    } else if (reply.ok && reply.result) {
      entry.resolve({ kind: 'result', result: reply.result })
    } else {
      entry.reject(new Error(reply.error ?? 'OCR 子进程返回失败'))
    }
  }

  private handleExit(code: number): void {
    logDiagnostic('ocr', `worker exited code=${code}`, code === 0 ? 'info' : 'warn')
    this.child = null
    this.failAll(new Error(`OCR 子进程退出(${code})`))
    if (!this.disposed && code !== 0) {
      // 崩溃后不自动重启，下一次请求时按需重建，避免崩溃循环。
      logDiagnostic('ocr', 'worker will restart on next request', 'info')
    }
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }
}

export const ocrWorker = new OcrWorkerClient()
