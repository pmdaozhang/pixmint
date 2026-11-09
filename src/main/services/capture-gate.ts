/**
 * 背景：F1 在截图流程尚未结束时被连续按下，会并发启动多次 prepare/startCapture，
 * 后一次 hideAll 把前一次覆盖层状态清掉，表现为“按了没反应”或闪烁。
 * 设计意图：同一时间只允许一个截图流程；流程结束后立即释放，保留“覆盖层已显示时再按 F1 关闭”的语义。
 */
export class CaptureGate {
  private inFlight = false

  get busy(): boolean {
    return this.inFlight
  }

  run(task: () => Promise<void>): Promise<void> {
    if (this.inFlight) return Promise.resolve()
    this.inFlight = true
    return Promise.resolve()
      .then(task)
      .finally(() => {
        this.inFlight = false
      })
  }
}
