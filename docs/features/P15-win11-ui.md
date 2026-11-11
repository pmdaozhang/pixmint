# 功能：Windows 11 风格界面

编号：P15 | 状态：已实现 | 版本：v1

## 需求描述

- 撤掉毛玻璃换肤，界面改为 Windows 11 风格。
- 覆盖范围：设置、截图覆盖层工具栏、OCR 弹框、钉图操作条、录屏控制/预览、购买、反馈、引导、更新弹框。
- 保留上一轮的纯图标工具栏，以及工具条与选区 10px 间距。

## 设计决策

- 新增 `src/renderer/src/styles/win11.css`，在 `tokens.css`、`global.css` 之后加载；通过 token 覆盖和窗口表面选择器实现，不改 JSX。
- 实底 Fluent 表面：浅色 `#f3f3f3` 窗口 + `#ffffff` 卡片；深色 `#202020` 窗口 + `#2b2b2b` 卡片；细边框、轻阴影。
- Windows 11 强调色 `#0067c0`；深色主题文字/图标使用 `#4cc2ff`，主按钮仍为 `#0067c0` 白字。
- 覆盖层工具条使用实底 `--bg-2`，压在任意截图上都能保持图标对比度。
- 不使用 `backdrop-filter` 和半透明渐变，避免之前玻璃方案在深色桌面上发灰、图标看不清的问题。
- 圆角保持原有 12px，不改成 Win11 的 8px；如后续需要，单独立项调整。

## 约束

- 不改 `width / height / padding / margin / font-size / border-width / border-radius`。
- 不改窗口创建参数、React 结构、IPC 和业务逻辑。

## 验收标准

- [x] 尺寸基线与改前一致：`settings-root` 860×660、`settings-header` 858×73、`card` 810×113、`tooldock` 502×38、`tb/act` 30×30、`ocr-root` 620×168、`ocr-copy` 72×32。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test`：34 个文件、199 个用例全部通过。
- [x] `pnpm build` 通过。
- [x] `e2e-overlay.cjs`、`e2e-pin.cjs`、`e2e-overlay-ocr.cjs` 通过。
- [x] 工具条与选区上下两种位置实测 10px；工具条宽高 502×38。
- [x] 截图检查设置、覆盖层、OCR、购买、反馈、引导、更新弹框。

## 变更记录

| 日期 | 版本 | 变更 | 原因 |
|---|---|---|---|
| 2026-11-11 | v1 | 撤掉毛玻璃，改为 Windows 11 实底风格；保留纯图标工具栏和 10px 间距 | 玻璃方案在深色桌面上对比度不足，用户确认改用 Win11 风格 |

## 关联文件

- `src/renderer/src/styles/win11.css`
- `src/renderer/src/main.tsx`
- `src/renderer/src/overlay/OverlayApp.tsx`（10px 间距）
