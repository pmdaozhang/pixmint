/**
 * 背景：原生屏幕捕获、网络请求和外部进程都可能永久不返回。
 * 设计意图：用统一超时包装 Promise，让调用方能把“卡住”转成可见错误。
 * 关键约束：超时只拒绝返回的 Promise，不会自动取消底层操作；调用方仍需清理资源。
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
