# P13 意见反馈实施计划

## 阶段 1：契约与纯逻辑

- [x] `src/shared/feedback.ts`：请求类型、内容/图片上限、重试间隔。
- [x] `tests/feedback.test.ts`：空内容、UUID、10 张、5MB、总大小、重试序列。

## 阶段 2：主进程

- [x] `src/main/feedback.ts`：JSON 提交、附件 multipart、离线队列、重试。
- [x] `src/main/windows/feedback-window.ts`：独立窗口与单例聚焦。
- [x] `src/main/tray.ts`：增加“意见反馈…”菜单项。
- [x] `src/main/index.ts`：实例化服务、IPC、E2E 入口、退出清理。

## 阶段 3：渲染层

- [x] `src/renderer/src/feedback/FeedbackApp.tsx`：文字、粘贴、缩略图、提交状态。
- [x] `src/renderer/src/feedback/feedback.css`：按已确认 Demo 落地。
- [x] `src/renderer/src/App.tsx`、`src/preload/index.ts`、`src/shared/api.ts`：路由与桥接。

## 阶段 4：验证与交付

- [x] `e2e-feedback.cjs`：真实剪贴板粘贴、提交、本地 mock 附件上传。
- [x] `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm e2e:feedback`。
- [x] 更新 CHANGELOG、ROADMAP、regression-map。
- [x] 输出后台对接文档，供 Claude 上线。
- [ ] 后台附件接口上线后的生产联调。

