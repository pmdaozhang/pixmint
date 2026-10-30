# Pixmint 发版检查单

## 自动门禁（CI）

- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm build`
- `pnpm soak:overlay`（200 次，假画面，只验证功能与基础预算）
- 打包后确认 `resources/ocr` 含 PP-OCRv5 det/rec 模型和字典
- 用打包后的 `Pixmint.exe --smoke-ocr-file` 识别混排测试图，确认 `OCR_BACKEND paddle`

## 应用内更新（P6）

- 打包后确认 `release` 同时存在 `Pixmint-Setup-<version>.exe`、`latest.yml`、`.blockmap`，三者的文件名和版本一致。
- 确认 `release/win-unpacked/resources/app-update.yml` 的 `provider` 为 `generic`，`url` 为 `https://pixmint.hugproducthub.top/downloads/`。
- 上传 `Pixmint-Setup-<version>.exe`、`.sha256`、`latest.yml`、`.blockmap` 到服务器 `/var/www/pixmint-downloads/`，不要重命名资产。
- 最后原子替换 `/var/www/pixmint/release.json`，再验证官网下载和应用内更新。
- 0.3.10 老用户必须先手动安装一次 0.4.0；旧版没有更新器，无法自动升级。
- 用当前版本检查线上更新源，验证“检查 → 发现新版本 → 下载进度 → 校验 → 重启安装 → 版本号变化”。
- 验证断网、更新源 404、安装包哈希不匹配三条失败路径都有中文提示，且不会进入安装。
- 更新后确认设置、密钥、历史和诊断日志保留。
- 本地回归可用 `PIXMINT_UPDATE_URL=http://127.0.0.1:<port>/` 指向 generic 测试源；测试源需同时提供 `latest.yml`、安装包和 `.blockmap`。
- 已知风险：Windows 安装包未签名会触发 SmartScreen；GitHub 国内下载速度未实测；差分下载命中未实测。
- 2026-10-27 状态：`v0.5.0` 已发布；0.4.1 → 0.5.0 在线更新验证通过；0.4.1 旧 Release 缺 blockmap，差分自动回退全量下载。
- 2026-10-30 状态：`v0.6.2` 安装包已构建；`latest.yml`、`.blockmap`、`release.json` 和 SHA256 已生成，等待上传腾讯云并验证自动更新。

## 长截图（已下线）

长截图功能已于 2026-10-29 从产品入口和运行链路下线，相关源文件、单测、E2E、Demo 和专用文档已删除，不再执行 smoke、E2E 或真实应用长截图检查。

## 交互桌面门禁（发布前必跑）

必须在普通 Windows 交互桌面运行，GitHub 托管 runner 不能替代。

```powershell
# 1. 真实截图 300 次
$env:PIXMINT_REAL_OVERLAY_CYCLES = '300'
$env:PIXMINT_REAL_OVERLAY_SAMPLE = '50'
pnpm soak:real-overlay

# 2. 五条用户路径，各 50 次
foreach ($path in @('esc', 'copy', 'pin', 'ocr', 'save')) {
  $env:PIXMINT_MEMORY_PATH = $path
  $env:PIXMINT_MEMORY_CYCLES = '50'
  pnpm soak:memory
}

# 3. 3 次 10 分钟录制，结束后空闲 60 秒复测
$env:PIXMINT_SOAK_RECORDINGS = '3'
$env:PIXMINT_SOAK_RECORD_SECONDS = '590'
pnpm soak:recording
```

## 预算

| 场景 | 指标 | 预算 |
|---|---|---|
| 真实截图 300 次 | renderer private 增长 | ≤ 32MB |
| Esc / 钉图 / OCR，各 50 次 | renderer private 增长 | ≤ 32MB |
| 保存 50 次 | renderer private 增长（含系统文件写入） | ≤ 48MB |
| 复制 50 次 | renderer private 增长（含系统剪贴板） | ≤ 64MB |
| 录制 3×590 秒 | Tab private 增长 | ≤ 64MB |
| 录制 3×590 秒 | 超过 1MB 的临时残留 | 0 |

## DPI

- Windows 缩放切到 150%，运行 `pnpm e2e:overlay`（已在本机通过，VIEWPORT 1280×720）
- 再切到 200%，运行 `pnpm e2e:overlay`（当前显示器不提供 200%，需换支持 200% 的机器）
- 记录两次的 `E2E_OK` 和选区/缩放手柄坐标

## 报告

- 压测报告写入 `test-results/*.json`
- 发版前把报告随版本归档；任一预算超限不得发版
