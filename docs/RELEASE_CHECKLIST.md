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
- 确认 `release/win-unpacked/resources/app-update.yml` 的 `provider` 为 `github`、`owner` 为 `pmdaozhang`、`repo` 为 `pixmint`。
- 在 GitHub 创建对应版本 Release，上传 `Pixmint-Setup-<version>.exe`、`latest.yml`、`.blockmap`，不要重命名资产。
- 0.3.10 老用户必须先手动安装一次 0.4.0；旧版没有更新器，无法自动升级。
- 用当前版本检查线上更新源，验证“检查 → 发现新版本 → 下载进度 → 校验 → 重启安装 → 版本号变化”。
- 验证断网、更新源 404、安装包哈希不匹配三条失败路径都有中文提示，且不会进入安装。
- 更新后确认设置、密钥、历史和诊断日志保留。
- 本地回归可用 `PIXMINT_UPDATE_URL=http://127.0.0.1:<port>/` 指向 generic 测试源；测试源需同时提供 `latest.yml`、安装包和 `.blockmap`。
- 已知风险：Windows 安装包未签名会触发 SmartScreen；GitHub 国内下载速度未实测；差分下载命中未实测。
- 2026-10-27 状态：`v0.5.0` 已发布；0.4.1 → 0.5.0 在线更新验证通过；0.4.1 旧 Release 缺 blockmap，差分自动回退全量下载。

## 长截图（P7）

### 自动化

- `pnpm typecheck`
- `pnpm test`，确认 `tests/long-capture.test.ts` 覆盖匹配、拼接、固定表头、最大高度和底部 1px 裁剪
- `pnpm build`
- `node_modules\.bin\electron.cmd . --smoke-long-capture`，确认 700×3396、行号连续、表头只出现一次、页面到底停止
- `node_modules\.bin\electron.cmd . --smoke-long-capture-ui`，确认 HUD 和预览窗口正常
- `pnpm e2e:overlay`，确认 `E2E_OK`，工具栏不溢出
- `pnpm e2e:long-capture`，确认入口点击、HUD 控制、预览复制和临时文件清理通过
- `pnpm e2e:long-capture:edge`，确认 Edge 长网页输出高度大于 1000px
- `pnpm e2e:long-capture:notepad`，确认记事本长文档输出高度大于 1000px
- `$env:PIXMINT_LONG_ROWS='1000'; electron . --smoke-long-capture`，确认 20k px 结果、编码耗时和内存
- `$env:PIXMINT_LONG_MAX_HEIGHT='1200'; electron . --smoke-long-capture`，确认上限停止并保留
- 对 smoke 输出做像素扫描：除表头外不应出现整行深色横线

### 真实应用与交互

- 在 Chrome/Edge 长网页、记事本长文档、VS Code 长文件、设置页长列表各执行一次
- 覆盖层点击“长截图”到 HUD/预览，不依赖 smoke 入口
- 暂停 2 秒后继续、进行中完成、进行中取消、Esc 取消
- 预览中缩放、滚动、保存 PNG、复制到剪贴板、关闭后清理临时文件
- 125% / 150% / 200% DPI，各重复一次 5 屏测试页
- 多显示器、跨屏选区、目标窗口移动
- 不可滚动窗口、失焦窗口、UAC/受保护窗口，确认有中文错误且不生成黑图
- 30,000px / 30M 像素上限，确认停止并保留已截部分

### 已知取舍

- 为避开选区底部 1px 窗口边缘，所有采集帧统一裁掉最后 1 个物理像素行；最终长图比选区少 1px，肉眼不可见。

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
