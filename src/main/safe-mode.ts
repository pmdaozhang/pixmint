import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SAFE_MODE_FILE = 'recording-safe-mode.json'
const SESSION_LOCK_FILE = 'recording-session.lock'

/**
 * 背景：Windows 透明覆盖层和视频编码都依赖 GPU 路径，极少数驱动组合会让
 * 整个桌面失去响应，用户只能重启。
 * 设计意图：在覆盖层会话开始时写锁文件，正常结束再删除；下次启动如果发现锁
 * 还在，就说明上次会话没有正常收尾，自动进入兼容模式。
 * 关键约束：这里只做文件读写，不依赖 app ready；路径不可用时退回 APPDATA。
 */
function dataDir(): string {
  try {
    return app.getPath('userData')
  } catch (error) {
    console.warn('SAFE_MODE_USER_DATA_FALLBACK', error)
    return join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), 'snapglass')
  }
}

function filePath(name: string): string {
  return join(dataDir(), name)
}

function ensureDataDir(): void {
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/**
 * 背景：启动早期需要决定是否关闭硬件加速。
 * 设计意图：读取持久化标记，一次异常后保持兼容模式，避免反复触发驱动问题。
 * 关键约束：文件损坏时按未启用处理，并记录日志，不能阻止应用启动。
 */
export function safeModeRequested(): boolean {
  const path = filePath(SAFE_MODE_FILE)
  if (!existsSync(path)) return false
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { enabled?: unknown }
    return parsed.enabled === true
  } catch (error) {
    console.warn('SAFE_MODE_READ_FAILED', error)
    return false
  }
}

/**
 * 背景：检测到异常退出后，需要把兼容模式持久化到下一次启动。
 * 设计意图：记录原因和时间，方便用户和开发者确认触发场景。
 * 关键约束：写入失败只记录日志，不影响当前会话继续运行。
 */
export function enableSafeMode(reason: string): void {
  try {
    ensureDataDir()
    writeFileSync(
      filePath(SAFE_MODE_FILE),
      JSON.stringify({ enabled: true, reason, at: new Date().toISOString() }, null, 2),
      'utf8'
    )
  } catch (error) {
    console.warn('SAFE_MODE_WRITE_FAILED', error)
  }
}

/**
 * 背景：覆盖层是整机卡死风险最高的阶段，需要知道上次是否正常收尾。
 * 设计意图：用独立锁文件标记会话，正常隐藏时删除；异常重启后锁仍存在。
 * 关键约束：锁文件只记录时间戳，不参与业务判断，损坏也不影响启动。
 */
export function hasUncleanSession(): boolean {
  return existsSync(filePath(SESSION_LOCK_FILE))
}

/**
 * 背景：每次显示覆盖层都代表一次高风险会话。
 * 设计意图：在真正开始框选前写锁，确保哪怕渲染线程立刻卡死也能留下痕迹。
 * 关键约束：调用方必须保证正常结束走 endOverlaySession，否则下次会进兼容模式。
 */
export function beginOverlaySession(): void {
  try {
    ensureDataDir()
    writeFileSync(
      filePath(SESSION_LOCK_FILE),
      JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid }),
      'utf8'
    )
  } catch (error) {
    console.warn('OVERLAY_SESSION_LOCK_FAILED', error)
  }
}

/**
 * 背景：覆盖层正常关闭、取消或完成后，需要清除异常标记。
 * 设计意图：先判断存在再删除，避免把“文件本来就不存在”当成错误。
 * 关键约束：删除失败只记录日志，下一次启动最多多进一次兼容模式。
 */
export function endOverlaySession(): void {
  const path = filePath(SESSION_LOCK_FILE)
  if (!existsSync(path)) return
  try {
    unlinkSync(path)
  } catch (error) {
    console.warn('OVERLAY_SESSION_UNLOCK_FAILED', error)
  }
}
