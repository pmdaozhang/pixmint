/**
 * 背景：覆盖层握手次数原先以模块级变量散落在 index.ts，smoke 流程需要读取。
 * 设计意图：把跨模块共享的计数器收成一个小模块，避免再往 index.ts 里加全局变量。
 * 关键约束：只记录计数，不涉及生命周期判断。
 */

let overlayReadyCount = 0

export function noteOverlayReady(): void {
  overlayReadyCount += 1
}

export function resetOverlayReadyCount(): void {
  overlayReadyCount = 0
}

export function overlayReadyTotal(): number {
  return overlayReadyCount
}
