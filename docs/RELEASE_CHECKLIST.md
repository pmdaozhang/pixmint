# Pixmint 发版检查单

## 自动门禁（CI）

- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm build`
- `pnpm soak:overlay`（200 次，假画面，只验证功能与基础预算）
- 打包后确认 `resources/ocr` 含 PP-OCRv5 det/rec 模型和字典
- 用打包后的 `Pixmint.exe --smoke-ocr-file` 识别混排测试图，确认 `OCR_BACKEND paddle`

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
