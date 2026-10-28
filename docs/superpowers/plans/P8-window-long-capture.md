# P8 窗口长截图实施计划

状态：已完成 | 日期：2026-10-27

## 目标

在截图工具栏增加纯图标窗口长截图入口，严格按 `demos/P8-window-long-capture.html` 完成窗口选择、内容区确认、自动滚动、拼接和预览闭环。

## 实施步骤

1. 修复窗口长截图选择页类型断点，补齐 `windowLong.begin/cancel/reselect` IPC。
2. 接通截图覆盖层窗口选择器和纯图标入口。
3. 将窗口内容区读取接入 `desktopCapturer` 与 PowerShell UIA sidecar。
4. 完成显示器相对 DIP 选区、八向缩放和内容区边界约束。
5. 将用户选中窗口 hwnd 传入自动滚动流程并校验一致性。
6. 修复窗口目标 sidecar 协议和 `GetCurrentThreadId` DLL 声明。
7. 补选区纯函数单测、真实窗口 E2E、功能文档和测试用例。
8. 运行类型、单测、构建、Demo、既有覆盖层和真实窗口长截图回归。

## 文件范围

- `src/main/index.ts`
- `src/main/window-target.ts`
- `src/main/windows/window-long-selection.ts`
- `src/main/windows/overlay.ts`
- `src/main/long-capture.ts`
- `src/main/long-capture-controller.ts`
- `src/shared/api.ts`
- `src/shared/window-selection.ts`
- `src/preload/index.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/Icon.tsx`
- `src/renderer/src/overlay/Toolbar.tsx`
- `src/renderer/src/overlay/OverlayApp.tsx`
- `src/renderer/src/overlay/WindowTargetPicker.tsx`
- `src/renderer/src/overlay/window-target-picker.css`
- `src/renderer/src/long-capture/WindowLongSelectionApp.tsx`
- `src/renderer/src/long-capture/window-long-selection.css`
- `tests/window-selection.test.ts`
- `e2e-window-long.cjs`

## 验收矩阵

| 场景 | 输入 / 操作 | 结果 | 证据 |
|---|---|---|---|
| 类型检查 | `pnpm typecheck` | PASS | 退出码 0 |
| 单测 | `pnpm test` | PASS | 23 文件 / 147 用例 |
| 构建 | `pnpm build` | PASS | main、preload、renderer |
| Demo | 窗口选择、缩放、滚动、预览、错误、浅色 | PASS | Demo 校验 JSON |
| 既有覆盖层 | `e2e-overlay.cjs` | PASS | `E2E_OK` |
| 真实窗口 | Edge 长页面，窗口选择到预览 | PASS | `pnpm e2e:window-long` |
| 重新选择 | 选区页返回选择器并再次确认 | PASS | 真实窗口 E2E |

## 未覆盖

- 微信、微信读书、PDF、IDE、地图等真实用户应用。
- macOS、Linux。
- 多显示器与 125% / 150% / 200% DPI 的窗口长截图组合。
- 自绘滚动容器和一次性滚动整屏的应用。
