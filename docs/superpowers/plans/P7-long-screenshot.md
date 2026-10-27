# P7 长截图 · 实施计划

> 上游：`docs/features/P7-long-screenshot.md`  
> 目标版本：0.5.0  
> 代码基线：本地 `0ab0553`（0.4.1）。`origin/feat/stability-foundation` 仍在 `1723a57`，本地领先 4 个提交；不要切回 origin 版本。  
> 说明：Superpowers 流程 skill 当前不可用，采用等价手动流程：需求澄清、方案对比、失败用例、验证矩阵。

## 0. 前置与设计确认

- [x] 确认 v1 只做 Windows 自动滚动拼接
- [x] 确认从当前滚动位置向下截取，不强制回到顶部
- [x] 确认最大 30M 像素 / 30,000px 高度
- [x] 确认 v1 不做长图 OCR、钉图、浏览器 CDP 全页截图
- [x] 先出 `demos/P7-long-screenshot.html`，展示工具栏入口、进度 HUD、预览窗口和错误状态
- [ ] Demo 确认后再改生产代码

## 1. 类型、IPC 与状态机

- [x] `OverlayAction` 增加 `'long'`
- [x] `Toolbar` 的 `onAction` 类型增加 `'long'`
- [x] 新增 `LongCapturePhase`、`LongCaptureProgress`、`LongCaptureResult`、`LongCapturePreviewInfo`
- [x] 新增 `window.snapglass.longCapture` API：
  - `getState()`
  - `pause()`
  - `resume()`
  - `finish()`
  - `cancel()`
  - `onProgress()`
  - `previewInfo()`
  - `savePreview()`
  - `copyPreview()`
  - `closePreview()`
- [x] 启动入口复用 `overlay.complete({ action: 'long' })`，不新增独立 start IPC
- [x] 主进程 IPC：`long-capture:state/pause/resume/finish/cancel/progress/preview-info/save-preview/copy-preview/close-preview`
- [x] 状态：`idle`、`preparing`、`scrolling`、`capturing`、`matching`、`paused`、`finished`、`error`、`cancelled`

## 2. Windows 滚动驱动

- [x] 新增 `src/main/long-capture/scroll-driver.ts`
- [x] 复用 `SidecarClient`，常驻 PowerShell + `Add-Type` C#
- [x] helper 支持：
  - `target,x,y`：返回窗口句柄、类名、窗口矩形
  - `scroll,hwnd,x,y,notches`：置前、移动指针、`SendInput` 滚轮
  - `restore,x,y`：恢复用户鼠标位置
- [x] 滚动前强制置前：`SetForegroundWindow` + `AttachThreadInput` + `SwitchToThisWindow` 兜底
- [x] 滚动后校验窗口句柄未变化（主进程会话实现）
- [x] helper 返回明确错误：`error:window` / `error:foreground` / `error:cursor` / `error:sendinput`
- [ ] 真实 UAC/受保护窗口实测
- [x] 预热 helper，避免首次长截图等待 C# 编译
- [x] 真机验证：临时 always-on-top Electron 窗口，标题 `Pixmint Scroll Driver Test`；`-5` 滚轮使 `scrollY` 从 0 到 600，`+5` 回到 100；cursor restore 返回 ok

## 3. 匹配与拼接纯逻辑

- [x] 新增 `src/shared/long-capture.ts`
- [x] `FrameImage` / `matchVerticalOverlap` / `LongCaptureStitcher`
- [x] BT.601 灰度降采样
- [x] 底部条带 SAD 匹配 + 期望偏移惩罚
- [x] 整帧近似相同检测，避免“没滚动也拼出偏移”
- [x] 完整重叠区二次验证，淘汰重复纹理的局部误匹配
- [x] 采集帧统一裁掉底部 1px 窗口边缘（`trimCaptureEdgeRow`），保证首帧/后续帧尺寸一致
- [x] 匹配时裁掉左右 24px（`cropFrameHorizontal`），避免移动滚动条污染整行哈希
- [x] 固定表头检测：
  - 比较前三帧顶部若干行
  - 完全一致时标记固定区域
  - 后续帧跳过固定区域
- [x] 最大像素/高度校验
- [x] `tests/long-capture.test.ts`：
  - [x] 已知偏移
  - [x] 小噪声
  - [x] 固定表头
  - [ ] 固定底栏（v1 边界场景，尚未实现）
  - [x] 低置信度
  - [x] 最大高度
  - [x] 采集帧底部 1px 裁剪（尺寸一致、单行帧不越界）

## 4. 主进程长截图会话

- [x] 新增 `src/main/long-capture.ts`
- [x] 输入：`display`、选区；首帧由管理器从屏幕重新采集，保证和后续帧一致
- [x] 隐藏覆盖层并显示不覆盖选区的进度 HUD
- [x] 循环：滚动 → 等待稳定帧 → `fastCapture.capture(physicalRect)` → 匹配 → 追加
- [x] 自适应滚动步长（1 格起步，按实测像素/格调整）
- [x] 连续无变化/低置信度/失焦/上限时停止
- [x] 首屏滚动过大时回滚并尝试半格/键盘小步重试，失败时给出可操作提示
- [x] 暂停/继续/取消/完成
- [x] 临时 PNG 写入 `app.getPath('temp')`
- [x] 诊断日志：滚动次数、偏移、置信度、帧数、输出尺寸
- [x] 退出/取消时恢复鼠标位置，取消时清理临时文件
- [x] smoke：`--smoke-long-capture` + 独立 always-on-top fixture 窗口
- [x] smoke 实测：700×3396，行号 1..160 连续，固定表头只出现一次，offset 100/300/62，页面到底后停止
- [x] 接缝像素扫描：除表头 13–20 行外无深色横线

## 5. 覆盖层与进度 HUD

- [x] `Icon.tsx` 增加 `long` 图标
- [x] `Toolbar.tsx` 增加“长截图”图标按钮
- [x] `OverlayApp.tsx` 的 `onAction` 处理 `'long'`
- [x] 长截图首帧不包含标注和覆盖层（manager 在覆盖层隐藏后重新采集）
- [x] 进度 HUD 不覆盖选区，不抢焦点（showInactive + 角落避让）
- [x] 支持暂停/继续/完成/取消
- [x] Esc 取消
- [x] 覆盖层 E2E 通过，工具栏宽度 811px；1920 视口不溢出，860px 极窄视口未单独实测

## 6. 预览窗口

- [x] 新增 `src/main/windows/long-capture-preview.ts`
- [x] 新增 `src/renderer/src/long-capture/LongCapturePreviewApp.tsx`
- [x] 预览支持缩放、滚动
- [ ] 拖动平移（当前用滚动条/滚轮）
- [x] 保存 PNG（代码路径已接入，未自动化点击对话框）
- [x] 复制到剪贴板（代码路径已接入，未自动化点击）
- [x] 关闭时清理临时文件
- [ ] 超长图分块/降采样预览（当前直接 img 渲染）
- [x] `snapglass-media` 协议允许长图临时文件

## 7. 测试与验证

- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `--smoke-long-capture-ui` + Playwright：真实 HUD/预览窗口，700×3396，297,504 字节
- [x] 单测：匹配、拼接、固定表头、最大高度、底部 1px 裁剪（`tests/long-capture.test.ts` 14 个用例）
- [x] 覆盖层 E2E：`pnpm e2e:overlay`，E2E_OK，工具栏宽度 811px
- [x] 带移动滚动条的 fixture：700×3396，完整拼接
- [x] E2E：`e2e-long-capture.cjs`（`pnpm e2e:long-capture`）
  - [x] 入口点击、HUD、暂停/继续/完成/取消
  - [x] 预览缩放、复制、关闭后临时文件清理
  - [x] 本地测试页：行号、固定表头、静态图片、代码块、深色主题（smoke）
  - [ ] 网络懒加载图片
  - [x] 5 屏、10 屏、20k px（12 屏 smoke + 20k smoke）
  - [ ] 125% / 150% / 200% DPI（用户要求不测）
  - [x] 不可滚动窗口
- [x] 真实应用：
  - [x] Chrome / Edge 长网页（700×3235）
  - [x] 记事本长文档（700×13908）
  - [ ] VS Code 长文件（现有会话阻塞）
  - [ ] 设置页长列表（滚动 helper 排除自身 PID，不作为目标）
- [x] 回归：截图/覆盖层、OCR、翻译、GIF/视频、设置、钉图；更新检查未单独重跑

## 8. 文档与门禁

- [x] 更新 `docs/CHANGELOG.md`
- [x] 更新 `docs/ROADMAP.md`
- [x] 更新 `docs/RELEASE_CHECKLIST.md`
- [x] 更新 `docs/regression-map.md`
- [x] 更新 `docs/test-cases/P7-long-screenshot.md`（记录 1px 接缝覆盖范围）
- [x] 生成 `docs/reviews/iteration-20261027-1125-v0.5.0.md/.json`
- [x] 运行 `node ../scripts/review/release-gate.mjs --project .`（PASS，conditional，0 红、3 黄）

> 门禁结果：`docs/reviews/iteration-20261027-1125-v0.5.0.json`，结论 `conditional`；未实测项见报告黄色项。

## 9. 发布

- [x] 打包 `Pixmint-Setup-0.5.0.exe`（119,467,109 字节）
- [x] 验证 `latest.yml`、`.blockmap`（版本 0.5.0，文件名一致）
- [x] GitHub Release `v0.5.0`（https://github.com/pmdaozhang/pixmint/releases/tag/v0.5.0）
- [x] 0.4.1 → 0.5.0 应用内更新（差分因旧版 blockmap 404 回退全量，安装成功）
- [x] 0.5.1 GitHub Release 与在线更新（差分 61 块 / 约 1.2MB / 1%）
- [x] 0.5.2 GitHub Release 与在线更新（差分 51 块）
- [x] 0.6.0 手动滚动模式（自动失败后一键切换；smoke 700×2934）
- [ ] 0.6.0 GitHub Release 与在线更新

## 文件清单

**新增**

- `src/main/long-capture.ts`
- `src/main/long-capture-controller.ts`
- `src/main/long-capture/scroll-driver.ts`
- `src/main/windows/long-capture-hud.ts`
- `src/main/windows/long-capture-preview.ts`
- `src/renderer/src/long-capture/LongCaptureHudApp.tsx`
- `src/renderer/src/long-capture/LongCapturePreviewApp.tsx`
- `src/renderer/src/long-capture/long-capture-hud.css`
- `src/renderer/src/long-capture/long-capture-preview.css`
- `src/shared/long-capture.ts`
- `tests/long-capture.test.ts`
- `scripts/long-capture-fixture.cjs`
- `demos/P7-long-screenshot.html`
- `docs/features/P7-long-screenshot.md`
- `docs/test-cases/P7-long-screenshot.md`
- `docs/superpowers/plans/P7-long-screenshot.md`

**修改**

- `src/shared/types.ts`
- `src/shared/api.ts`
- `src/preload/index.ts`
- `src/main/index.ts`
- `src/renderer/src/overlay/Toolbar.tsx`
- `src/renderer/src/overlay/OverlayApp.tsx`
- `src/renderer/src/components/Icon.tsx`
- `src/renderer/src/App.tsx`
- `src/main/windows/overlay.ts`
- `docs/CHANGELOG.md`
- `docs/ROADMAP.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/regression-map.md`

## 依赖与取舍

- 不新增 npm 运行时依赖。
- 优先用 Electron `nativeImage` 做 PNG 解码/编码，BGRA Buffer 做拼接。
- 如果 `nativeImage` 在 20k px 以上不稳定，回退到 `fast-png`，并把 `fast-png` 从 devDependency 提升到 dependencies。
- 滚动 helper 使用 PowerShell + C#，不引入 `robotjs` / `nut.js`。
- 结果用临时 PNG 文件 + `snapglass-media` 协议，避免大字节 IPC。

## 性能预审

```text
成本模型：每帧采集 50–120ms，匹配 5–20ms，拼接 10–30ms，最终 PNG 编码 1–3s（20k px 参考值）。总时间由帧数和滚动等待主导。
基线 / 主导项：F1 到覆盖层 p95 250ms；长截图无基线。滚动等待和逐帧采集是主导项。
杠杆 / 收益 / 风险：只截选区、降采样匹配、增量拼接、限制帧数/像素、nativeImage 编码。
取舍 / 用户默认值：自动滚动 + 暂停/取消；30M 像素上限；PNG；不做 OCR/钉图。
预算 / 待验证假设：10 屏 < 20s；20k px 编码 < 10s；额外内存 < 256MB；SendInput 在目标应用可用。
```

## 风险

- 部分应用忽略合成滚轮。
- 固定表头/底栏和动态内容导致误判。
- UAC/DRM/受保护内容无法截取。
- 长图 PNG 体积大，编码和预览内存高。
- PowerShell helper 首次启动慢，需要预热。
- 工具栏新增按钮在 860px 最小宽度下可能拥挤。
- `nativeImage` 超大尺寸上限未验证。

## 已确认（2026-10-27）

1. v1 只做 Windows 自动滚动，不做浏览器 CDP 全页截图。
2. 接受从当前滚动位置向下截取，不强制回到顶部。
3. 长图上限 30M 像素 / 30,000px。
4. v1 只做保存/复制，不做长图 OCR 和钉图。
5. 代码基于本地最新 `0ab0553`（0.4.1）；功能版本按 0.5.0。远端 `origin/feat/stability-foundation` 仍在 `1723a57`，0.4.1 尚未推送。
