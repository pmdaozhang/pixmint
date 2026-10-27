# P8 采集性能基准

日期：2026-10-27 | 状态：Phase 0 完成 | 测试机：Windows，1920×1080，100% 缩放

## 目的

手动长截图不再要求用户停稳，采集端必须证明能持续拿到 10–15fps。本基准只回答“帧从屏幕到内存有多快”，不包含产品 IPC、匹配和最终编码。

## 方法

### GDI 原始帧 / PNG

脚本：`scripts/spike/gdi-capture-bench.ps1`

- 常驻 `System.Drawing` + `CopyFromScreen`。
- `raw` 模式：`LockBits` 后 `Marshal.Copy` 到 BGRA 字节数组。
- `png` 模式：`Bitmap.Save` 到 `MemoryStream`，统计 PNG 编码后的字节数。
- 5 帧预热；串行执行；只读屏幕到内存，不落盘。
- 10fps 模式用于看能否守住目标节奏；1000fps 模式用于看单帧成本上限。

### Electron `desktopCapturer` 视频流

脚本：`scripts/spike/electron-capture-bench.cjs`

- 隐藏 `BrowserWindow` 加载 `desktopCapturer` 提供的屏幕源。
- `requestVideoFrameCallback` 统计实际帧率。
- 可选把 700×600 或 1920×1080 区域画到 canvas 并 `getImageData`，把裁切/取像素成本算进去。
- 每个配置单独进程、单独窗口；避免连续创建/销毁采集窗口造成的状态污染。

## 结果

### GDI

| 区域 | 模式 | 目标 | 实际帧率 | 平均采集 | p95 采集 | 字节/帧 |
|---|---|---:|---:|---:|---:|---:|
| 700×600 | raw | 10fps | 9.06fps | 22.34ms | 29.39ms | 1,680,000 |
| 700×600 | png | 10fps | 9.08fps | 33.55ms | 42.36ms | 6,010（编码值） |
| 700×600 | raw | 上限 | **59.97fps** | 16.63ms | 18.96ms | 1,680,000 |
| 1920×1080 | raw | 10fps | 9.14fps | 49.38ms | 60.57ms | 8,294,400 |
| 1920×1080 | raw | 上限 | **21.48fps** | 46.51ms | 57.89ms | 8,294,400 |
| 1920×1080 | png | 上限 | **11.05fps** | 90.47ms | 108.40ms | 96,082（编码值） |
| 2560×1440 | raw | 上限 | **20.38fps** | 49.03ms | 59.85ms | 14,745,600 |
| 3840×2160 | raw | 上限 | **15.23fps** | 65.62ms | 78.10ms | 33,177,600 |

说明：测试机只有 1920×1080。2560×1440 和 3840×2160 是从屏幕左上角截取更大矩形，屏幕外区域为黑；字节拷贝成本有参考价值，但不能替代真实 4K 显示器验证。

### Electron 视频流

最终干净样本（每配置独立进程）：

| 配置 | 实际帧率 | 平均间隔 | p95 间隔 |
|---|---:|---:|---:|
| 全屏帧，不裁切 | 14.87fps | 67.26ms | 100.00ms |
| 裁切 700×600 + `getImageData` | 15.34fps | 65.19ms | 99.00ms |
| 裁切 1920×1080 + `getImageData` | 12.18fps | 82.10ms | 106.60ms |

多次样本范围：全屏 14.87–17.56fps，700×600 裁切 15.34–20.20fps，全屏裁切 12.18–19.29fps。不同轮次波动明显，p95 约 81–107ms。一次复用窗口的测试出现 `requestVideoFrameCallback` 超时；改为每配置独立进程后通过。生产采集应保持单一长生命周期采集窗口，避免频繁重建。

## 解释

1. **GDI 原始帧足够快。** 700×600 上限约 60fps，1080p 约 21fps，4K 估约 15fps；10fps 目标有 1.5–6 倍余量。
2. **PNG 是明确瓶颈。** 1080p PNG 上限只有 11fps，还没算 IPC 和匹配；逐帧 PNG/base64 不能作为新方案。
3. **Electron 视频流可作备选，但不适合按 30fps 规划。** 最好样本约 20fps，p95 接近 100ms；10fps 能跑，但抖动比 GDI raw 大。
4. **4K 仍需实机验证。** 当前 4K 是合成矩形；真实 4K 桌面的缩放、GPU 合成和窗口内容可能不同。
5. **下一道门是传输。** GDI 原始帧从 PowerShell 到 Node 的二进制传输、匹配成本还没测；这两项决定端到端能否守住 10fps。

## 决策

- **主方案：GDI 原始帧 + 二进制传输。** 先做 700×600 和 1920×1080 的端到端传输 spike；达到 ≥9fps（700×600）/ ≥8fps（1080p）再进入完整实现。
- **备选：Electron `desktopCapturer` 视频流。** 如果二进制传输不达标，但 700×600 场景可接受 15fps 左右，可用视频流作为回退。
- **暂不引入 WGC。** 当前数据没有证明必须上原生模块；如果 4K 实机、硬件加速窗口或遮挡场景失败，再评估。
- **禁止逐帧 PNG/base64。** 只在最终输出编码 PNG。

## Phase 1 传输 smoke

已实现 `RawGdiFrameSource`：独立 PowerShell/C# sidecar 输出原始 BGRA，24 字节帧头，Node 端二进制拆包。

- `--smoke-raw-frame-source` 尝试在真实桌面运行 700×600 / 1080p 的端到端传输。
- 当前会话 `CopyFromScreen` 返回“句柄无效”；同一时刻直接运行 Phase 0 GDI 基准也失败，说明是桌面会话状态（锁定/断开/窗口站）而不是编译或协议错误。
- 合成手动 smoke 已通过：700×4134，连续帧、跳变、回滚、暂停、撤销、完成正常。
- 为单独验证协议，使用 `PIXMINT_RAW_CAPTURE_SYNTHETIC=1` 跳过 GDI、保留真实 PowerShell/C# 二进制 stdout：

| 配置 | 实际帧率 | 平均耗时 | p95 | 失败 |
|---|---:|---:|---:|---:|
| 700×600，目标 10fps | 9.20fps | 10.13ms | 19ms | 0 |
| 1080p，目标 10fps | 9.06fps | 36.27ms | 47ms | 0 |
| 700×600，上限 | 133.04fps | 7.52ms | 15ms | 0 |
| 1080p，上限 | 37.97fps | 26.33ms | 39ms | 0 |

- 首次实现用 `Buffer.concat` 累积分片，1080p 只有 1.58fps；改为“先读 24 字节头、预分配整帧缓冲、逐块 copy”后达到 9.06fps。这是本轮最重要的修正。
- 传输协议门已通过；真实 GDI 采集 + 传输仍需在未锁定桌面复测。

## 未实测

- PowerShell→Node 的原始 BGRA 二进制传输。
- 匹配算法在 10fps 连续帧上的 CPU 成本。
- 真实 4K 显示器、125%/150%/200% DPI、多显示器。
- 真实应用：Edge/Chrome、VS Code、微信/QQ、PDF、Excel。
- 遮挡、UAC/受保护窗口、DRM、动态内容、懒加载。

## 复现命令

```powershell
.\scripts\spike\gdi-capture-bench.ps1 -Width 700 -Height 600 -Frames 30 -Fps 10 -Mode raw
.\scripts\spike\gdi-capture-bench.ps1 -Width 1920 -Height 1080 -Frames 30 -Fps 1000 -Mode raw
.\node_modules\.bin\electron.cmd .\scripts\spike\electron-capture-bench.cjs --config=full-frame
.\node_modules\.bin\electron.cmd .\scripts\spike\electron-capture-bench.cjs --config=crop-700x600
.\node_modules\.bin\electron.cmd .\scripts\spike\electron-capture-bench.cjs --config=crop-full-frame
node .\scripts\spike\verify-p8-demo.cjs
```

原始数据：`docs/features/P8-capture-bench.json`。
