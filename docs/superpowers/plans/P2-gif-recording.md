# P2 GIF 录制 · 实施计划

> 上游：`docs/features/P2-gif-recording.md`  
> UI 基准：现有截图覆盖层工具条（不使用新 Demo）  
> 目标版本：0.3.0

## 1. 依赖与类型

- [x] 安装 `gifenc` 1.0.3（MIT）
- [x] `shared/types.ts` 增加 `RecorderOptions`、`GifDoneMeta`、`RecorderState`
- [x] `shared/api.ts` / `preload` 增加录制 IPC

## 2. 录制与编码

- [x] 覆盖层 renderer 建立 `desktopCapturer` + `getUserMedia` 视频流
- [x] Canvas 裁切选区，按 `scaleFactor` 映射物理像素
- [x] 固定 15 FPS 抽帧，输出尺寸缩放
- [x] `gif-worker.ts` 使用 `gifenc` 逐帧编码
- [x] 60 秒自动停止、资源清理
- [x] 录制期间隐藏覆盖层，避免全屏内容保护导致捕获变黑

## 3. 窗口与交互

- [x] 工具条 GIF 入口
- [x] 点击 GIF 隐藏一级工具条
- [x] 待机胶囊控制条按选区 X 轴居中
- [x] 返回工具条恢复一级菜单
- [x] 待机条固定参数（15 FPS / 原始尺寸 / 3 秒倒计时）
- [x] 录制控制条窗口（内容保护、置顶、横向居中、红点/计时/停止）
- [x] 右下角结果卡（缩略图、文件名、尺寸/时长/大小、打开/保存/关闭）
- [x] 保存对话框与首帧 PNG 复制

## 4. 验证

- [x] Vitest：编码器、尺寸、时长
- [x] Electron E2E：待机条、录制、居中控制条、结果卡、保存
- [ ] 真实屏幕捕获：150% DPI、权限失败手测
- [x] 文档/CHANGELOG/ROADMAP 更新

## 风险

- Windows 剪贴板动画 GIF 支持不确定 → 首帧 PNG 回退。
- 15/30 FPS 原始尺寸 + 60 秒内存/CPU 压力 → Worker + 逐帧编码 + 长边 1920 上限。
- 覆盖层隐藏后用户可能切换窗口 → 与普通屏幕录制一致，文档说明。
- 捕获权限失败 → 明确错误提示。

