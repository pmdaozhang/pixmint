# Pixmint 压测脚本

这些脚本用于普通交互桌面，不进入 CI。真实屏幕捕获、PowerShell OCR 和录制需要可用的桌面会话与权限。

先构建：

```bash
pnpm build
```

再运行：

```bash
pnpm soak:overlay
pnpm soak:ocr
pnpm soak:recording
```

可用环境变量：

| 变量 | 默认 | 说明 |
|---|---:|---|
| `PIXMINT_SOAK_OVERLAY_CYCLES` | 200 | 覆盖层开关轮数 |
| `PIXMINT_SOAK_OCR_ITERATIONS` | 100 | OCR 次数 |
| `PIXMINT_SOAK_RECORDINGS` | 3 | 录制次数 |
| `PIXMINT_SOAK_RECORD_SECONDS` | 10 | 每次录制秒数；正式压测设为 590，避免触发应用自动停止 |
| `PIXMINT_SOAK_RECORD_MODE` | `video` | `video` 或 `gif` |
| `PIXMINT_SOAK_MAX_P95_MS` | 500 | 覆盖层单轮 p95 上限，超过则脚本失败 |
| `PIXMINT_SOAK_MAX_PRIVATE_MB` | 256 | 覆盖层 renderer private bytes 增长上限 |
| `PIXMINT_SOAK_OCR_MAX_P95_MS` | 3000 | OCR p95 上限 |
| `PIXMINT_SOAK_OCR_MAX_RSS_MB` | 128 | OCR 进程 RSS 增长上限 |

正式录制压测示例：

```powershell
$env:PIXMINT_SOAK_RECORDINGS=3
$env:PIXMINT_SOAK_RECORD_SECONDS=590
pnpm soak:recording
```

报告写入 `test-results/`，包含：

- 失败列表
- p50 / p95 / max 耗时
- 前后内存与 Electron 进程指标
- `%TEMP%` 下残留的 `snapglass-*` / `pixmint-*` 文件

覆盖层脚本使用 `--smoke-overlay` 的假画面，不依赖真实屏幕捕获；OCR 和录制脚本需要真实权限。
