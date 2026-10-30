# Pixmint 回归映射

维护方式：新增模块、功能、测试或手工验收路径时同步更新；每次回顾按变更文件反查受影响功能。

| 模块/路径 | 影响的功能 | 关联自动化测试 | 手工验收路径 |
|---|---|---|---|
| `src/main/index.ts` | 应用启动、单实例、IPC 注册、更新器初始化、全局快捷键、托盘生命周期 | `e2e-overlay.cjs`、`e2e-settings.cjs` | 启动应用；按快捷键截图；从托盘显示/隐藏/退出 |
| `src/main/capture.ts`、`src/main/fast-capture.ts` | 屏幕采集、多屏与 DPI 适配 | `e2e-overlay.cjs` | 在 125%/150%/200% 缩放和多屏下各截一次 |
| `src/main/windows/overlay.ts` | 覆盖层窗口、框选、Esc 取消、保存/复制入口 | `e2e-overlay.cjs` | 框选后分别保存、复制、Esc 取消 |
| `src/renderer/src/overlay/**` | 标注画布、工具栏、箭头、文字、马赛克、撤销重做 | `annotation-utils.test.ts`、`arrow-geometry.test.ts`、`mosaic-options.test.ts`、`e2e-overlay.cjs` | 每种工具绘制一次；撤销/重做；文字二次编辑 |
| `src/main/recording.ts`、`src/renderer/src/recorder/**` | GIF/视频录制、系统音频、暂停与结束 | `recording.test.ts`、`gif-encoder.test.ts`、`e2e-recording.cjs` | 录制 10 秒 GIF 和视频；检查音频轨；结束并保存 |
| `src/main/ocr/**`、`src/renderer/src/ocr/**` | PaddleOCR、Windows OCR 兜底、多行结果拼接 | `ocr-queue.test.ts`、`paddle-ocr.test.ts`、`windows-ocr.test.ts`、`e2e-ocr.cjs` | 选中中英混排、路径、版本号各识别一次 |
| `src/main/translation*`、翻译弹框 | OCR 翻译、方向选择、长文本滚动 | `translation.test.ts`、`e2e-ocr-translate.cjs` | 中英各一段；切换 CN→EN / EN→CN；检查长文本滚动 |
| `src/main/pin-state.ts`、`src/main/windows/pin.ts`、`src/renderer/src/pin/**` | 钉图、缩放、标注、关闭 | `pin-state.test.ts`、`e2e-pin.cjs` | 钉图后缩放、标注、关闭；重启应用检查残留 |
| `src/main/settings-store.ts`、`src/main/settings-utils.ts`、`src/renderer/src/settings/**` | 设置读写、schema 迁移、设置窗口 | `settings-utils.test.ts`、`e2e-settings.cjs` | 修改设置后重启，确认保留；用旧设置文件验证迁移 |
| `src/main/updater.ts`、`src/shared/update.ts`、`src/preload/index.ts`（updater IPC）、`src/renderer/src/settings/SettingsApp.tsx` | 应用内检查、下载、校验、静默安装、更新状态展示 | `update.test.ts`、`e2e-settings.cjs`、本地 generic 0.4.0 → 0.4.1 E2E | 设置页检查更新；本地源下载安装；断网 / 404 / 哈希失败；重启后版本与设置 |
| `electron-builder.yml`、`release/latest.yml`、`resources/app-update.yml` | 更新源、安装包命名、发布产物 | `release-gate.mjs`、手工产物检查 | 构建后核对 `latest.yml` 与 Setup 文件名、`.blockmap`、`app-update.yml` |
| `src/main/tray.ts`、`src/main/tray-icon.ts` | 托盘图标、截图/设置/反馈/退出菜单、版本提示 | 无自动化 | 托盘右键确认“意见反馈…”位于设置与退出之间；F2/F4 不触发录制；退出进程 |
| `src/main/feedback.ts`、`src/main/windows/feedback-window.ts`、`src/renderer/src/feedback/**`、`src/shared/feedback.ts`、`src/preload/index.ts`（feedback IPC） | 反馈窗口、粘贴截图、5MB 压缩、JSON 提交、附件 multipart、离线队列、2/8/30 秒重试 | `feedback.test.ts`、`e2e-feedback.cjs` | 右键托盘打开反馈；真实截图后 `Ctrl+V`；粘贴 10 张；断网提交；恢复网络等待补发；检查后台记录与附件 |
| `docs/integrations/feedback-backend-contract.md` | 反馈后台字段、错误码、附件接口、队列与隐私契约 | `e2e-feedback.cjs` 本地 mock | 按文档联调文本、附件、400、429、503；核对统计后台可见 |
| `src/main/security.ts`、`src/main/secret-store.ts` | 权限边界、密钥存储、敏感数据 | `security.test.ts` | 检查密钥不落明文；确认渲染层无越权 IPC |
| `src/main/crash-report.ts`、`src/main/diagnostics-export.ts` | 崩溃上报、诊断导出 | `diagnostics-utils.test.ts` | 触发诊断导出；检查日志脱敏 |
| `src/main/windows/onboarding-window.ts`、`src/renderer/src/onboarding/**` | 首次引导、权限说明 | `e2e-onboarding.cjs` | 清空用户数据后首次启动，走完引导 |
| `src/renderer/src/onboarding/OnboardingApp.tsx` | 引导页序、步骤条、完成/跳过 | `e2e-onboarding.cjs` | 逐页翻看、跳过、完成后重启 |
| `src/renderer/src/onboarding/OnboardingScenes.tsx` | GIF / 视频 / OCR 动画 | `e2e-onboarding.cjs` | 各页动画与光标跟随 |
| `src/main/settings-utils.ts`、`src/main/index.ts` | 引导版本迁移与展示判断 | `tests/settings-utils.test.ts` | 旧设置升级后展示一次 |
| `src/shared/**` | 跨进程类型与纯逻辑 | 各单元测试 | `pnpm typecheck` |
| `assets/ocr/**` | 离线 OCR 模型与字典 | `paddle-ocr.test.ts` | 断网后识别中英混排 |
| `package.json`、`electron-builder.yml`、`packaging/**` | 构建、安装包、发布门禁 | 无自动化 | 安装、卸载、覆盖安装；运行 `pnpm package` 验证门禁 |

> 长截图（P7/P8）已于 2026-10-29 下线，相关源文件、单测、E2E、Demo 和专用文档已删除，不再属于回归范围。

## 维护规则

- 删除模块时保留历史行并标注“已移除”，不要直接删掉。
- 没有自动化测试的功能必须写出手工验收路径，否则视为测试债务。
- 修改公共 IPC 或数据格式时，同时更新本表和相关需求文档。
