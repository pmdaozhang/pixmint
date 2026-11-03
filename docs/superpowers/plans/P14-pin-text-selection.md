# P14 钉图文字选择与复制 · 实施计划

目标：修复短选区钉图拉伸，并让钉图文字支持鼠标选择、`Ctrl+A` 全选和 `Ctrl+C` 复制。

## 前置门控

- [x] 用户确认需求与复制能力
- [x] 已读工作区与项目 `AGENTS.md`
- [x] 已读截图裁剪、OCR、钉图主进程、钉图渲染层和现有 E2E
- [x] 已确认根因：钉图宽高分别套最小值 + `object-fit: fill`
- [x] 已确认 OCR 后端可提供文字框
- [x] 已提交性能与取舍预审
- [x] 用户确认实施计划

## 实施顺序

1. 共享类型与纯逻辑
   - [x] 新增 `OcrTextBlock`、`OcrResult.blocks`。
   - [x] 新增 OCR 坐标还原与文字行框合并函数及单测。
   - [x] 新增钉图宽高比计算函数及单测。
2. OCR 坐标
   - [x] PaddleOCR 输出文字行框。
   - [x] Windows OCR 脚本输出文字行框。
   - [x] OCR 放大后的坐标还原到原图。
3. 钉图主进程与 IPC
   - [x] 使用等比尺寸函数创建钉图。
   - [x] 增加 `pin:recognize-text` IPC 与 preload API。
4. 钉图渲染层
   - [x] 新增 OCR 文字层布局函数及单测。
   - [x] 异步 OCR、透明文字层、鼠标选择、全选、复制。
   - [x] 文字区域不触发窗口拖动；缩放后重新布局。
   - [x] OCR 失败、空结果、编辑后重识别。
5. 自动化验证
   - [x] 单测、typecheck、build。
   - [x] 钉图 E2E、新增文字选择 E2E、覆盖层 E2E。
   - [x] 连续钉图与 OCR 压测。
6. 文档与回顾
   - [x] 更新 CHANGELOG、ROADMAP、regression-map。
   - [ ] 采集 metrics，生成迭代回顾与发布门禁检查。
7. 运行交付
   - [ ] 启动 Pixmint，确认进程与主窗口存活，交由用户验收。

## 验证命令

```text
pnpm typecheck
pnpm test
pnpm build
pnpm e2e:pin
pnpm e2e:pin-text
pnpm e2e:overlay
pnpm soak:ocr
```

## 回滚方案

- 功能分支为 `codex/pixmint-pin-text`，回滚时切回原分支即可。
- OCR 文字层是增量 UI，不修改截图裁剪算法；如出现问题，可先移除文字层、保留钉图拉伸修复。
- 新增 API 和类型均有可选字段，旧 OCR 调用方不依赖新字段。
