/**
 * 背景：Electron 窗口默认允许一定程度的导航和新窗口行为，渲染层一旦被注入内容会扩大攻击面。
 * 设计意图：只允许 file: 和本机开发地址导航，其余来源一律拒绝。
 * 关键约束：这是应用内窗口的信任边界，不用于校验用户输入或外部 URL 白名单。
 */
export function isTrustedAppUrl(rawUrl: string): boolean {
  if (!rawUrl) return false
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'file:') return true
    const localHost =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]'
    return (url.protocol === 'http:' || url.protocol === 'https:') && localHost
  } catch {
    return false
  }
}

/**
 * 背景：截图/OCR/设置窗口只加载本地页面，不应该打开新窗口或跳到外部站点。
 * 设计意图：在 web-contents-created 时统一安装导航限制，避免每个窗口遗漏。
 * 关键约束：本应用不使用 webview；一律拒绝 attach，后续需要时再单独放开。
 */
export function installWebContentsSecurity(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedAppUrl(url)) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}
