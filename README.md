# Pixmint

![Pixmint](assets/icon.png)

跨平台截图工具：框选截图、标注、贴图、OCR 翻译、GIF/视频录制。

当前完成 **P0 截图 / P1 OCR 翻译 / P2 GIF / P3 视频基础版**：

- 多显示器透明覆盖层
- 框选 + 矩形 / 椭圆 / 线条箭头 / 马赛克 / 文字 / 序号
- 复制、保存 PNG、置顶贴图
- 托盘、全局快捷键、设置、历史记录
- OCR 识别与单词/句子翻译
- GIF 录制：10/15/30 FPS，最长 60 秒，预览、保存、复制首帧
- 视频录制：MP4 优先/WebM 回退，麦克风/系统音，暂停、预览、保存

## 开发

```bash
pnpm install
pnpm dev
```

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
pnpm e2e:overlay
pnpm e2e:pin
pnpm e2e:recording
```

## 文档

- `docs/features/P0-screenshot-foundation.md`
- `docs/features/P2-gif-recording.md`
- `docs/features/P3-video-recording.md`
- `docs/test-cases/P0-screenshot-foundation.md`
- `docs/superpowers/plans/P0-screenshot-foundation.md`
- `docs/CHANGELOG.md`
- `docs/ROADMAP.md`

## 说明

当前开发机的桌面捕获权限被系统拒绝，真实屏幕捕获需要在普通交互桌面复测；覆盖层、标注、复制、贴图链路已通过 Electron E2E。
