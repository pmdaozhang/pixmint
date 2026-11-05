/**
 * 背景：主进程原先用 20 多个 `process.argv.includes(...)` 散落在 index.ts 顶部，
 * 既难读，也让"生产代码"和"测试入口"混在一起。
 * 设计意图：集中解析一次，其余模块只读这个对象。
 * 关键约束：这里只做只读解析，不访问 Electron API，保证可在单测里直接引用。
 */

const argv = process.argv

function has(flag: string): boolean {
  return argv.includes(flag)
}

function valueAfter(flag: string): string {
  const index = argv.indexOf(flag)
  return index >= 0 ? (argv[index + 1] ?? '') : ''
}

export const flags = {
  smokeTest: has('--smoke-test'),
  captureSmoke: has('--smoke-capture'),
  overlaySmoke: has('--smoke-overlay'),
  showSettings: has('--show-settings'),
  ocrSmoke: has('--smoke-ocr'),
  overlayOcrSmoke: has('--smoke-overlay-ocr'),
  settingsE2e: has('--e2e-settings'),
  onboardingE2e: has('--e2e-onboarding'),
  feedbackE2e: has('--e2e-feedback'),
  whatsNewE2e: has('--e2e-whats-new'),
  ocrTranslateSmoke: has('--smoke-ocr-translate'),
  prepareSmoke: has('--smoke-prepare'),
  fastCaptureSmoke: has('--smoke-fast-capture'),
  ocrFileSmokePath: valueAfter('--smoke-ocr-file'),
  soakOcr: has('--soak-ocr'),
  captureOnce: has('--capture-once'),
  debugTrayMenu: has('--debug-tray-menu')
} as const

export const isOcrFileSmoke = flags.ocrFileSmokePath.length > 0

/**
 * 背景：单实例锁会阻止 smoke/E2E 脚本并行启动多个进程。
 * 设计意图：任何自动化入口都跳过单实例锁与常规启动流程。
 * 关键约束：新增自动化入口时必须同步加到这里，否则 CI 会卡在单实例锁上。
 */
export function isAutomationRun(): boolean {
  return (
    flags.smokeTest ||
    flags.captureSmoke ||
    flags.overlaySmoke ||
    flags.ocrSmoke ||
    flags.overlayOcrSmoke ||
    flags.ocrTranslateSmoke ||
    flags.prepareSmoke ||
    flags.fastCaptureSmoke ||
    isOcrFileSmoke ||
    flags.soakOcr ||
    flags.captureOnce ||
    flags.settingsE2e ||
    flags.onboardingE2e ||
    flags.feedbackE2e ||
    flags.whatsNewE2e
  )
}
