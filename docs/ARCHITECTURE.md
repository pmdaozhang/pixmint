# Pixmint 架构约束

## 目标

Windows 和 macOS 作为两个构建目标维护，而不是两个独立产品。共享业务逻辑和 React UI，平台差异收进 Provider，macOS 的重能力通过 Swift sidecar 提供。

## 分层

```text
src/shared/          纯 TypeScript：领域类型、几何、录制数学、翻译、诊断格式
src/renderer/        共享 React：截图编辑器、设置、OCR、引导
src/main/services/   业务编排：截图、录制、OCR、翻译、设置、诊断
src/main/platform/   平台 Provider：win32 / darwin
src/main/sidecar/    通用 sidecar 客户端与协议
src/main/windows/    BrowserWindow 工厂
src/main/ipc/        channel 常量、Zod 契约、按域注册
native/macos/        Swift helper：ScreenCaptureKit、Vision、Accessibility、录制
```

## 依赖规则

1. `shared` 不依赖 Electron、Node 文件系统或平台 API。
2. `renderer` 不直接调用 PowerShell、Win32、ScreenCaptureKit。
3. `main/services` 只依赖 Provider 接口，不出现 `process.platform` 分支。
4. `process.platform` 只允许出现在 `bootstrap` 和平台工厂。
5. IPC 参数必须经过运行时校验，不能直接信任渲染层。
6. 设置和密钥必须有 schema、版本和迁移；写盘必须原子化。
7. 新功能必须说明 Windows/macOS 差异；平台特有功能用 feature flag 控制。

## 跨平台策略

- Windows：保留 GDI/PowerShell/Win32 实现，逐步收进 `platform/win32`。
- macOS：Electron 共享 UI；ScreenCaptureKit、Vision、Accessibility、系统音频和录制放进 Swift sidecar。
- Windows 和 macOS helper 共用 JSON-line sidecar 协议：请求 ID、超时、重启、健康检查、版本握手。
- 不引入原生 Node addon 作为默认方案，避免 Electron ABI 和双架构重编译成本。
- macOS 首版走 Developer ID 签名 + 公证 + DMG；App Store 作为后续独立 target。

## 质量门禁

- typecheck、lint、单测、构建、smoke、平台 E2E、压测全部通过才允许发版。
- 关键路径必须有单元测试或集成测试。
- 崩溃率、覆盖层失败率、录制失败率、p95 截图耗时进入发布报告。
- 诊断数据包含平台、架构、权限状态和后端类型，但不上传用户内容。
