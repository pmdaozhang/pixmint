# Pixmint 项目规则

## 技术栈

- 壳：Electron 40
- UI：React 19 + TypeScript 7
- 构建：electron-vite 6 + Vite 8
- 测试：Vitest 5 + Playwright Electron
- 包管理：pnpm
- 打包：electron-builder

## 目录

```
src/main/          Electron 主进程
src/preload/       contextBridge IPC
src/renderer/      React 渲染层
src/shared/        跨进程共享类型与纯逻辑
tests/             Vitest 单元测试
docs/              需求、测试用例、计划、CHANGELOG、ROADMAP
playground/        已确认的 HTML 交互 Demo（只读基准）
reference/         参考资料（只读）
PRD.md             产品 PRD（只读）
```

## 命令

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
pnpm smoke:capture
pnpm smoke:overlay
pnpm e2e:overlay
pnpm e2e:pin
pnpm soak:real-overlay
pnpm soak:memory
```

## 开发纪律

- 先复述确认，再路由，再进入实现。
- 写代码前先读目标文件完整内容，列出影响范围与不修改文件。
- 改动超过 3 个文件先列计划等待确认。
- 只修改计划内文件，禁止顺手优化计划外文件。
- 不修改 `playground/`、`reference/`、`PRD.md`，除非用户明确要求。
- 每个功能必须配单测或 E2E；提交前至少运行 `pnpm typecheck`、`pnpm test`、`pnpm build`。
- 文档更新（CHANGELOG + ROADMAP）在验证通过后、Code Review 前完成。
- 迭代回顾与发布门禁以工作区根 AGENTS.md 为准；项目基线见 `docs/reviews/baseline.json`，回归映射见 `docs/regression-map.md`。红色项未清零不得发版。

## 资源与长跑验证

- 覆盖层、OCR、录制改动，提交前必须跑真实路径压测；`--smoke-overlay` 假画面只能测功能，不能作为内存结论。
- 截图按 Esc / 保存 / 复制 / 钉图关闭 / OCR 关闭分别验证；默认预算 32MB，保存/复制路径因系统文件写入和剪贴板占用分别为 48MB / 64MB，报告必须注明包含系统占用。
- 覆盖层真实路径 300 次：0 失败，p95 ≤ 500ms，private 增长 ≤ 32MB。
- 录制 3×590 秒：0 失败，无超过 1MB 的临时残留；private 增长 ≤ 64MB；结束后空闲 60 秒复测，工作集只记录不作为唯一判据。
- 以上预算为默认值，可在具体 feature 文档中调整，但不能取消。
- 内存测试必须每次使用不同截图；复用同一张图的结果无效。
- 无法通过应用代码释放的 Chromium 原生内存，必须给出进程重建兜底方案、触发阈值和用户可见代价。

## 平台约束

- Windows 使用 `desktopCapturer`，真实捕获需要普通交互桌面会话。
- macOS 需要屏幕录制权限；P2/P3 原生采集需在 Mac 实机验证。
- 不引入 GPL/AGPL 代码；第三方依赖只使用 MIT/Apache/BSD。

## UI 约束

- macOS 毛玻璃大圆角风格，Windows 用 CSS 透明与模糊模拟。
- 图标统一 24 网格线性 SVG，1.8px 描边。
- 线型下拉不显示文字，只显示线型预览。
- 手绘箭头必须使用稳定切线，不能取最后两个采样点。
