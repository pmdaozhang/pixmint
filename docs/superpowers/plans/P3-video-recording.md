# P3 视频录制 · 实施计划

> 上游：`docs/features/P3-video-recording.md`  
> 目标版本：0.3.0

## 1. 类型与 IPC

- [x] `RecorderMode`、`RecorderOptions`、`VideoDoneMeta`、`RecorderPreviewInfo`
- [x] `recorder` / `recorderControl` / `recorderPreview` preload API
- [x] 主进程录制管理器和临时文件写盘

## 2. 采集与编码

- [x] `desktopCapturer` + `getUserMedia` 屏幕流
- [x] Canvas 裁切与尺寸缩放
- [x] `canvas.captureStream(30)` + `MediaRecorder`
- [x] MP4 优先、WebM 回退
- [x] 麦克风 / 系统音合并
- [x] 分块 IPC 写入临时文件
- [x] 暂停 / 继续 / 10 分钟上限

## 3. 窗口与交互

- [x] 工具条视频图标
- [x] 视频待机胶囊控制条
- [x] 独立控制条（计时、暂停、停止，按选区横向居中）
- [x] 右下角结果卡（文件名、尺寸/时长/格式、打开/保存/关闭）
- [x] 托盘与 F4 入口

## 4. 验证

- [x] Vitest：MIME、尺寸、码率、时长、文件名
- [x] Electron E2E：视频录制、居中控制条、结果卡、保存落盘
- [ ] 真实交互桌面：麦克风/系统音、150% DPI、10 分钟上限
- [x] 文档更新

## 风险

- 平台不提供 MP4 编码 → 自动回退 WebM，界面明确标注。
- 系统音依赖平台能力 → 失败时无声继续并提示。
- 长视频临时文件较大 → 10 分钟上限。
- 全屏覆盖层内容保护会让捕获变黑 → 录制时隐藏覆盖层。
