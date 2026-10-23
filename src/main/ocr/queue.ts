let tail: Promise<void> = Promise.resolve()

/**
 * 背景：每次 OCR 都会启动 PowerShell 并写临时脚本，并发调用会争抢资源。
 * 设计意图：用 Promise 链串行化 OCR 任务，避免多个 PowerShell/临时文件同时运行。
 * 关键约束：单个任务失败不能卡住后续任务；调用方仍然拿到自己的 Promise 结果。
 */
export function enqueueOcr<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task)
  tail = run.then(
    () => undefined,
    () => undefined
  )
  return run
}
