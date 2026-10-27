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

- [ ] `OverlayAction` 增加 `'long'`
- [ ] `Toolbar` 的 `onAction` 类型增加 `'long'`
- [ ] 新增 `LongCaptureState`、`LongCaptureProgress`、`LongCaptureResult`
- [ ] 新增 `window.snapglass.longCapture` API：
  - `start()`
  - `pause()`
  - `resume()`
  - `finish()`
  - `cancel()`
  - `getState()`
  - `openResult()`
- [ ] 主进程 IPC：`long-capture:start/pause/resume/finish/cancel/get-state`
- [ ] 状态：`preparing`、`scrolling`、`capturing`、`matching`、`paused`、`finished`、`error`、`cancelled`

## 2. Windows 滚动驱动

- [x] 新增 `src/main/long-capture/scroll-driver.ts`
- [x] 复用 `SidecarClient`，常驻 PowerShell + `Add-Type` C#
- [x] helper 支持：
  - `target,x,y`：返回窗口句柄、类名、窗口矩形
  - `scroll,hwnd,x,y,notches`：置前、移动指针、`SendInput` 滚轮
  - `restore,x,y`：恢复用户鼠标位置
- [x] 滚动前强制置前：`SetForegroundWindow` + `AttachThreadInput` + `SwitchToThisWindow` 兜底
- [ ] 滚动后校验窗口句柄未变化（交给主进程会话实现）
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
- [x] 固定表头检测：
  - 比较前三帧顶部若干行
  - 完全一致时标记固定区域
  - 后续帧跳过固定区域
- [x] 最大像素/高度校验
- [x] `tests/long-capture.test.ts`：
  - 已知偏移
  - 小噪声
  - 固定表头
  - [ ] 固定底栏（v1 边界场景，尚未实现）
  - 低置信度
  - 最大高度

## 4. 主进程长截图会话

- [ ] 新增 `src/main/long-capture.ts`
- [ ] 输入：`DisplayCapture`、选区、首帧 PNG
- [ ] 隐藏覆盖层，显示不覆盖选区的进度 HUD
- [ ] 循环：滚动 → 等待稳定 → `fastCapture.capture(physicalRect)` → 匹配 → 追加
- [ ] 自适应滚动步长
- [ ] 连续无变化/低置信度/失焦/上限时停止
- [ ] 暂停/继续/取消/完成
- [ ] 临时 PNG 写入 `app.getPath('temp')` 或 userData cache
- [ ] 诊断日志：窗口类名、句柄、滚动次数、偏移、置信度、帧数、输出尺寸
- [ ] 退出/取消/关闭预览时清理临时文件

## 5. 覆盖层与进度 HUD

- [ ] `Icon.tsx` 增加 `long` 图标
- [ ] `Toolbar.tsx` 增加“长截图”图标按钮
- [ ] `OverlayApp.tsx` 的 `onAction` 处理 `'long'`
- [ ] 长截图首帧不包含标注和覆盖层
- [ ] 进度 HUD 不覆盖选区，不抢焦点
- [ ] 支持暂停/继续/完成/取消
- [ ] Esc 取消
- [ ] 860px 最小窗口宽度下工具栏不溢出

## 6. 预览窗口

- [ ] 新增 `src/main/windows/long-capture-preview.ts`
- [ ] 新增 `src/renderer/src/long-capture/LongCapturePreviewApp.tsx`
- [ ] 预览支持缩放、拖动、滚动
- [ ] 保存 PNG
- [ ] 复制到剪贴板
- [ ] 关闭时清理临时文件
- [ ] 长图超过预览上限时使用分块加载或降采样预览
- [ ] `snapglass-media` 协议允许长图临时文件

## 7. 测试与验证

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] 单测：匹配、拼接、固定表头、最大高度
- [ ] E2E：`e2e-long-capture.cjs`
  - 本地测试页：行号、固定表头、图片、懒加载
  - 5 屏、10 屏、20k px
  - 125% / 150% / 200% DPI
  - 暂停、完成、取消
  - 不可滚动窗口
- [ ] 真实应用：
  - Chrome / Edge 长网页
  - 记事本长文档
  - VS Code 长文件
  - 设置页长列表
- [ ] 回归：截图、标注、OCR、翻译、GIF/视频、设置、更新

## 8. 文档与门禁

- [ ] 更新 `docs/CHANGELOG.md`
- [ ] 更新 `docs/ROADMAP.md`
- [ ] 更新 `docs/RELEASE_CHECKLIST.md`
- [ ] 更新 `docs/regression-map.md`
- [ ] 生成 `docs/reviews/iteration-YYYYMMDD-HHmm-v0.5.0.md/.json`
- [ ] 运行 `node ../scripts/review/release-gate.mjs --project .`

## 9. 发布

- [ ] 打包 `Pixmint-Setup-0.5.0.exe`
- [ ] 验证 `latest.yml`、`.blockmap`
- [ ] GitHub Release `v0.5.0`
- [ ] 0.4.1 → 0.5.0 应用内更新

## 文件清单

**新增**

- `src/main/long-capture.ts`
- `src/main/long-capture/scroll-driver.ts`
- `src/main/windows/long-capture-overlay.ts`
- `src/main/windows/long-capture-preview.ts`
- `src/renderer/src/long-capture/LongCapturePreviewApp.tsx`
- `src/shared/long-capture.ts`
- `tests/long-capture.test.ts`
- `e2e-long-capture.cjs`
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
