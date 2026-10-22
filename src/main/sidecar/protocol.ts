export interface SidecarResponse {
  id: number
  payload: string
}

/**
 * 背景：sidecar 通过 stdout 返回多行响应，单次 chunk 可能被拆成半行。
 * 设计意图：把增量文本聚合成完整行，主进程只处理完整响应。
 * 关键约束：保留最后一个未完成片段；CRLF 和 LF 都支持。
 */
export class LineBuffer {
  private buffer = ''

  push(chunk: string): string[] {
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''
    return lines.map((line) => line.trim()).filter(Boolean)
  }

  clear(): void {
    this.buffer = ''
  }

  get pending(): string {
    return this.buffer
  }

  get size(): number {
    return this.buffer.length
  }
}

/**
 * 背景：Windows PowerShell helper 需要把请求 ID 和参数拼成一行写入 stdin。
 * 设计意图：统一编码格式，避免各 helper 自己拼接导致 ID/参数错位。
 * 关键约束：payload 可以包含分隔符，ID 只取最前面的数字。
 */
export function encodeSidecarRequest(id: number, payload: string): string {
  return `${id},${payload}`
}

/**
 * 背景：helper 返回 `id|payload`，需要可靠提取请求 ID 和正文。
 * 设计意图：只接受正整数 ID；正文允许包含 `|`，用第一个分隔符切分。
 * 关键约束：格式非法时返回 null，由调用方记录并忽略，不能误配到其他请求。
 */
export function parseSidecarResponse(line: string): SidecarResponse | null {
  const separator = line.indexOf('|')
  if (separator <= 0) return null
  const id = Number(line.slice(0, separator))
  if (!Number.isInteger(id) || id <= 0) return null
  return { id, payload: line.slice(separator + 1) }
}
