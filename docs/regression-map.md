# Pixmint 回归映射

维护方式：新增模块、功能、测试或手工验收路径时同步更新；每次回顾按变更文件反查受影响功能。

| 模块/路径 | 影响的功能 | 关联自动化测试 | 手工验收路径 |
|---|---|---|---|
| `src/main/index.ts` | 应用启动、单实例、IPC 注册、更新器初始化、全局快捷键、托盘生命周期、窗口长截图编排 | `e2e-overlay.cjs`、`e2e-settings.cjs`、`e2e-window-long.cjs` | 启动应用；按快捷键截图；从托盘显示/隐藏/退出；窗口长截图全流程 |
| `src/main/capture.ts`、`src/main/fast-capture.ts` | 屏幕采集、多屏与 DPI 适配 | `e2e-overlay.cjs` | 在 125%/150%/200% 缩放和多屏下各截一次 |
| `src/main/windows/overlay.ts` | 覆盖层窗口、框选、Esc 取消、保存/复制入口 | `e2e-overlay.cjs` | 框选后分别保存、复制、Esc 取消 |
| `src/renderer/src/overlay/**` | 标注画布、工具栏、箭头、文字、马赛克、撤销重做 | `annotation-utils.test.ts`、`arrow-geometry.test.ts`、`mosaic-options.test.ts`、`e2e-overlay.cjs` | 每种工具绘制一次；撤销/重做；文字二次编辑 |
| `src/main/recording.ts`、`src/renderer/src/recorder/**` | GIF/视频录制、系统音频、暂停与结束 | `recording.test.ts`、`gif-encoder.test.ts`、`e2e-recording.cjs` | 录制 10 秒 GIF 和视频；检查音频轨；结束并保存 |
| `src/main/ocr/**`、`src/renderer/src/ocr/**` | PaddleOCR、Windows OCR 兜底、多行结果拼接 | `ocr-queue.test.ts`、`paddle-ocr.test.ts`、`windows-ocr.test.ts`、`e2e-ocr.cjs` | 选中中英混排、路径、版本号各识别一次 |
| `src/main/translation*`、翻译弹框 | OCR 翻译、方向选择、长文本滚动 | `translation.test.ts`、`e2e-ocr-translate.cjs` | 中英各一段；切换 CN→EN / EN→CN；检查长文本滚动 |
| `src/main/window-target.ts`、`src/main/windows/window-long-selection.ts`、`src/shared/window-selection.ts`、`src/renderer/src/long-capture/WindowLongSelectionApp.tsx` | 窗口枚举、窗口内容区、实时选区、八向缩放、重新选择 | `window-selection.test.ts`、`e2e-window-long.cjs` | 选择 Edge/IDE/PDF 窗口；拖动八个手柄；重选；取消 |
| `src/main/long-capture.ts`、`src/main/long-capture-controller.ts`、`src/renderer/src/overlay/WindowTargetPicker.tsx`、`src/renderer/src/overlay/Toolbar.tsx` | 自动/手动长截图、窗口选择入口、HUD、边界、自动滚动与拼接预览 | `long-capture.test.ts`、`e2e-window-long.cjs`、Demo 校验脚本 | 窗口长截图至少 2 屏；暂停/继续/回退/完成；检查预览与临时文件清理 |
| `src/main/pin-state.ts`、`src/main/windows/pin.ts`、`src/renderer/src/pin/**` | 钉图、缩放、标注、关闭 | `pin-state.test.ts`、`e2e-pin.cjs` | 钉图后缩放、标注、关闭；重启应用检查残留 |
| `src/main/settings-store.ts`、`src/main/settings-utils.ts`、`src/renderer/src/settings/**` | 设置读写、schema 迁移、设置窗口 | `settings-utils.test.ts`、`e2e-settings.cjs` | 修改设置后重启，确认保留；用旧设置文件验证迁移 |
| `src/main/updater.ts`、`src/shared/update.ts`、`src/preload/index.ts`（updater IPC）、`src/renderer/src/settings/SettingsApp.tsx` | 应用内检查、下载、校验、静默安装、更新状态展示 | `update.test.ts`、`e2e-settings.cjs`、本地 generic 0.4.0 → 0.4.1 E2E | 设置页检查更新；本地源下载安装；断网 / 404 / 哈希失败；重启后版本与设置 |
| `electron-builder.yml`、`release/latest.yml`、`resources/app-update.yml` | 更新源、安装包命名、发布产物 | `release-gate.mjs`、手工产物检查 | 构建后核对 `latest.yml` 与 Setup 文件名、`.blockmap`、`app-update.yml` |
| `src/main/tray.ts`、`src/main/tray-icon.ts` | 托盘图标、菜单、版本提示 | 无自动化 | 托盘右键菜单；双击恢复窗口；退出进程 |
| `src/main/security.ts`、`src/main/secret-store.ts` | 权限边界、密钥存储、敏感数据 | `security.test.ts` | 检查密钥不落明文；确认渲染层无越权 IPC |
| `src/main/crash-report.ts`、`src/main/diagnostics-export.ts` | 崩溃上报、诊断导出 | `diagnostics-utils.test.ts` | 触发诊断导出；检查日志脱敏 |
| `src/main/windows/onboarding-window.ts`、`src/renderer/src/onboarding/**` | 首次引导、权限说明 | `e2e-onboarding.cjs` | 清空用户数据后首次启动，走完引导 |
| `src/shared/**` | 跨进程类型与纯逻辑 | 各单元测试 | `pnpm typecheck` |
| `assets/ocr/**` | 离线 OCR 模型与字典 | `paddle-ocr.test.ts` | 断网后识别中英混排 |
| `package.json`、`electron-builder.yml`、`packaging/**` | 构建、安装包、发布门禁 | 无自动化 | 安装、卸载、覆盖安装；运行 `pnpm package` 验证门禁 |

## 维护规则

- 删除模块时保留历史行并标注“已移除”，不要直接删掉。
- 没有自动化测试的功能必须写出手工验收路径，否则视为测试债务。
- 修改公共 IPC 或数据格式时，同时更新本表和相关需求文档。
