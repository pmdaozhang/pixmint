import {
  pushBreadcrumb,
  sanitizeDiagnosticData,
  sanitizeDiagnosticText,
  type Breadcrumb
} from '../shared/diagnostics'

const MAX_BREADCRUMBS = 100

let items: Breadcrumb[] = []

/**
 * 背景：崩溃报告只有堆栈时无法还原操作路径。
 * 设计意图：记录最近的关键业务动作，崩溃时随报告一起导出。
 * 关键约束：只保存脱敏后的短文本；容量固定，不能影响主流程。
 */
export function addBreadcrumb(
  scope: string,
  message: string,
  data?: Record<string, unknown>
): void {
  const sanitized = data ? sanitizeDiagnosticData(data) : undefined
  const item: Breadcrumb = {
    at: new Date().toISOString(),
    scope: sanitizeDiagnosticText(scope, 40),
    message: sanitizeDiagnosticText(message),
    data:
      sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
        ? (sanitized as Record<string, unknown>)
        : undefined
  }
  items = pushBreadcrumb(items, item, MAX_BREADCRUMBS)
}

/**
 * 背景：崩溃处理需要一份稳定快照，调用方不能拿到内部数组引用。
 * 设计意图：返回浅拷贝和 data 拷贝，避免后续操作影响报告内容。
 * 关键约束：只用于诊断，不承担持久化职责。
 */
export function getBreadcrumbs(): Breadcrumb[] {
  return items.map((item) => ({
    ...item,
    data: item.data ? { ...item.data } : undefined
  }))
}

export function clearBreadcrumbs(): void {
  items = []
}

export function breadcrumbCount(): number {
  return items.length
}
