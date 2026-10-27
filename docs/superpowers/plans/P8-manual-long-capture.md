# P8 手动长截图实施计划

状态：Phase 0 完成，Phase 1 待开始 | 更新：2026-10-27

## 目标

把“用户框选固定区域后自己滚动，工具连续采帧并拼成一张长图”做成默认长截图路径。它不是 P7 自动模式的补丁，而是把采集、匹配、HUD 和失败处理重新按“不要求用户控速”设计。

本计划按完整功能推进，不拆成可降级的 MVP；下面的顺序是依赖顺序，每一步都是同一功能的必要验证门。

## 约束

- Windows 优先；macOS/Linux 不在本轮。
- 手动模式不找窗口句柄、不注入滚轮、不依赖 UIA。
- 每帧不使用 PNG/base64；只在最终输出时编码。
- 自动模式保留，但不能静默发布残缺图。
- 涉及文件超过 3 个，实施时按本清单执行，不顺手改计划外文件。
- 不修改 `playground/`、`reference/`、`PRD.md`。

## Phase 0：采集 spike 与 Demo（已完成）

### 产出

- `scripts/spike/gdi-capture-bench.ps1`
- `scripts/spike/electron-capture-bench.cjs`
- `scripts/spike/electron-capture-bench.html`
- `scripts/spike/verify-p8-demo.cjs`
- `demos/P8-manual-long-capture.html`
- `test-results/p8-demo-*.png`
- `docs/features/P8-capture-bench.md`
- `docs/features/P8-capture-bench.json`

### 结论

- GDI 原始帧：700×600 约 60fps，1080p 约 21fps，4K 估约 15fps；采集本身足够。
- GDI PNG：1080p 约 11fps，PNG 编码是明确瓶颈。
- Electron 视频流：多次样本约 12–20fps，p95 约 81–107ms；可作为备选，但不适合按 30fps 规划。
- 不引入 WGC；下一道门是 PowerShell→Node 的原始帧传输。

## Phase 1：采集传输与手动核心链路

### 任务

1. 新增 `src/main/long-capture/frame-source.ts`，定义帧源接口、GDI 原始帧实现和 Electron 视频流备选实现。
2. 新增二进制传输 spike：把 700×600 和 1920×1080 原始 BGRA 从 sidecar 传到主进程，测端到端帧率；不达标再评估 WGC。
3. 改造 `src/main/long-capture.ts` 的 `startManual`：
   - 去掉“连续两帧近似相同才尝试”的门槛；
   - 每帧都尝试匹配上一张已接受帧；
   - 失败不推进上一张已接受帧，保持会话；
   - 记录采集 fps、接受/拒绝原因、offset/confidence。
4. 扩展 `src/shared/long-capture.ts`：
   - 预期偏移；
   - 反向滚动检测；
   - 动态滚动条遮罩；
   - 固定表头/底栏；
   - `LongCaptureStitcher.undoLast()`。
5. 新增 `tests/long-capture-frame-source.test.ts`；扩展 `tests/long-capture.test.ts`。

### 验证门

- 700×600@10fps 端到端采集 ≥ 9fps，单帧 p95 ≤ 100ms。
- 1920×1080@10fps 端到端采集 ≥ 8fps，或明确降级策略。
- 变速 fixture 200–2000px/s 连续滚动，无缺失/重复。
- 跳变不推进上一张已接受帧，回滚后可继续。

## Phase 2：入口与 HUD

### 任务

1. `src/renderer/src/overlay/Toolbar.tsx`：手动模式默认入口，自动模式可选。
2. `src/main/long-capture-controller.ts`：手动直接启动；自动失败/假成功一键切手动。
3. `src/main/windows/long-capture-hud.ts`：HUD 不抢焦点，位置在选区外，支持全局热键。
4. `src/renderer/src/long-capture/LongCaptureHudApp.tsx` 和 CSS：
   - 跟随中、跳变、暂停、完成；
   - 回退一屏；
   - “正常滚动即可”文案；
   - 无滚动、失焦、遮挡提示。
5. `src/shared/types.ts`、`src/shared/api.ts`、`src/preload/index.ts`：新增 IPC。
6. 以 `demos/P8-manual-long-capture.html` 为基准集成，不改视觉方向。

### 验证门

- 手动入口不依赖自动模式失败。
- 自动模式中途 `overlapLost` 不再直接预览残缺图。
- 完成/取消/回退/暂停都有真实 UI 路径和 E2E。

## Phase 3：边界与质量

### 任务

1. 固定表头/底栏、滚动条、反向滚动、输入框光标、视频/动画。
2. 目标窗口遮挡/失焦、鼠标在选区外、无变化。
3. 30k px / 30M px 上限、内存和临时文件清理。
4. 保存/复制/预览路径回归。

### 验证门

- fixture 覆盖所有边界；
- 真实应用至少覆盖 Edge/Chrome、VS Code、记事本、微信/QQ、PDF、Excel；
- 125%/150%/200% DPI、双屏分别验证；
- 资源路径按完成/取消/保存/异常退出分别跑。

## Phase 4：验收、文档与回顾

### 任务

1. 用户指定的失败应用复现并通过。
2. 性能与内存多次测量，写入验收矩阵。
3. 更新 `docs/CHANGELOG.md`、`docs/ROADMAP.md`、`docs/regression-map.md`。
4. 生成 `docs/reviews/iteration-YYYYMMDD-HHmm-vX.Y.Z.md` 和 `.json`。
5. 运行 `pnpm typecheck`、`pnpm test`、`pnpm build`、长截图 E2E。
6. Code Review 和分支收尾。

### 验证门

- 没有用户场景复现，不标 `pass`。
- 报告结论不为 `blocked`，红色项清零。
- 发布前运行 `node scripts/review/release-gate.mjs --project _snapglass_app`。

## 文件清单

### 新增

- `src/main/long-capture/frame-source.ts`
- `tests/long-capture-frame-source.test.ts`
- `demos/P8-manual-long-capture.html`
- `scripts/spike/gdi-capture-bench.ps1`
- `scripts/spike/electron-capture-bench.cjs`
- `scripts/spike/electron-capture-bench.html`
- `scripts/spike/verify-p8-demo.cjs`
- `docs/features/P8-manual-long-capture.md`
- `docs/features/P8-capture-bench.md`
- `docs/features/P8-capture-bench.json`
- `docs/test-cases/P8-manual-long-capture.md`
- `docs/superpowers/plans/P8-manual-long-capture.md`

### 修改

- `src/main/long-capture.ts`
- `src/shared/long-capture.ts`
- `src/main/long-capture-controller.ts`
- `src/main/windows/long-capture-hud.ts`
- `src/renderer/src/long-capture/LongCaptureHudApp.tsx`
- `src/renderer/src/long-capture/long-capture-hud.css`
- `src/renderer/src/overlay/Toolbar.tsx`
- `src/shared/types.ts`
- `src/shared/api.ts`
- `src/preload/index.ts`
- `tests/long-capture.test.ts`
- `scripts/long-capture-fixture.cjs`
- `docs/CHANGELOG.md`
- `docs/ROADMAP.md`
- `docs/regression-map.md`

### 不修改

- OCR、录制、设置、更新器、钉图、标注逻辑。
- `playground/`、`reference/`、`PRD.md`。

## 依赖关系

```text
Phase 0 采集数据
      ↓
Phase 1 二进制传输 → 手动循环 → 匹配/拼接
      ↓
Phase 2 入口/HUD/IPC
      ↓
Phase 3 边界与真实应用
      ↓
Phase 4 验收/文档/回顾
```

## 待确认

- 用户实际失败的应用/页面，作为最终验收目标。
- 4K 显示器实机验证资源（当前测试机为 1920×1080）。
