/**
 * 背景：稳定性诊断需要在不泄露用户内容的前提下记录上下文。
 * 设计意图：把脱敏、数据裁剪和面包屑环形缓冲放在 shared，主进程和测试共用。
 * 关键约束：这里只做纯字符串/对象处理，不依赖 Electron 或文件系统。
 */

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Breadcrumb {
  at: string
  scope: string
  message: string
  data?: Record<string, unknown>
}

const MAX_MESSAGE_LENGTH = 500
const MAX_DATA_STRING_LENGTH = 200
const MAX_DATA_ITEMS = 20
const MAX_DATA_DEPTH = 3

/**
 * 背景：日志和崩溃报告可能把用户名、路径、Token 带出去。
 * 设计意图：在写入磁盘前统一做轻量脱敏，保留足够定位信息但去掉敏感值。
 * 关键约束：只处理常见模式，不能替代完整的安全审计。
 */
export function sanitizeDiagnosticText(value: string, maxLength = MAX_MESSAGE_LENGTH): string {
  const text = String(value ?? '')
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/gi, '$1<user>')
    .replace(/(\/Users\/)[^/\s]+/g, '$1<user>')
    .replace(/(\/home\/)[^/\s]+/g, '$1<user>')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[=:]\s*)[^\s,;]+/gi,
      '$1<redacted>'
    )
  return text.slice(0, maxLength)
}

/**
 * 背景：崩溃报告会附带少量结构化上下文，不能让任意对象无限展开。
 * 设计意图：限制深度、数组长度和字符串长度，避免日志膨胀和敏感内容扩散。
 * 关键约束：返回 JSON 安全的基础类型，不保留函数、Symbol 或原型链。
 */
export function sanitizeDiagnosticData(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return sanitizeDiagnosticText(value, MAX_DATA_STRING_LENGTH)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= MAX_DATA_DEPTH) return '<truncated>'
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_DATA_ITEMS)
      .map((item) => sanitizeDiagnosticData(item, depth + 1))
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(
      0,
      MAX_DATA_ITEMS
    )) {
      result[sanitizeDiagnosticText(key, 80)] = sanitizeDiagnosticData(item, depth + 1)
    }
    return result
  }
  return sanitizeDiagnosticText(String(value), MAX_DATA_STRING_LENGTH)
}

/**
 * 背景：最近操作是定位“卡死前发生了什么”的关键，但不能无限增长。
 * 设计意图：用不可变数组实现固定容量环形缓冲，便于单测和崩溃时快照。
 * 关键约束：超出容量时丢弃最旧记录，不修改传入数组。
 */
export function pushBreadcrumb(
  list: Breadcrumb[],
  item: Breadcrumb,
  maxItems = 100
): Breadcrumb[] {
  const next = [...list, item]
  return next.length > maxItems ? next.slice(next.length - maxItems) : next
}
