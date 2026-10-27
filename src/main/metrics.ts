import { app } from 'electron'
import { addBreadcrumb } from './breadcrumbs'

export interface ProcessMetricSample {
  type: string
  pid: number
  cpuPercent: number
  workingSetKb: number
  name?: string
}

export interface MetricsSample {
  at: string
  memory: NodeJS.MemoryUsage
  eventLoopLagMs: number
  processes: ProcessMetricSample[]
}

const MAX_SAMPLES = 120
const EVENT_LOOP_WARN_MS = 250

let samples: MetricsSample[] = []
let timer: NodeJS.Timeout | null = null

/**
 * 背景：主进程卡顿、内存上涨和子进程异常在用户机器上很难复现。
 * 设计意图：按固定间隔采样内存、Electron 进程指标和事件循环延迟，保留最近 2 小时。
 * 关键约束：只记录数值，不采集窗口标题、文件路径或用户内容；定时器 unref，不阻止退出。
 */
export function startMetricsSampling(intervalMs = 60_000): void {
  if (timer) return
  sampleMetrics()
  timer = setInterval(sampleMetrics, intervalMs)
  timer.unref?.()
}

export function stopMetricsSampling(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

export function getMetricsSamples(): MetricsSample[] {
  return samples.map((sample) => ({
    ...sample,
    memory: { ...sample.memory },
    processes: sample.processes.map((process) => ({ ...process }))
  }))
}

export function latestMetrics(): MetricsSample | null {
  return samples.length > 0 ? getMetricsSamples()[samples.length - 1] : null
}

/**
 * 背景：一次采样如果阻塞主线程，就会把监控变成噪声。
 * 设计意图：用 setImmediate 测一次事件循环延迟，再异步读取 app.getAppMetrics。
 * 关键约束：采样失败只忽略，不影响业务；不在这里做日志轮转或网络上传。
 */
function sampleMetrics(): void {
  const startedAt = Date.now()
  setImmediate(() => {
    const eventLoopLagMs = Date.now() - startedAt
    const sample: MetricsSample = {
      at: new Date().toISOString(),
      memory: process.memoryUsage(),
      eventLoopLagMs,
      processes: readProcessMetrics()
    }
    samples.push(sample)
    if (samples.length > MAX_SAMPLES) samples.shift()
    if (eventLoopLagMs >= EVENT_LOOP_WARN_MS) {
      addBreadcrumb('metrics', 'event loop lag', { eventLoopLagMs })
    }
  })
}

function readProcessMetrics(): ProcessMetricSample[] {
  try {
    if (!app.isReady()) return []
    return app.getAppMetrics().map((metric) => ({
      type: metric.type,
      pid: metric.pid,
      cpuPercent: metric.cpu.percentCPUUsage,
      workingSetKb: metric.memory.workingSetSize,
      name: metric.name
    }))
  } catch (error) {
    console.warn('METRICS_READ_FAILED', error)
    return []
  }
}
