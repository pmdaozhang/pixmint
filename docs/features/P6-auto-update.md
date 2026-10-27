# 功能：应用内更新

编号：P6 | 状态：已实现 | 版本：v3

## 需求描述

- 打包版 Pixmint 能在设置窗口内检查新版本，不再要求用户手动寻找安装包。
- 启动 15 秒后静默检查一次；用户也可以在“关于与更新”卡片手动检查。
- 发现新版本后显示版本号和更新摘要，由用户决定是否下载。
- 下载过程显示进度、已下载大小和总大小；下载完成后校验 SHA-512。
- 校验通过后提供“重启并安装”，安装完成自动重新启动 Pixmint。
- 检查失败、下载中断、校验失败、安装失败都要有中文提示和可重试入口。
- 更新过程不能影响截图、OCR、录制、设置数据和现有诊断日志。
- 首版仅 Windows；macOS 等待签名与公证完成后再启用。

## 非目标

- 不做热更新，不替换正在运行的代码。
- 不做灰度发布、分批推送、强制更新。
- 不做 macOS / Linux 自动更新。
- 本次不做 Windows 代码签名。
- 不新增托盘菜单更新入口，入口只在设置页。

## 设计决策

- 使用 `electron-updater` 6.x，与现有 electron-builder 26 + NSIS 安装包配套。
- 更新源使用 GitHub Releases；`electron-builder.yml` 显式写 `publish`，不再依赖 git remote 推断。
- `artifactName` 统一为 `Pixmint-Setup-${version}.${ext}`，消除空格导致的 URL 编码和 `latest.yml` 文件名不一致。
- 更新器只在 `app.isPackaged` 为 true 时启用；开发模式、smoke 和默认 E2E 不发起检查。
- 启动后延迟 15 秒检查，避开冷启动和覆盖层预热。
- `autoDownload = false`、`autoInstallOnAppQuit = true`；下载和安装都由用户确认。
- 状态机放在 `src/shared/update.ts`，主进程只负责事件和 IPC，渲染层只负责展示。
- 通过 `PIXMINT_UPDATE_URL` 环境变量覆盖 feed，仅用于本地 generic E2E。
- 更新日志写入现有 diagnostics，不新建日志文件。
- 设置页卡片放在“外观与启动”之后、“诊断”之前，底部版本号保留。
- 不做“跳过此版本”和“稍后提醒”持久化，首版保持状态简单。

## 状态定义

| 状态 | 触发 | 主按钮 | 进度 |
|---|---|---|---|
| `idle` | 初始或安装完成 | 检查更新 | 隐藏 |
| `checking` | 手动检查或启动检查 | 检查中（禁用） | 隐藏 |
| `up-to-date` | 清单版本不高于当前版本 | 再次检查 | 隐藏 |
| `available` | 清单版本高于当前版本 | 下载更新 | 隐藏 |
| `downloading` | 用户确认下载 | 下载中（禁用） | 显示 |
| `verifying` | 下载结束、校验中 | 校验中（禁用） | 100% |
| `downloaded` | 校验通过 | 重启并安装 | 100% |
| `installing` | 用户确认安装 | 安装中（禁用） | 100% |
| `error` | 检查、下载、校验或安装失败 | 重试 | 按失败阶段保留或隐藏 |

## 错误文案

| 场景 | 文案 |
|---|---|
| 网络不可达 | 检查更新失败：无法连接更新源 |
| 更新源 404 | 更新源不可用，请稍后重试 |
| 仓库暂无 Release | 已是最新版本（备注：更新源暂无发布记录） |
| 下载中断 | 下载中断，请检查网络后重试 |
| 哈希校验失败 | 安装包校验失败，已阻止安装 |
| 安装失败 | 安装失败，请手动下载最新版本 |
| 开发环境 | 开发模式不检查更新 |

## 验收标准

- [x] 打包版启动 15 秒后在日志中留下一次检查记录；开发模式不检查。
- [x] 设置页“关于与更新”卡片显示当前版本，位置在“外观与启动”与“诊断”之间。
- [x] 无新版本时手动检查显示“已是最新版本”，按钮恢复可点。
- [x] GitHub 仓库 0 个 Release 时显示绿色“已是最新版本”，备注“更新源暂无发布记录”，不显示英文错误。
- [x] 本地 generic 源提供更高版本时显示版本号和“下载更新”。
- [x] 下载过程显示百分比和已下载 / 总大小，UI 不阻塞。
- [x] 下载完成后校验 SHA-512，校验失败不进入安装。
- [x] 校验通过后“重启并安装”可完成 NSIS 覆盖安装并自动重启。
- [x] 更新后设置、密钥、缓存和诊断日志保留。
- [x] 网络断开、404、校验失败都有对应中文提示和重试入口；下载中断和真实安装失败注入未单独实测。
- [x] `electron-builder.yml` 生成 `latest.yml`、`.blockmap`，且文件名与安装包一致。
- [x] 0.3.10 手动覆盖安装 0.4.0 成功，之后 0.4.0 → 0.4.1 可应用内更新。
- [x] 启动、设置、截图主路径（e2e-overlay）回归通过；OCR / 录制真实路径未重跑。

## 实测结果（2026-10-26）

- 0.4.0 安装包 119,455,568 字节，较 0.3.10 增加 395,800 字节（+0.33%）。
- 本地 generic 源完成 0.4.0 → 0.4.1 全链路：检查、下载 119MB、SHA-512 校验、静默安装、自动重启。
- 本地 generic 源验证同版本、断网、404、哈希失败：分别显示“已是最新”“无法连接更新源”“更新源不可用”“校验失败，已阻止安装”。
- 0.3.10 → 0.4.0 覆盖安装通过，设置保留；0.4.1 → 0.4.0 覆盖安装也通过。
- 安装后文件版本 `0.4.1.0`，`app.getVersion()` 返回 `0.4.1`。
- 更新后 `%APPDATA%\snapglass` 的 `settings.json`、`secrets.json`、`history` 和日志均保留。
- `tsc --noEmit`、121 个单测、`electron-vite build`、`e2e-settings.cjs`、`e2e-overlay.cjs` 全部通过。
- 未实测：GitHub Releases 真实下载速度、差分下载命中、Windows 代码签名、macOS 自动更新、下载中断、真实安装失败注入、OCR / 录制 E2E。

### 0.4.1 修复

- 识别 `No published versions on GitHub`，归入 `up-to-date`，不再进入红色错误状态。
- 文案改为“已是最新版本”，备注“更新源暂无发布记录 · 发布新版本后会自动检测”。
- 真实 GitHub 源（0 个 Release）打包版实测通过。

## 性能与取舍预审

```text
成本模型：检查=1 次 HTTPS 请求（约 1KB）；更新=下载约 119MB 全量或差分块；安装=NSIS 解压替换。
基线 / 主导项：0.3.10 安装包 119,059,768 字节；无更新功能时启动零额外请求。下载传输占绝对主导，检查请求可忽略。
杠杆 / 收益 / 风险：差分更新减少下载量；启动延迟 15 秒避免冷启动竞争；GitHub 国内速度是主要风险。
取舍 / 用户默认值：更新源 GitHub（推荐）；自动检查、手动下载安装；本次不做代码签名。
预算 / 待验证假设：包体增加 ≤3MB；检查超时 15 秒；进度更新 500ms 节流；假设 GitHub Releases 下载速度可接受（当前只验证 API 可达，未实测下载速度）。
```

## 风险

- 0.3.10 没有更新器，老用户必须手动安装一次 0.4.0，之后才能使用应用内更新。
- 未签名安装包会触发 SmartScreen；本次记录为黄色项，不阻塞发布。
- GitHub 在国内可能速度慢或间歇不可达；后续可切 generic + CDN，客户端代码不需要重写。
- 发布端 `git push` 当前受 Windows schannel 影响；发布时可改用 GitHub API + Token。
- `pnpm package` 会被 release-gate 拦截，打包前必须先生成对应版本的迭代回顾报告。

## 关联文件

- `src/main/updater.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/shared/api.ts`
- `src/shared/types.ts`
- `src/shared/update.ts`
- `src/renderer/src/settings/SettingsApp.tsx`
- `src/renderer/src/settings/settings.css`
- `src/renderer/src/dev-mock.ts`
- `package.json`
- `electron-builder.yml`
- `tests/update.test.ts`
- `demos/P6-auto-update.html`
- `docs/test-cases/P6-auto-update.md`
- `docs/superpowers/plans/P6-auto-update.md`

## 变更记录

| 日期 | 版本 | 变更 | 原因 |
|---|---|---|---|
| 2026-10-26 | v1 | 首版：GitHub Releases + electron-updater，设置页卡片 | 应用内更新需求确认 |
| 2026-10-26 | v2 | 完成实现与本地 generic 全链路验证；补静默安装、原始错误日志和 E2E 测试入口 | 0.4.0 发布 |
| 2026-10-26 | v3 | 修复仓库无 Release 时误报红色错误，归入“已是最新版本” | 0.4.1 修复 |
