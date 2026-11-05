/**
 * 背景：截图默认文件名与诊断报告都用同一套时间戳格式，原先定义在 index.ts。
 * 设计意图：抽成纯函数，供业务层与 IPC 层共用。
 * 关键约束：本地时间、无分隔符，形如 20261104-121015。
 */
export function formatStamp(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')
}
