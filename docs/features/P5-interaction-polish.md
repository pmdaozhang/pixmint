# 功能：交互完善

编号：P5 | 状态：已实现 | 版本：v3

## 需求描述

- OCR 和翻译在主进程识别期间需要可见反馈：识别超过 150ms 时显示“识别中...”toast，完成或失败后消失；翻译阶段不再单独提示“翻译中...”。
- GIF / 视频点击开始录制后，红框、选区遮罩和冻结画面不能先消失再出现；只在真正开始录制时切换到实时桌面一次。
- 钉图窗口按空格进入编辑模式，图片下方显示截图工具栏的精简版：矩形/椭圆、箭头、马赛克、文字、序号、左箭头撤销、右箭头重做、对勾完成。
- 对勾把原图和标注合成后写回当前钉图窗口并退出编辑；Esc 放弃本次编辑。
- 截图选区完成后默认进入“移动选区”状态，不自动选中矩形工具；光标使用与钉图一致的抓取手型。
- 在选区内按住鼠标可拖动整块截取区域，选区尺寸保持不变，并夹在屏幕范围内。
- 工具栏提供“移动选区”按钮，可随时从绘制工具切回拖动状态。
- 钉图窗口保持最上层，切换到其他软件后不能被压到下层。

## 设计决策

- OCR toast 使用独立无焦点小窗口，不依赖 Windows 通知，不抢焦点、不阻塞桌面。
- 延迟 150ms 再显示 toast，避免短 OCR 任务闪一下。
- 录制准备阶段保留冻结画面、红框和遮罩，避免桌面闪；权限提示场景后续在 macOS 实机单独处理。
- 录制模式切换必须幂等：状态每 100ms 更新，但只在 active/interactive 真正变化时调整窗口置顶、透明度和鼠标穿透。
- 钉图编辑直接复用 `Toolbar` 和 `AnnotationCanvas`，只增加 `variant="pin"`，不另做一套标注实现。
- 编辑时钉图窗口向下扩展，退出时恢复原 bounds；工具栏宽度按现有 739px 预留。
- 新增 `move` 工具表示选区拖动，不用空值/布尔开关，避免工具状态和二级菜单出现隐式分支。
- `AnnotationCanvas` 在 `move` 下不接管指针事件，选区拖动统一由 `useOverlaySelection` 处理；绘制工具仍走原标注链路。
- 拖动光标提升到窗口根层（`dragging` / `dragging-selection`），避免指针落到内层元素时丢失抓取状态。
- 钉图使用 `screen-saver` 置顶级别，并在窗口失焦/重新显示时重新断言 TOPMOST 与 `moveTop()`。

## 验收标准

- [x] OCR/翻译识别超过 150ms 显示“识别中...”，完成后消失。
- [x] GIF 准备/倒计时/录制阶段红框和遮罩稳定，控制条计时正常。
- [x] 视频录制准备阶段不再出现蒙版消失/重现，录制中不反复闪烁。
- [x] 真实截图录制 2 秒 GIF/视频，逐帧差异无闪帧。
- [x] 覆盖层渲染进程崩溃时自动隐藏/销毁覆盖层，鼠标穿透恢复，不锁死桌面。
- [x] 视频 + 系统音一次 `getUserMedia` 获取，录制不再崩溃，文件包含音频轨。
- [x] 钉图空格进入编辑，工具栏包含指定工具、文字工具和左右箭头。
- [x] 工具二级菜单可用。
- [x] 对勾保存编辑后的图并退出，窗口 bounds 恢复。
- [x] Esc 退出编辑不写回。
- [x] 截图完成后默认选中“移动选区”，矩形工具不再默认激活。
- [x] `move` 状态下画布光标为 `grab`，按住选区拖动时切换为 `grabbing`，松开恢复 `grab`；位置变化、尺寸不变。
- [x] 截图选区拖动全程保持 `grabbing`，移动到选区边缘或画布外不回落为箭头。
- [x] 钉图窗口按住拖动全程保持 `grabbing`，松开恢复 `grab`。
- [x] 点击矩形/箭头/马赛克/文字/序号后，原有标注能力保持不变。
- [x] 钉图窗口在切换其他应用后仍保持最上层。

## 变更记录

| 日期 | 版本 | 变更 | 原因 |
|---|---|---|---|
| 2026-10-22 | v1 | OCR toast、录制启动状态、钉图空格编辑 | 交互完善 |
| 2026-10-25 | v2 | 默认十字移动选区、选区拖动、钉图置顶修复 | 选区交互与钉图层级问题 |
| 2026-10-25 | v3 | 移动选区改用与钉图一致的 `grab` / `grabbing` 手型；修复拖动中回退为张开手或箭头 | 拖拽手感统一 |

## 关联文件

- `src/main/windows/status-toast.ts`
- `src/main/index.ts`
- `src/main/windows/pin.ts`
- `src/preload/index.ts`
- `src/shared/api.ts`
- `src/shared/types.ts`
- `src/renderer/src/overlay/OverlayApp.tsx`
- `src/renderer/src/overlay/overlay.css`
- `src/renderer/src/overlay/options.ts`
- `src/renderer/src/overlay/Toolbar.tsx`
- `src/renderer/src/overlay/AnnotationCanvas.tsx`
- `src/renderer/src/overlay/useOverlaySelection.ts`
- `src/renderer/src/overlay/selection-geometry.ts`
- `src/renderer/src/components/Icon.tsx`
- `src/renderer/src/pin/PinApp.tsx`
- `src/renderer/src/pin/pin.css`
- 测试：`tests/selection-geometry.test.ts`、`e2e-overlay.cjs`、`e2e-pin.cjs`
