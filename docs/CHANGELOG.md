# Changelog

## [Unreleased]

### Added

- 托盘菜单新增“意见反馈…”，打开独立反馈窗口。
- 反馈窗口支持直接 `Ctrl+V` 粘贴截图、缩略图预览、单张删除，最多 10 张；超过 5MB 的图片提交前自动压缩为 WebP。
- 反馈文本提交到 `https://data.hugproducthub.top/api/v1/feedback`，截图按反馈 ID 逐张上传到预留附件接口。
- 反馈离线队列写入 `<userData>/feedback-queue.json`，429/5xx/网络错误按 2s → 8s → 30s 重试，`request_id` 重试复用。
- 新增 `docs/integrations/feedback-backend-contract.md`，用于后台对接和上线联调。
- 首次引导扩展为 5 页：GIF、视频、OCR/翻译，加上原有快捷键与划线两页。
- OCR 翻译单词卡：英文单词显示英式/美式音标、词性和前 3 条常用释义。
- 内置 ECDICT 常用 3 万词子集（2.81MB），音标走 dictionaryapi.dev 并本地缓存，失败时回退单套音标。
- 3 段循环动画：GIF 选区录制、视频框选录制、OCR 框选翻译。
- 视频页使用本地 8.2 秒无缝循环录屏素材，不依赖网络。
- 设置新增 `onboardingVersion`，升级后可再看到一次新版引导。
- `e2e-onboarding.cjs` 引导全流程 E2E。

### Changed

- 启动引导判断从 `onboardingCompleted` 布尔值改为引导版本比较。
- 旧设置迁移：`onboardingCompleted: true` 且无版本号时视为版本 1。

### Fixed

- OCR：单行窄选区（实测 303×20）在 PP-OCR 返回空结果时不再直接报“未识别到文字”，会统一放大后回退 Windows OCR。
- 截图工具栏首次出现延迟约 80ms：改为覆盖层首次显示时预绘制工具栏（实测首次/第二次 173.1ms / 172.6ms）。
- 工具栏移除十字按钮，改为隐式移动工具；其他工具点击选中、再次点击取消并回到移动状态。
- 诊断模块只在开发版显示，正式构建隐藏。
- 设置“关于与更新”移除“更新功能仅在打包版 Windows 中启用”提示行，卡片高度随内容收缩。

### Removed

- 长截图功能下线：移除工具栏入口、引导页、窗口长截图流程、长截图 IPC、预览/HUD 窗口和专用 smoke 入口。
- 删除长截图源文件、单测、E2E、Demo、fixture 和专用文档。

### Verified

- 反馈功能：`pnpm typecheck`、`pnpm test`（23 文件 / 141 用例）、`pnpm build` 通过。
- 反馈 E2E：真实剪贴板粘贴 2 张；12 张截断到 10 张；11.1MB 截图压缩到 2.72MB；503 后 2 秒重试成功；400 不重试；文本与 2 次附件 multipart 均到达本地 mock 后台。
- 反馈后台附件接口尚未上线；当前文字接口可用，截图上传会明确提示失败，待 Claude 按对接文档补齐。
- 迭代回顾 `docs/reviews/iteration-20261030-1358-v0.6.1.md` 结论 `blocked`；发布门禁因生产附件接口缺失按预期拦截。
- `pnpm typecheck`、`pnpm test`（25 文件 / 163 用例）、`pnpm build` 通过。
- E2E：5 页标题、GIF 光标误差 0.003px、视频 8.204s 播放中、OCR 居中 0/0、完成标记写入版本 2。
- 回归：覆盖层、钉图、录制、设置、OCR、OCR 翻译、工具栏切换/延迟 E2E 通过；覆盖层断言长截图按钮数量为 0。
- 发布门禁 `node scripts/review/release-gate.mjs --project _snapglass_app` 通过；报告 `docs/reviews/iteration-20261029-1148-v0.6.1.md`。

## [0.6.1] - 2026-10-28

### Added

- P8 区域/窗口长截图：工具栏纯图标入口、自动定位滚动窗口、从当前滚动位置开始。
- 长截图 HUD 防截屏保护，大选区覆盖 HUD 时不会把 HUD 截入结果。
- 大选区、普通选区、自动到底和失败态长截图 E2E。

### Changed

- 长截图单步位移限制在 80–240px，UIA 位移按滚动容器实际范围换算。
- 长截图预览窗移除缩放/适应宽度，只保留复制、保存、关闭；上下栏改石墨灰，阴影减半并留足透明边距。
- 长截图最后一步滚到 100% 并追加剩余行，不再在 99.5% 提前结束。
- 移除托盘 GIF 录制/视频录制入口及 F2/F4 全局快捷键，录制统一从截图工具栏进入。

### Fixed

- 修复 UIA 百分比位移漏算滚动范围、导致多屏累积错位。
- 修复大选区把 HUD 截入长图、预览窗四边阴影被硬裁的问题。

### Verified

- `pnpm typecheck`、`pnpm test`（25 文件 / 162 用例）、`pnpm build` 通过。
- 覆盖层、贴图、录制、设置 E2E 通过。
- 长截图普通/大选区/小选区到底/失败态 E2E 通过。
- `soak:real-overlay` 300 次：0 失败，p95 377ms，tab private 增长 18.1MB（预算 32MB；脚本仍用假背景）。
- 生成 `Pixmint-Setup-0.6.1.exe`、`latest.yml`、blockmap。

### 未实测

- 真实桌面内容 300 次长跑、ChatGPT 原始页面复测。
- 0.6.0 → 0.6.1 GitHub Release 自动更新（当前环境缺少 Git/GitHub 凭据）。
- 多显示器/高 DPI、macOS。

## [0.6.0] - 2026-10-27

### Added

- 自动长截图失败后，HUD 增加“改手动滚动”入口，无需重新框选。
- 手动模式：用户自己滚动，应用定时采帧、检测稳定帧、匹配并拼接。
- HUD 提示“请慢慢向下滚动，停一下再继续”，显示已截屏数和高度；滚动太快时提示回滚到重叠位置，不直接终止。
- 手动模式支持暂停/继续/完成/取消，复用预览、保存、复制和临时文件清理。

### Verified

- 手动模式 smoke：fixture 按 300px/700ms 滚动，700×2934、9 屏。
- 长截图 E2E：自动模式、手动入口、取消清理、不可滚动窗口通过。
- 普通/滚动条/UIA 大滚轮 smoke 回归通过。
- `pnpm typecheck`、`pnpm test`（145 项）、`pnpm build` 通过。
- GitHub Release `v0.6.0` 已发布，安装包、`latest.yml`、`.blockmap` 已上传。
- 0.5.2 → 0.6.0 在线更新通过；差分下载命中 54 个块，安装后 `FileVersion=0.6.0`。

### 未实测

- 用户实际应用中的手动滚动体验需更新后复测。
- 动态内容、固定表头、滚动条对拼接质量的影响仍需按应用验证。

## [0.5.2] - 2026-10-27

### Fixed

- 首屏滚轮被应用放大时，回滚到起点后使用 Windows UI Automation `ScrollPattern` 小步滚动（约 47px/步），避免一次滚过半屏导致无重叠。
- 保留 0.5.1 的滚动条边缘裁剪和 1px 接缝修复。

### Verified

- 13.8 倍滚轮测试页：700×3396，完整拼接。
- 带移动滚动条测试页：700×3396。
- 普通长截图 smoke：700×3396。
- 长截图专用 E2E 通过。
- `pnpm typecheck`、`pnpm test`（145 项）、`pnpm build` 通过。
- GitHub Release `v0.5.2` 已发布，安装包、`latest.yml`、`.blockmap` 已上传。
- 0.5.1 → 0.5.2 在线更新通过；差分下载命中 51 个块，安装后 `FileVersion=0.5.2`。

### 未实测

- 用户实际应用需更新后复测。
- 目标应用若无 UIA ScrollPattern 且只能整页滚动，仍无法拼接。

## [0.5.1] - 2026-10-27

### Fixed

- 修复长截图选区包含滚动条时，滚动条位置变化污染整行匹配、导致“无法找到重叠区域”的问题。匹配时裁掉左右 24px，拼接仍保留完整选区。
- 首次滚动幅度过大时，不再继续向下滚；会回滚到起点并尝试更小步长，仍失败时提示“请框选更高的区域或关闭单页滚动后重试”。

### Verified

- 带移动滚动条的测试页：700×3396，完整拼接。
- 普通长截图 smoke：700×3396。
- 长截图专用 E2E：入口、HUD、暂停/继续/完成/取消、预览、复制、保存路径、不可滚动窗口通过。
- `pnpm typecheck`、`pnpm test`、`pnpm build` 通过。
- GitHub Release `v0.5.1` 已发布，安装包、`latest.yml`、`.blockmap` 已上传。
- 0.5.0 → 0.5.1 在线更新通过；差分下载命中 61 个块，约 1.2MB（1%），安装后 `FileVersion=0.5.1`。

### 未实测

- 用户实际应用的滚动条宽度/位置差异需更新后复测。
- VS Code、UAC/受保护窗口、网络懒加载图片仍未验证。
- 125% / 150% / 200% DPI 和多显示器按用户要求不测。

## [0.5.0] - 2026-10-27

### Added

- 覆盖层工具栏新增“长截图”入口，框选可滚动区域后自动滚动、逐帧采集并拼接成长图。
- 新增长截图进度 HUD：显示已截屏数、当前高度和状态，支持暂停、继续、完成、取消和 Esc 取消。
- 新增独立长图预览窗口，支持缩放、滚动、保存 PNG 和复制到剪贴板。
- 新增 Windows 滚动 helper：`SetForegroundWindow` + `SetCursorPos` + `SendInput` 滚轮，结束后恢复鼠标位置。
- 新增固定表头检测、重叠匹配、增量拼接、30,000px / 30M 像素上限和临时文件清理。

### Changed

- 长截图采集帧统一裁掉最后 1 个物理像素行，避免窗口内容底边进入拼接；结果比选区少 1px。

### Fixed

- 修复长截图每个拼接缝多出 1px 深色横线的问题；修复前 534/634/934… 接缝行在像素扫描中可见，修复后除表头外无深色横线。
- 修复首帧与后续帧底部边缘判定不一致会导致帧尺寸不同、重叠匹配失败的问题。

### Verified

- `pnpm typecheck` 通过。
- `pnpm test` 通过：23 个测试文件、144 个用例。
- `pnpm build` 通过：main / preload / renderer 全部构建成功。
- 后端 smoke：700×3396、297,504 字节，行号 1..160 连续，固定表头只出现一次，页面到底后停止。
- 真实 HUD/预览 UI smoke：700×3396、297,504 字节。
- 覆盖层 E2E：`E2E_OK`，工具栏宽度 811px。
- 长截图 E2E：`pnpm e2e:long-capture`，入口点击、HUD 暂停/继续/完成、预览缩放/复制、临时文件清理和取消路径通过。
- Edge 长网页：700×3235；记事本长文档：700×13908。
- 20k px：700×21036、1.97MB；3 次编码 1110/1050/1034ms，RSS 增长 185/196/205MB。
- 深色 + 静态图片 + 代码块：700×5240，拼接连续。
- 保存路径、不可滚动窗口、1200px 上限提示均通过；OCR/翻译/录制/钉图/设置回归通过。
- GitHub Release `v0.5.0` 已发布，安装包、`latest.yml`、`.blockmap` 已上传。
- 0.4.1 → 0.5.0 在线更新通过：下载、SHA-512 校验、重启安装、版本变化和设置/密钥保留均验证。
- 差分下载因 0.4.1 旧 Release 缺少 blockmap 资产回退全量下载；全量下载成功。

### 未实测

- 原生保存对话框 UI（保存路径已用拦截对话框验证）。
- 125% / 150% / 200% DPI、多显示器、跨屏选区（用户明确本轮不测）。
- UAC/受保护窗口、失焦窗口的错误提示。
- VS Code 长文件（现有会话阻塞）。
- 网络懒加载图片和动态内容拼接。
- 差分下载命中（旧版 blockmap 资产缺失，已回退全量）。

## [0.4.1] - 2026-10-26

### Fixed

- 修复 GitHub 仓库还没有任何 Release 时误显示红色“检查更新失败：No published versions on GitHub”的问题。现在显示绿色“已是最新版本”，备注“更新源暂无发布记录 · 发布新版本后会自动检测”。

### Verified

- `tsc --noEmit` 通过。
- 单测覆盖“无发布版本”识别、错误映射和 `up-to-date` 文案。
- 打包版连接真实 GitHub 源（0 个 Release）时显示“已是最新版本”，不再显示英文错误。
- 本地 generic 源发现新版本、下载、校验和安装路径回归通过。

## [0.4.0] - 2026-10-26

### Added

- 新增应用内更新：设置页“关于与更新”支持手动检查、发现新版本、下载进度、SHA-512 校验和重启安装。
- 打包版启动 15 秒后静默检查一次；更新源为 GitHub Releases。
- 新增 `electron-updater` 6.8.11 依赖，以及 `UpdateState` 状态机、中文错误映射和 18 个单测。
- 新增 `PIXMINT_UPDATE_URL` 测试覆盖入口，仅用于本地 generic 源 E2E。

### Changed

- `electron-builder.yml` 显式配置 GitHub publish；安装包名统一为 `Pixmint-Setup-<version>.exe`。
- NSIS 显式每用户安装，覆盖安装不需要管理员权限。
- 更新器在开发模式、非 Windows 平台自动禁用。

### Fixed

- 修复辅助安装器（`oneClick=false`）可能弹出需要点击的 NSIS 向导的问题，改为显式静默安装。

### Verified

- `tsc --noEmit` 通过。
- 20 个测试文件、121 个用例全部通过。
- `electron-vite build` 通过。
- `node e2e-settings.cjs` 通过。
- `node e2e-overlay.cjs` 通过（E2E_OK）。
- 0.4.0 安装包 119,455,568 字节，较 0.3.10 增加 395,800 字节（+0.33%）。
- 本地 generic 源完整验证：0.4.0 → 0.4.1 检查、下载、SHA-512 校验、静默安装、自动重启；最终 `app.getVersion()` 为 0.4.1。
- 本地 generic 源验证同版本、断网、404、哈希失败四条路径：分别显示“已是最新”“无法连接更新源”“更新源不可用”“校验失败，已阻止安装”。
- 0.3.10 → 0.4.0 覆盖安装通过，设置、密钥、历史和日志保留。
- 更新后 `%APPDATA%\snapglass` 的 `settings.json`、`secrets.json`、`history` 和日志保留。
- 未实测：GitHub Releases 真实下载速度、差分下载命中、Windows 代码签名、下载中断、真实安装失败注入、OCR / 录制 E2E。

## [0.3.10] - 2026-10-26

### Changed

- 翻译方向下拉改为常驻：语言明确时自动选中 `CN→EN` / `EN→CN` 并翻译；语言不明确时默认“请选择”，不自动发请求。
- 下拉触发框和选项保持紧凑，只有两个纯文本选项；切换方向立即重翻。
- 原文和译文区域溢出时显示 6px 细滚动条，避免用户误以为只有当前可见内容。

### Fixed

- 修复长原文在翻译弹框中看不到剩余内容的问题。

### Verified

- `pnpm typecheck` 通过。
- `pnpm test` 通过，20 个测试文件、103 个用例全部通过。
- `pnpm build` 通过。
- `node e2e-ocr-translate.cjs` 通过：默认“请选择”、两项均未选中、选择 `CN→EN` 后切换 `EN→CN` 并关闭菜单。
- 生产窗口实测长原文：`clientHeight=88`、`scrollHeight=286`、`scrollbarWidth=thin`。

## [0.3.9] - 2026-10-26

### Added

- 翻译弹框在中英字符数相等或没有明确语言时显示居中方向下拉，只有 `CN→EN` 和 `EN→CN` 两项。
- 默认方向按界面语言决定：中文界面 `CN→EN`，英文界面 `EN→CN`。
- 切换方向立即重新翻译，旧请求结果不会覆盖新译文。

### Changed

- `detectTranslationTarget` 在语言不明确时返回 `null`，不再默认猜测中文。
- 方向下拉只保留纯文本选项，无确认按钮、无额外标题/副标题。

### Verified

- `pnpm typecheck` 通过。
- `pnpm test` 通过，20 个测试文件、104 个用例全部通过。
- `pnpm build` 通过。
- `node e2e-ocr.cjs` 通过。
- `node e2e-ocr-translate.cjs` 通过：`中文ab` 默认 `CN→EN`、菜单两项、切换 `EN→CN` 并关闭菜单。

## [0.3.8] - 2026-10-26

### Added

- 新增 PaddleOCR PP-OCRv5 mobile 本地离线引擎，模型随包分发，支持中英混排、路径、版本号、IP 和代码字段。
- 新增 `onnxruntime-node` 原生 ONNX 推理，首次加载约 0.4–0.5 秒，单张 920×560 混排图约 0.8–0.9 秒。
- PaddleOCR 失败、模型缺失或 `OCR_BACKEND=windows` 时自动回退 Windows OCR。
- 新增 `assets/ocr/README.txt`，记录模型来源、许可和字典 blank 处理。

### Changed

- OCR 默认后端改为 PaddleOCR；Windows OCR 保留为兜底。
- 安装包增加约 24MB（95.4MB → 119.1MB），排除其他平台和 DirectML/DX 文件。
- OCR 放大策略改为小图 4×、200px 以下 3×、其余 2×，大选区中的 14–16px 小字不再直接按 1× 识别。
- 显式使用 `zh-Hans-CN` OCR 引擎，并在日志中记录实际引擎与可用语言。
- OCR 多行结果按行拼接，保留原始行结构；中文标点后的换行不再被清洗掉。
- 新增代码字段后处理：提交号断字合并、IP/版本号/字节数纠正、路径分隔符空格清理、全角数字转半角。

### Fixed

- 修复 OCR 多行文本被合并成一整段、`Git` 等短行粘到上一行的问题。
- 修复等宽字体把 `0` 读成 `ø`、发布包版本-日期连字符读成点等常见字段错误。

### Verified

- `pnpm typecheck` 通过。
- `pnpm test` 通过，20 个测试文件、102 个用例（含 PaddleOCR 真实模型集成测试）。
- `pnpm build` 通过。
- Electron 主进程 PaddleOCR 冒烟：混排 920×560 约 861ms、14px 小字约 839ms、置信度 0.98；提交号、分支、路径、版本、IP 全部正确。
- 打包后的 `release/win-unpacked/Pixmint.exe --smoke-ocr-file` 通过：模型从 `resources/ocr` 加载，`OCR_BACKEND paddle`，原生 ONNX 绑定可用。
- 100 次 OCR 压测（warm-up 后计）：0 失败，p50 76ms，p95 100ms，RSS 增长约 53MB（预算 128MB）。
- `--smoke-ocr-file` 回归：`ocr-test.png`、`ocr-mixed.png`、`ocr-mixed-small.png` 的提交号、分支、IP、版本号、字节数、路径和 `Git` 行均通过；Windows 兜底路径的 14px 限制仍记录在 P1 文档。
- 灰度/反色/对比度/锐化预处理做过对照，数字和代码识别反而下降，未启用。

## [Unreleased] - 2026-10-25

### Changed

- 截图编辑默认工具改为“移动选区”，使用与钉图一致的 `grab` / `grabbing` 抓取手型，不再默认选中矩形工具。
- 工具栏新增“移动选区”按钮；按住选区可拖动整块截取区域，尺寸保持不变并受屏幕边界约束。
- 移除自定义手形光标方案及设计素材，拖拽统一使用系统 `grab` / `grabbing` 手型。

### Fixed

- 钉图窗口改用 `screen-saver` 置顶级别，并在失焦/重新显示时重新断言 TOPMOST，切换其他应用后不再被压到下层。
- 钉图窗口拖动时，指针落到窗口外层会回退为张开手；现拖动全程保持 `grabbing`。
- 截图选区拖动时，指针离开画布会回退为箭头；现覆盖层根层在拖动全程保持 `grabbing`。

### Verified

- `pnpm typecheck` 通过。
- `pnpm test` 通过，19 个测试文件、98 个用例全部通过。
- `pnpm build` 通过。
- `pnpm e2e:overlay` 通过：默认 `grab` / 拖动全程 `grabbing`（根层与指针下元素）/ 松开 `grab`、选区拖动、标注和缩放回归（Windows 1920×1080，DPR 1）。
- `pnpm e2e:pin` 通过：置顶属性、拖动全程 `grabbing`、编辑、保存和关闭回归。

## [Unreleased] - 2026-10-21

### 稳定性与跨平台基础（2026-10-22）

#### Added

- 新增全局崩溃采集：主进程未捕获异常、未处理 Promise、渲染进程退出、子进程退出和渲染层无响应都会写入本地崩溃报告。
- 新增最近 100 条操作面包屑，崩溃报告可还原截图、OCR、录制等关键动作路径。
- 新增资源采样：按分钟记录内存、Electron 进程指标和事件循环延迟，保留最近 120 个样本。
- 设置页新增“诊断”区域，可查看日志路径、崩溃报告数量、兼容模式并打开目录。
- 新增 `docs/ARCHITECTURE.md`，明确 Windows/macOS 共享代码、平台 Provider 和 sidecar 约束。

#### Changed

- 诊断日志改为 250ms 批量异步写入，单文件 2MB、最多 3 个文件轮转；只保留 warning/error 级别的渲染层 console。
- 日志写入前统一脱敏 Windows/macOS/Linux 用户目录、Bearer Token 和常见密钥字段。
- 设置文件改为 schema 白名单校验、版本标记、损坏备份和临时文件 + rename 原子替换。
- 密钥文件复用原子写入；读取失败时保留 `.corrupt-` 备份，不再静默丢弃现场。
- 设置页新增诊断 IPC，preload 与 shared API 同步扩展。

#### Verified

- `pnpm typecheck` 通过。
- 新增 `tests/diagnostics-utils.test.ts`、`tests/settings-utils.test.ts`，8 个用例通过。
- 全量单测在沙箱线程池下 74 个通过；`tests/windows-ocr.test.ts` 因沙箱禁止启动 PowerShell 失败，属于环境限制。
- `electron-vite build` 在主进程、preload 和渲染层均通过；沙箱环境需临时屏蔽 Vite 的 `net use` 探测，普通桌面会话应直接复跑 `pnpm build` 确认。

### Sidecar 抽象（2026-10-22）

#### Added

- 新增 `src/main/sidecar/protocol.ts`：行缓冲、请求编码、响应解析。
- 新增 `src/main/sidecar/client.ts`：统一 spawn、请求 ID、超时、最新请求优先、进程退出、重启和日志。
- 新增 Sidecar 协议与客户端单测，覆盖分片响应、非法响应、超时重启和 dispose。

#### Changed

- `fast-capture.ts` 和 `window-snap.ts` 改为复用 `SidecarClient`，删除两套重复的进程管理代码。
- 临时 PowerShell 脚本改为带进程 ID 的唯一路径，并在 dispose 时清理。
- PowerShell stderr、超时和异常退出进入统一诊断日志。

#### Verified

- `pnpm typecheck` 通过。
- Sidecar/诊断/设置相关 4 个测试文件、15 个用例通过。
- 全量单测 81 个通过；`tests/windows-ocr.test.ts` 仍因沙箱禁止启动 PowerShell 失败。
- `pnpm build` 三层构建通过。

### 平台 Provider 抽象（2026-10-22）

#### Added

- 新增 `src/main/platform/types.ts`：`ScreenCaptureProvider`、`WindowQueryProvider`、`OcrProvider` 和 `PlatformServices` 契约。
- 新增 `src/main/platform/win32/index.ts`：把 Windows 截图、窗口吸附和 OCR 实现收进适配器。
- 新增 `src/main/platform/index.ts`：按平台创建服务；未接入平台提供可启动的占位实现。

#### Changed

- `src/main/index.ts` 的截图、窗口查询和 OCR 改为只依赖 `PlatformServices`，不再直接 import Windows 实现。
- 主进程启动仍保持单实例锁、托盘和现有窗口行为；平台差异集中到 `platform/`。

#### Verified

- `pnpm typecheck` 通过。
- 全量单测 81 个通过；`tests/windows-ocr.test.ts` 仍因沙箱禁止启动 PowerShell 失败。
- `pnpm build` 主进程、preload 和渲染层均通过。

### 压测工具（2026-10-22）

#### Added

- 新增 `scripts/soak/`：覆盖层、OCR、录制三条压测链路和公共启动/内存/报告模块。
- 新增 `--soak-ocr` 测试模式，按配置次数循环 OCR 并输出 p50/p95、内存和进程指标。
- 新增 `soak:overlay`、`soak:ocr`、`soak:recording` 三个 pnpm 命令。
- 压测报告写入 `test-results/`，已加入 `.gitignore`。

#### Changed

- 覆盖层压测使用 `--smoke-overlay` 假画面，不依赖真实屏幕捕获。
- 录制压测默认 10 秒，可通过环境变量提升到 590 秒；超过 1MB 的临时残留会使脚本失败。

#### Verified

- `pnpm typecheck` 通过。
- 4 个压测脚本通过 `node --check` 语法检查。
- 当前沙箱无法执行真实屏幕捕获和 PowerShell，需要在普通 Windows 交互桌面运行压测。

### 诊断报告导出（2026-10-22）

#### Added

- 新增 `src/main/diagnostics-export.ts`：汇总应用版本、平台、兼容模式、内存、设置摘要、面包屑、指标、最近崩溃报告和日志尾部。
- 设置页“诊断”区域新增“导出报告”，通过系统保存对话框生成单个 JSON 文件。
- 新增 `diagnostics:export-report` IPC 与 preload API。

#### Changed

- 诊断报告不包含截图、OCR 文字、剪贴板、翻译密钥；日志导出前再次脱敏。
- 每个日志文件只导出尾部 512KB，避免报告无限变大。

#### Verified

- `pnpm typecheck` 通过。

### CI 门禁（2026-10-22）

#### Added

- 新增 `.github/workflows/ci.yml`：Windows GitHub Actions 自动运行 typecheck、单元测试和构建。
- 新增 `test:unit` 脚本，排除依赖本机 Windows OCR 语言包的集成测试。

#### Verified

- CI 同等测试集在本地线程池下 14 个文件、81 个用例通过。
- `pnpm typecheck` 通过。

### Sidecar 竞态修复（2026-10-22）

#### Fixed

- 旧 helper 的延迟退出事件不再清空当前行缓冲，也不会把新 helper 的待处理请求误判为失败。
- 新增“旧子进程退出不影响新请求”的回归测试。

#### Verified

- `pnpm typecheck` 通过。
- Sidecar 协议/客户端 8 个用例通过。

### OCR 与翻译稳定性（2026-10-22）

#### Fixed

- OCR 改为串行队列，避免并发调用同时启动多个 PowerShell 和临时脚本。
- Windows OCR 临时脚本改为每次唯一路径，并在识别结束或失败后清理。
- 翻译请求增加 15 秒超时和中止信号，避免公共接口或用户代理长时间不返回时 IPC 悬挂。

#### Verified

- `pnpm typecheck` 通过。
- OCR 队列与翻译相关 2 个测试文件、13 个用例通过。
- 全量单元测试 85 个通过（排除依赖本机 OCR 语言包的集成测试）。
- `pnpm build` 三层构建通过。

### 安全边界（2026-10-22）

#### Added

- 新增 `src/main/security.ts`：应用页面 URL 信任判断与 webContents 导航限制。
- 所有 webContents 拒绝新窗口和 webview attach，只允许 file: 与本机开发地址导航。
- 权限请求和权限检查只对受信任应用页面放行 media/display-capture。
- CSP 增加 `object-src 'none'`、`base-uri 'none'`、`frame-ancestors 'none'`。

#### Verified

- `pnpm typecheck` 通过。
- 安全 URL 信任 2 个测试用例通过。
- 全量单元测试 87 个通过（排除依赖本机 OCR 语言包的集成测试）。
- `pnpm build` 三层构建通过。

### 测试诊断辅助（2026-10-22）

#### Added

- 支持通过 `PIXMINT_USER_DATA_DIR` 指定 userData/sessionData 目录，便于沙箱、便携和隔离测试。
- smoke 测试增加 `did-fail-load` 和 `render-process-gone` 日志，便于定位渲染层加载失败。

#### Verified

- `pnpm typecheck` 通过。
- `pnpm build` 三层构建通过。

### 渲染层独立验证（2026-10-22）

#### Added

- 新增 `scripts/dev/vite.renderer.config.mjs`，可单独启动渲染层 Vite 服务。
- 新增仅开发环境启用的 `dev-mock.ts`，在 Electron preload 缺失时提供设置、诊断和覆盖层初始数据，用于浏览器 UI 回归。
- 通过 Explorer 在原生 Windows 会话启动 Electron，完成 smoke、设置 E2E、覆盖层 E2E；覆盖层 200 次压测通过。

#### Fixed

- 移除 meta CSP 中会被浏览器忽略并报错的 `frame-ancestors`，保留 `object-src` 和 `base-uri` 限制。

#### Verified

- Electron smoke：`SMOKE_OK`
- 设置页 E2E：`SETTINGS_E2E_OK`，启动 1607ms
- 覆盖层 E2E：`E2E_OK`，watchdog 按预期隐藏无响应覆盖层
- 覆盖层压测：200 次、0 失败、p50 154ms、p95 163ms、max 755ms
- 压测后 renderer working set 从约 88.6MB 增至 144.6MB，需后续确认是否为 Chromium 分配器缓存
- 真实录制 E2E 在 GIF 阶段被 WebRTC `Failed to assign the desktop` 卡住，需在普通本地桌面复测

### 捕获超时修复（2026-10-22）

#### Fixed

- 截图兜底 `desktopCapturer` 增加 5 秒超时，桌面捕获权限不可用时不再无限挂起。
- 快速捕获 smoke 失败时只记录错误，不弹模态框；三轮失败后正常退出。

#### Verified

- `pnpm typecheck` 通过。
- 全量单元测试 90 个通过（排除依赖本机 OCR 语言包的集成测试）。
- `--smoke-fast-capture` 在桌面捕获失败时 3 轮均正常退出，退出码 0。
- 覆盖层 200 次压测：0 失败，p50 154ms、p95 163ms、max 755ms。
- OCR 100 次压测：0 失败，p50 895ms、p95 952ms、max 1099ms。
- 真实桌面捕获仍被当前会话拒绝：`Failed to assign the desktop to the current thread: 170`，这是环境权限问题。

### 正常启动截图验证（2026-10-22）

#### Added

- 新增仅用于验证的 `--capture-once` 参数，跳过 smoke 入口，走正常启动、托盘初始化和真实 `startCapture`。

#### Verified

- 正常源码版通过 `--show-settings` 打开可见 Pixmint 窗口，主进程响应正常。
- `--capture-once` 触发真实截图路径，输出 `CAPTURE_KIND fallback`；系统仍报桌面分配错误，5 秒超时后返回，不再挂死。
- 最小 Electron 探针和纯 GDI 探针也拿不到像素，确认阻塞点在当前 Windows 桌面会话，不在 Pixmint 截图实现。

### 覆盖层内存调查（2026-10-22）

#### Investigated

- 试验把冻屏 `<img>` 改为 `<canvas>` + `ImageBitmap`，绘制后 close，reset 时清空画布。
- 压测报告增加 renderer JS 堆、DOM 节点、canvas 和 image 数量采样。
- 对照结果：100 次只开关覆盖层，canvas 方案 +20.2MB，img 方案 +29.3MB；但 500 次完整框选，canvas 方案 86.9→196.2MB，img 方案 86.7→179.9MB，长跑无改善。
- JS 堆稳定 9.5MB，DOM 节点稳定 11 个，说明增长在 Chromium 原生层/自动化路径，不是 React/DOM 泄漏。
- 100 次对照采样：renderer private bytes 37.6MB → 61.9MB，shared bytes 始终为 0；确认是 Chromium renderer 私有原生内存，而非 JS 堆或共享内存。
- 1000 次完整框选：working set 85.4MB → 246.7MB，private bytes 38.8MB → 192.2MB，近似线性增长。
- renderer reload 回收试验：500 次后 working set 仍 180MB，与不回收的 179.9MB 基本相同；reload 不能释放 Chromium 原生私有内存，策略已撤回。

#### Verified

- 覆盖层 E2E：`E2E_OK`，框选、工具条、标注、复制、watchdog 全部通过。
- 贴图 E2E：`PIN_E2E_OK`，钉图、拖动、复制、关闭通过。
- canvas 试验已回退，保留更简单的 img 冻屏方案，避免无效复杂度。
- 1000 次长跑确认没有封顶；剩余增长是 Chromium 原生私有内存，当前 app 层改动无法回收，需要在真实用户路径上继续确认影响。

### 全窗口 sandbox（2026-10-22）

#### Changed

- 所有 BrowserWindow（设置、覆盖层、贴图、OCR、引导、录制控制、录制预览、smoke）统一开启 `sandbox: true`。
- 保留 `contextIsolation` 和窄 preload API，不引入 Node 权限。

#### Verified

- Electron smoke：`SMOKE_OK`。
- 设置页 E2E：`SETTINGS_E2E_OK`，sandbox 下设置读取、密钥加密/清除正常。
- 覆盖层 E2E：`E2E_OK`，框选、标注、复制、watchdog 正常。
- 贴图 E2E：`PIN_E2E_OK`，钉图、拖动、复制正常。
- 生产构建通过。

### 生产 CSP 收口（2026-10-22）

#### Changed

- 渲染层 HTML 使用生产 CSP，不再包含 `ws:` 和 `http://localhost:*`。
- 开发服务器通过 `devCspPlugin` 仅在 serve 模式注入 HMR 所需地址，不放宽生产策略。

#### Verified

- 生产 `out/renderer/index.html` 的 `connect-src` 仅保留 `'self'` 和 `snapglass-media:`。
- Electron smoke：`SMOKE_OK`。
- 设置页 E2E：`SETTINGS_E2E_OK`。
- `pnpm typecheck` 和生产构建通过。

### OverlayApp 第一批拆分（2026-10-22）

#### Changed

- 选区缩放/窗口裁剪几何抽到 `selection-geometry.ts`。
- 选区外压暗层抽到 `DimAround.tsx`。
- `OverlayApp.tsx` 从约 1116 行降至约 1064 行，几何逻辑可独立测试。

#### Verified

- 新增 5 个选区几何单测通过。
- 覆盖层 E2E：`E2E_OK`，框选、缩放、标注、复制、watchdog 全部通过。
- sandbox 和生产 CSP 保持不变。

### OverlayApp 图片会话 hook（2026-10-22）

#### Changed

- 把 `init`、`preparing`、`imageReady` 和图片解码令牌抽到 `useOverlayImageSession`。
- 覆盖层 init/prepare/reset 仍由 UI reset 回调控制，行为保持不变。

#### Verified

- `pnpm typecheck` 通过。
- 95 个单元测试通过。
- 覆盖层 E2E：`E2E_OK`，框选、标注、复制、watchdog 正常。
- 生产构建通过。

### 压测预算门禁（2026-10-22）

#### Added

- 覆盖层压测支持 `PIXMINT_SOAK_MAX_P95_MS` 和 `PIXMINT_SOAK_MAX_PRIVATE_MB`，超限退出码为 1。
- OCR 压测支持 `PIXMINT_SOAK_OCR_MAX_P95_MS` 和 `PIXMINT_SOAK_OCR_MAX_RSS_MB`。
- 压测报告写入实际预算和 `ok` 结果，便于 CI/发版判断。

#### Verified

- 两个压测脚本通过 `node --check`。
- 当前实测 p95：覆盖层约 169ms，OCR 约 952ms，均低于默认预算。

### OverlayApp 键盘 hook（2026-10-22）

#### Changed

- 抽出 `useOverlayKeyboard`，集中处理 Escape、复制、保存、钉图和撤销/重做。
- `OverlayApp.tsx` 从约 1056 行降至约 1027 行。

#### Verified

- `pnpm typecheck` 通过。
- 覆盖层 E2E：`E2E_OK`，框选、标注、复制、watchdog 正常。
- 生产构建通过。

### OverlayApp 窗口吸附 hook（2026-10-22）

#### Changed

- 抽出 `useWindowSnapQuery`，集中管理 hoverRect、查询令牌、节流和取消。
- `OverlayApp.tsx` 从约 1027 行降至约 974 行。

#### Verified

- `pnpm typecheck` 通过。
- 覆盖层 E2E：`E2E_OK`，框选、缩放、标注、复制、watchdog 正常。
- 生产构建通过。

### OverlayApp 选择/标注状态 hook（2026-10-22）

#### Changed

- 抽出 `useOverlaySelection`，集中管理选区、拖拽、8 向缩放、工具状态、子菜单和撤销/重做可用性。
- `OverlayApp.tsx` 从约 974 行降至约 832 行。

#### Verified

- `pnpm typecheck` 通过。
- 95 个单元测试通过。
- 生产构建通过。
- 覆盖层 E2E：`E2E_OK`，框选、缩放、标注、复制、watchdog 正常。
- Electron smoke：`SMOKE_OK`。

### 覆盖层内存治理（2026-10-22）

#### Changed

- 覆盖层不再用 `<img>` + data URL 显示截图，改为常驻 canvas + `createImageBitmap`，绘制后立即 `close()`；会话结束把 canvas 尺寸归零。
- 导出和自动复制改为传 PNG 字节，不再生成 data URL；导出 canvas 复用，不再每次新建。
- 钉图窗口改为接收图片字节并用 Blob URL 显示，卸载时 `revokeObjectURL`。

#### Verified

- 300 次真实截图：0 失败，private 35.1 → 54.5MB（+19.3MB），working 84.4 → 111.5MB，p95 250ms。
- 五路径各 50 次：Esc +25MB、钉图 +24MB、OCR +21.7MB、保存 +35.3MB（预算 48MB）、复制 +41.3MB（预算 64MB）。
- 3×590 秒录制 + 空闲 60 秒：0 失败，private +23.9MB（空闲后 56.9MB），临时残留 0。
- 覆盖层 E2E：`E2E_OK`；钉图 E2E：`PIN_E2E_OK`；95 个单元测试和生产构建通过。
- 150% DPI 真机复测通过：VIEWPORT 1280×720，框选、工具栏、文字、缩放、复制、watchdog、大选区均 `E2E_OK`。
- 200% DPI 当前显示器不提供该选项，未验证；大选区断言已改为按视口计算，支持 150%/200%。

### 交互完善（2026-10-22）

#### Added

- OCR / 翻译识别超过 150ms 时显示独立“识别中...”toast，完成或失败后自动消失；翻译阶段不单独提示“翻译中...”。
- 钉图按空格进入编辑模式，图片下方显示矩形/椭圆、箭头、马赛克、文字、序号、撤销/重做箭头和完成按钮；二级菜单复用截图工具栏。
- 钉图编辑点完成会把原图与标注合成后写回当前钉图，并恢复原窗口位置和尺寸；Esc 放弃编辑。

#### Fixed

- GIF / 视频准备阶段不再隐藏冻结画面、淡出红框或撤掉选区遮罩；只在真正开始录制时切换到实时桌面一次。
- 录制状态每 100ms 重复调用 `setAlwaysOnTop` / `moveTop` / `setOpacity` 导致全屏透明覆盖层反复重绘；改为只在录制模式真正变化时执行一次。
- 录制控制窗只在首次显示时置顶，不再每 100ms 调用 `moveTop`。
- 覆盖层渲染进程崩溃或通知发送失败时，主进程先执行鼠标穿透、透明化和隐藏，再尝试通知；崩溃窗口直接销毁，下一次 F1 重建，不再把桌面锁死。
- 视频同时开启系统音时，不再为系统音单独发起第二路桌面 `getUserMedia`；改为视频和系统音一次获取，避免渲染进程崩溃。

#### Verified

- OCR toast：实测文本为“识别中...”，OCR 窗口打开后消失。
- `pnpm e2e:recording`：GIF 和视频准备/倒计时/录制阶段红框、遮罩、控制条均正常，`RECORDING_E2E_OK`。
- `pnpm e2e:pin`：空格编辑窗口 580×370 → 779×482，撤销可用，二级菜单可展开，完成后恢复 bounds 并写回新图，`PIN_E2E_OK`。
- 真实截图录 2 秒 GIF：32 帧逐帧差异全为 0；录 2 秒视频：66 帧平均差异 0.01、最大 0.64，无闪帧。
- 强制崩溃覆盖层渲染进程：`active=false`、`overlayVisible=false`、可见窗口 0，桌面立即恢复。
- 视频 + 系统音录制 5 秒：0 崩溃，预览 `hasAudio=true`、`systemAudio=true`；`ffprobe` 确认文件含 AAC 48kHz 音频轨和 H264 视频轨。
- `pnpm typecheck`、`pnpm test:unit`、`pnpm build` 通过。

### 录制与真实路径压测（2026-10-22）

#### Added

- 新增 `scripts/soak/real-overlay-soak.cjs`：按真实 `startCapture` 路径循环截图，采样 renderer private/shared bytes。

#### Changed

- 录制压测关闭预览改为同步点击，避免预览窗口销毁导致 `Target page closed` 误报。

#### Verified

- 3 次 590 秒视频录制：0 失败，p50 594.7 秒，p95 595.7 秒，临时残留 0。
- 录制后内存：Browser 112.1 → 214.7MB，Tab 95.2 → 647.5MB。
- 100 次和 300 次真实截图：0 失败，p95 289ms。
- 300 次真实截图后 renderer working set 94.6 → 880.4MB，private 35.9 → 326.4MB；JS 堆稳定 9.5MB、DOM 稳定 11 节点，确认增长在 Chromium 原生图像内存。
- 150% / 200% DPI 未验证：当前显示器为 100%，强制缩放会使窗口 DIP 与视口二次缩放，不能代表系统 DPI。

### Added

- 新增首次启动引导窗口：先介绍默认截图快捷键 F1，再用循环动画说明划线工具的“按住拖拽”和“单击两次”两种用法。
- 引导页提供上一步、下一步、跳过、完成和动画重播，并在完成标记后不再自动弹出。
- 引导动画改为鼠标热点沿同一条 SVG 曲线路径移动：拖拽模式和两次单击模式的指针、起点与线条严格重合。
- 两次单击模式在第一次点击时让指针停在起点，随后移动到终点并同步拉出直线。
- 第一页矩形框选动画改为同一动画循环驱动，矩形宽高与指针位置同步，右下角始终贴合指针。
- 两页引导改为同时挂载的柔和淡入淡出与轻微位移，切换时不再瞬间替换页面。
- 箭头端样式合并为一个下拉框，顺序为“带箭头、纯线条、双箭头”，默认带箭头。

### Changed

- 产品正式更名为 Pixmint：安装包、可执行文件、窗口标题、托盘、通知、设置页、引导页、Demo、默认保存文件名和文档标题均已切换。
- 安装标识改为 `com.pixmint.desktop`；内部 `snapglass-media://` 协议、`window.snapglass` 预加载 API 和现有数据目录 `%APPDATA%\snapglass` 保持兼容，避免已有设置和密钥丢失。
- 整体 UI 切换到 Codex 桌面端色板：浅色使用 `#f9f9f9 / #ffffff / #ededed`，深色使用 `#0d0d0d / #181818 / #212121`，主蓝色为 `#0285ff`。
- 选中态从蓝色块改为 Codex 中性灰选中：浅色 `#ededed`、深色 `#303030`；主操作按钮改为黑白主色，蓝色仅用于焦点、选区和链接。
- 全站圆角统一为 Codex 半径体系：4 / 6 / 8 / 10 / 12 / 16 / 20px，超大圆角只保留胶囊按钮和圆形控件。
- 设置页、截图工具栏、引导页、OCR、贴图和录制窗口同步新主题；交互 Demo 同步同套色板与圆角。
- 删除线型中的“马克笔”“虚线”和“手绘”选项；当前线型为实线、细线、点线。
- 线型下拉框中的全部预览都带箭头，并复用实际绘制算法。
- 箭头切线采样距离缩短，回弯后箭头会沿最后一段实际方向。
- 箭头尺寸按路径长度等比收缩，切线采样距离限制在线段长度的合理比例内，短线和急弯不会再出现大头或方向乱跳。

### Fixed

- 注释命中改为按当前工具匹配：矩形/圆形工具可移动矩形和圆形，箭头工具可移动箭头和手绘线，文字工具可移动文字；马赛克工具不会再拖动已有对象。
- 切换工具时清理未完成的箭头和临时移动状态，切回矩形/圆形或箭头工具后可以重新选中和移动已有标注。
- 悬浮到当前工具可编辑的注释边框时显示平移四向光标；文字支持拖动移动，单击仍进入编辑。

### Verified

- `pnpm typecheck` 通过。
- `pnpm test` 通过：11 个测试文件、67 个用例。
- `pnpm build` 通过。
- `pnpm e2e:overlay` 通过：覆盖箭头端下拉框、三种线型、切换工具后移动矩形、文字拖动与光标提示。
- `node e2e-onboarding.cjs` 通过：覆盖 F1 快捷键、两页引导、三种线型、重播和完成关闭。
- Codex 主题截图检查通过：浅色/深色引导页、截图工具栏、设置页和交互 Demo 均无布局溢出。
- 使用临时用户数据目录模拟全新安装启动：只打开引导窗口，不打开设置页，并写入 `onboardingCompleted: true`。

## [0.3.7] - 2026-10-20

### Fixed

- 修复全屏 GIF 只有约 1.5 FPS、一帧一帧播放的问题：GIF 输出长边上限调整为 720，小选区不缩放。
- GIF 调色板改为“大帧降采样生成调色板 + 全帧映射”，降低每帧 quantize 成本。
- GIF 采集改为编码完成后立即排下一帧，不再被固定定时器串行拖慢。
- 结果卡会标注“已缩放至 720 长边以保证流畅”，方便确认大选区启用了降采样。
- 修复设置面板任务栏图标显示为 Codex 的问题：改为启动带 SnapGlass logo 的 `SnapGlass.exe`，设置新 AppUserModelID，并修复 `ready-to-show` 监听晚于 `loadRoute` 导致窗口不显示的竞态。
- 修复笔刷马赛克快速拖动时方块之间有空隙的问题：沿鼠标轨迹插值补格。
- 马赛克滑杆改为“像素密度”语义：1–100，数值越大越细腻，100 接近原图；笔刷宽度固定，矩形改用像素化渲染。
- 马赛克左侧新增圆点画笔大小控制（8–48px，默认 24px），与密度独立；密度 100 调整为 3px 块，透明度改为 95%。
- 工具条图标整体放大（主工具 20px、GIF 22px、操作图标 16px），收紧行间距和内边距，分隔线颜色调淡。
- 首次框选前预渲染并测量一级工具条，避免第一次框选结束后工具条延迟出现。
- 设置面板任务栏图标改为透明底 logo（无白色底板），设置窗阴影缩小约一半，避免被窗口边界裁成矩形。
- 录制结果卡未保存直接关闭时删除临时 GIF/视频文件；关闭按钮提示“关闭并删除未保存的临时文件”。
- 禁用覆盖层窗口的 Windows DWM 显示过渡，并改用 `showInactive`，按 F1 不再出现整屏放大的过场动画。
- 移除自定义 AppUserModelID，避免任务栏被旧缓存归到 Codex 图标。
- 覆盖层改为常驻透明窗口：空闲时 opacity 0、鼠标穿透，F1 只切换内容和不透明度，不再 show/hide，彻底避免窗口放大过场。
- GIF 工具图标改为清晰的 “GIF” 字样，尺寸 22px。
- 马赛克标注不再参与命中测试，画好后不能被拖动；调整滑杆后也不会误选旧马赛克。
- 马赛克笔刷大小圆点支持拖动和滚轮调节，笔刷实际宽度验证为 8–48px。
- 笔刷模式提供 90% 透明的圆形画笔光标，带蓝色边框，大小跟随笔刷尺寸变化。
- 修复切换到其他工具后马赛克退化成虚线边框的问题：选区背景画布不再随工具切换清空，旧马赛克始终可重绘。

### Verified

- `pnpm typecheck` 通过。
- `pnpm test` 通过：新增 GIF 720 长边上限测试。
- `pnpm build` 通过。
- 1918×1078 选区、3 秒全屏 GIF 实测：720×405、50 帧、3.40 秒，约 14.7 FPS；旧逻辑同场景约 1.5 FPS。
- `pnpm e2e:settings` 通过：设置窗品牌标记、图标资源、密钥存储均正常。
- 马赛克像素测试通过：默认笔刷连续、无空隙，矩形马赛克连续铺满；滑杆映射单测覆盖 4..24 全范围。

## [0.3.6] - 2026-10-20

### Fixed

- 修复 GIF 播放速度偏快的问题：不再给每帧固定写 `1000 / 15ms`，改为按两帧真实采集时间差写入 `delay`。
- 大选区下 GIF 量化慢、编码器丢帧时，播放总时长仍与真实录制时长一致，不再出现“开了加速”的效果。

### Verified

- `pnpm typecheck` 通过。
- `pnpm test` 通过：新增 GIF 帧间隔测试，覆盖首帧、正常间隔、丢帧长间隔和最小间隔。
- `pnpm build` 通过。
- 1918×1078 全屏 GIF 实测：录制 3435ms、12 帧，GIF 实际播放 3320ms；旧固定 delay 逻辑同帧数只会播放约 792ms。

## [0.3.5] - 2026-10-20

### Fixed

- 修复 GIF/视频开头中央闪一下 `0` 的问题：倒计时归零后不再渲染倒计时数字，并等待两帧完成合成后再启动录制。
- 修复全屏视频录制时红框、控制条看似消失且无法退出的问题：
  - 倒计时阶段也显示控制条，并提供取消按钮。
  - 录制阶段覆盖层降为 `floating`，控制条保持 `screen-saver`，避免控制条被全屏透明覆盖层压在下面。
  - 录制会话期间注册系统级 `Esc`，即使焦点在桌面也能取消并隐藏覆盖层。
  - 视频写入初始化增加 5 秒超时；倒计时后 12 秒仍未进入录制则自动中止并隐藏覆盖层。
- 录制启动各阶段增加 `RECORDER_START_BEGIN` / `RECORDER_FRESH_FRAME` / `RECORDER_VIDEO_STREAM_READY` / `RECORDER_MEDIA_STARTED` / `RECORDER_STATE_RECORDING_SENT` 日志。
- 渲染层和录制关键日志持久化到用户数据目录的 `snapglass.log`；托盘提示显示当前版本号，便于确认实际运行版本。

### Verified

- `pnpm typecheck` 通过。
- `pnpm test` 通过：10 个测试文件、54 个用例。
- `pnpm build` 通过。
- `pnpm e2e:recording` 通过：600×380 GIF/MP4，以及 1918×1078 全屏视频；全屏录制时控制条可见，可停止并生成结果卡。

## [0.3.4] - 2026-10-20

### Fixed

- 修复大选区框选/录制时整机桌面冻结的问题：
  - 选区外遮罩从 `box-shadow: 0 0 0 9999px` 改为四块纯色矩形，避免 Chromium 为透明全屏窗口分配超大阴影层。
  - 移除录制红框的全屏阴影脉冲动画，只保留静态描边和徽章闪烁。
  - 框选完成后的自动复制改为异步 `toBlob`，不再同步编码整张 PNG 阻塞渲染线程。
  - 马赛克背景改为选中工具后按选区懒加载，不再一进入标注就复制整屏像素。
- 覆盖层增加渲染心跳与主进程看门狗：5 秒无心跳、`unresponsive` 或 `render-process-gone` 时，立即鼠标穿透、隐藏覆盖层并清理会话。
- 渲染线程连续 2 秒无心跳后自动启用全局 `Esc` 逃生键，5 秒无心跳自动退出；正常标注时 `Esc` 仍交给界面处理。
- Windows 下视频录制强制使用软件编码，规避部分 NVIDIA 驱动硬件 H.264 编码卡死桌面的问题。
- 新增异常会话锁：上次截图/录制未正常结束时，下次启动自动进入兼容模式并关闭硬件加速。
- 录制准备阶段记录选区、物理尺寸、输出尺寸和编码格式，便于继续定位驱动相关问题。

### Verified

- `pnpm typecheck` 通过。
- `pnpm test` 通过：10 个测试文件、54 个用例。
- `pnpm build` 通过。
- `pnpm e2e:overlay` 通过：框选、四块遮罩、自动复制、录制待机、标注、缩放；1880×1030 大选区框选耗时约 443ms；额外阻塞渲染线程 7 秒，看门狗在 5.5 秒时自动隐藏覆盖层。
- `pnpm e2e:recording` 通过：600×380 GIF 与 MP4 录制、结果卡、剪切保存全部正常。

## [0.3.3] - 2026-10-20

### Changed

- 录制流程按设计 Demo 还原：开始按钮恢复“● 开始”文字；GIF 移除帧率下拉，固定 15 FPS。
- 倒计时改为选区中央 72px 数字、每个 700ms，使用 Demo 的 `cdpop` 动画。
- 开始录制后覆盖层不再隐藏，红框和 `REC` 徽章全程保留；暂停时徽章继续显示 `REC`。
- 红框改用 `outline` 画在选区外侧，录制裁剪只取选区内部，成片不包含红框和控制条。
- 录制态控制胶囊按 Demo 调整为 44px 高、32px 按钮、8px 红点、1s 闪烁。
- 结果卡按 Demo 调整为 300px 宽、84×52 缩略图、保存 / 打开文件并排，并加大上下内边距。
- 结果卡里的 GIF 预览改为 Blob URL 直接播放动图，并关闭预览窗后台节流，失焦后也持续播放。
- 结果卡显示 GIF 实际帧数，便于确认文件不是单帧图片。
- GIF 量化从 12 位 `rgb444` 提升到 16 位 `rgb565`，减少偏色和色带。
- GIF/视频开录前等待采集流交付新帧，避免首帧还是冻结截图。
- 保存改为剪切语义：文件移动到用户选择的位置，临时文件不再保留，结果卡同步更新文件名。
- 悬浮胶囊阴影缩小一半，移除帧率下拉后同时去掉系统下拉框的方块阴影。
- 冻结截图在倒计时结束后先撤掉并等待两帧，再启动采集，避免首帧录进截图界面。

### Fixed

- 修复点击开始录制后界面直接消失、红框不可见的问题。
- 修复视频录制开始后只剩独立控制窗、看起来“没起作用”的问题。
- 修复录制失败后不回到待机控制条的问题。
- 修复视频轨提前结束（实测只有 0.2～1.1 秒，音频却有 3 秒）的问题：离屏 canvas 的 `captureStream` 会停止出帧，改为挂到 DOM 后用 `captureStream(0)` + 每帧 `requestFrame()` 驱动。
- 修复 MP4 `avc1` 编码描述变化警告，MP4 优先使用 `avc3`。
- 修复视频写入磁盘失败时没有错误处理的问题，现在会取消录制并提示磁盘错误。
- 修复准备阶段全屏覆盖层可点击、冻结截图挡住桌面导致系统看起来死机的问题。
- 点开始后覆盖层立即鼠标穿透并撤掉冻结截图；准备阶段只保留红框和“准备中”徽章。
- 增加 9 秒渲染层初始化超时、10 秒主进程兜底，以及独立控制窗的“准备中…取消”入口。
- 录制会话期间注册全局 `Esc` 取消，覆盖层或渲染进程卡住时也能退出。
- 修复录制完成后第一次按 F1 无响应、必须按两次的问题。
- 修复“GIF 看起来是静态图片”的观感问题：结果卡现在直接播放 GIF，实际文件仍是多帧动图。

### Verified

- `pnpm typecheck` 通过。
- `pnpm test` 通过：10 个测试文件、51 个用例。
- `pnpm build` 通过。
- `pnpm e2e:overlay` 通过：开始文字、GIF 帧率下拉、待机红框。
- `pnpm e2e:recording` 通过：GIF/视频录制中红框可见、`REC` 徽章、居中控制条、结果卡、剪切保存；结果卡打开时 OverlayManager 已复位；模拟采集卡住后可点取消恢复标注界面。
- 动态目标验证通过：结果卡 GIF 缩略图在 1.2 秒内发生像素变化；保存文件为 39 帧、2.73 秒。
- 视频完整性验证通过：3 秒录制得到视频轨 3.24 秒、音频轨 3.18 秒，视频/音频时长一致；不再出现 `avc1` 编码描述变化警告。

## [0.3.2] - 2026-10-20

### Changed

- 待机控制条开始按钮去掉“开始”文字，改为 38px 红色圆形按钮 + 白色圆点 + 光晕。
- 移除 GIF 帧率设置，固定 15 FPS。
- 待机胶囊缩小到约 147×44（GIF），高度和宽度明显收紧。
- 录制控制条缩小到 180×56（GIF）/ 210×56（视频），并按选区 X 轴横向居中。
- 录制态去掉取消按钮，只保留 Demo 的红点、计时、暂停（仅视频）、停止。
- 停止后改为屏幕右下角“录制完成”结果卡，保持显示直到关闭；提供打开、保存、关闭。
- 结果卡使用 GIF 首帧作为缩略图；视频显示 MP4/WEBM 标识。
- 待机与录制统一为 Demo 的深色胶囊样式。

### Verified

- `pnpm typecheck` 通过。
- `pnpm build` 通过。
- `pnpm e2e:overlay` 通过：开始按钮无文字、无帧率下拉、胶囊居中。
- `pnpm e2e:recording` 通过：录制条中心与选区中心一致（440=440）、结果卡、保存。

## [0.3.1] - 2026-10-20

### Changed

- GIF/视频录制二级菜单改为初始 Demo 的胶囊控制条：开始、计时、参数、取消。
- 移除 620px 大设置面板，以及输出尺寸、倒计时两组选项。
- GIF 待机条显示帧率下拉（10/15/30 fps）；视频待机条显示麦克风/系统音开关。
- 倒计时固定为 3-2-1，选区内显示大号数字，待机控制条隐藏。
- 真正开录后才显示录制控制条（红点、计时、暂停/停止/取消）。
- 待机时显示红色选区框和“待机 · GIF/视频”徽章，红框不脉冲。
- 取消录制恢复一级工具条，不改变选区。

### Verified

- `pnpm typecheck` 通过。
- `pnpm build` 通过。
- `pnpm e2e:overlay` 通过：胶囊条居中、待机徽章、取消恢复工具条。
- `pnpm e2e:recording` 通过：GIF/视频录制、预览、首帧复制、保存。

## [0.3.0] - 2026-10-19

### Added

- P2 GIF 录制：10/15/30 FPS、原始/720/480 尺寸、3/1/0 秒倒计时、最长 60 秒。
- GIF 编码 Worker（`gifenc`，MIT），逐帧量化并支持 15 FPS / 30 FPS 录制。
- 录制控制条窗口：计时、红点、停止、取消；GIF 与视频共用。
- 录制预览窗口：GIF 动画/视频播放、尺寸、FPS、时长、文件大小、保存、重录。
- GIF 复制首帧 PNG，规避 Electron 无法读取 GIF 首帧的问题。
- P3 视频录制：选区录制、暂停/继续、最长 10 分钟、麦克风/系统音开关。
- 视频 MP4（H.264/AAC）优先，当前平台不支持时自动回退 WebM。
- 截图工具条 GIF/视频图标，托盘菜单与 F2/F4 快捷键入口。
- `snapglass-media://` 本地媒体协议，用于预览窗口安全读取临时文件。
- `e2e-recording.cjs` 覆盖 GIF/视频录制、预览、首帧复制和保存落盘。

### Changed

- GIF 入口从文字按钮改为图标按钮，与视频入口并排，保持工具条右对齐。
- 录制期间隐藏全屏覆盖层，避免 Windows 内容保护把整块捕获画面变黑。
- 原始尺寸录制长边限制为 1920，降低 4K GIF 的编码压力。

### Verified

- `pnpm typecheck` 通过。
- 51/51 Vitest 用例通过。
- `pnpm build` 通过，GIF Worker 正常打包。
- `pnpm e2e:overlay` 通过。
- `pnpm e2e:recording` 通过：GIF、MP4 视频、预览、首帧复制、保存文件。

### Known limitations

- 150% / 200% DPI、真实权限失败、系统音仍需在普通交互桌面手测。
- 全屏选区时控制条没有完全位于选区外的空间。
- GIF 30 FPS + 60 秒 + 原始尺寸会产生较大文件。

## [0.2.15] - 2026-10-19

### Added

- 新 mascot logo：圆角屏幕 + 两只眼睛 + 右上角取景角，参考用户提供的风格重新绘制。
- 托盘图标改为自适应黑白两版：深色任务栏用白色 glyph，浅色任务栏用黑色 glyph。
- 新增应用图标 `assets/icon.png` 与 Windows `assets/icon.ico`，用于窗口和安装包。
- 设置页标题左侧加入 mascot mark。
- README 顶部加入新 logo。

### Verified

- 设置页 E2E：`.brand-mark` 存在，启动和 Key 加密流程通过。
- OCR 弹框 E2E 通过。
- 应用图标、托盘 32/16px、ICO 均已生成并检查。

## [0.2.14] - 2026-10-19

### Removed

- 移除托盘菜单“恢复所有贴图鼠标交互”及其 `onRestorePins` 回调和 `restoreAllClickThrough` 方法。
- 托盘菜单现在只保留：截图、设置、退出。

### Note

- 贴图右键菜单中的“鼠标穿透”仍保留；如误开穿透，可重启 SnapGlass 恢复（贴图不持久化）。

## [0.2.13] - 2026-10-19

### Changed

- OCR 弹框点击“复制”后，复制文本并自动关闭弹框。
- 设置窗四周增加透明阴影边距：窗口 916×716，内容卡片仍为 860×660，外圈显示柔和阴影。
- 截图后的一级工具栏改为右边缘与选区右边缘对齐（实测选区右边 760，工具栏右边 760）。

### Verified

- OCR E2E：复制“你好世界”后弹框自动关闭。
- 设置页 E2E：阴影边距与 Key 加密流程通过。
- 覆盖层 E2E：工具条右对齐、8 手柄缩放、标注、复制全部通过。
- 43/43 单元测试通过。

## [0.2.12] - 2026-10-19

### Changed

- 翻译弹框移除底部“译成英文/译成中文”“翻译”“复制”三个按钮。
- 翻译弹框打开时自动翻译，原文改为只读；原文和译文都支持鼠标选中、Ctrl+C 复制。
- 移除翻译弹框的“打开设置”链接，未配置时只显示文字提示。
- 翻译弹框高度同步收紧。

### Verified

- 翻译弹框 E2E：无底部按钮、原文只读、原文/译文 `user-select: text`。
- OCR 弹框 E2E 回归通过。
- 43/43 单元测试通过。

## [0.2.11] - 2026-10-19

### Fixed

- 修复小选区 OCR 返回空结果：Windows OCR 对 30–40px 高的菜单文字不敏感，原图直接识别为空。
- OCR 前按选区高度自动放大：高度 <80px 放大 4 倍，<160px 放大 2 倍；上限 8192px / 1600 万像素。
- 实测 135×35 的托盘菜单文字从“空结果”变为正确识别“恢复所有贴图鼠标交互”。

### Added

- `--smoke-ocr-file <path>` 诊断模式，可直接用真实 OCR 管线识别指定图片。

### Verified

- 43/43 单元测试通过。
- OCR E2E 通过（识别“你好世界”、单词卡、复制、关闭）。

## [0.2.10] - 2026-10-19

### Added

- 冻结画面下鼠标移动自动识别下方窗口/控件，显示高亮与尺寸。
- 单击高亮窗口直接选中并进入标注；按住拖动仍为手动框选。
- 窗口查询使用常驻 PowerShell 助手：`EnumWindows` 找顶层窗口，MSAA `accHitTest` 取窗口内控件区域，DWM 取可见边框。
- 支持控件级吸附（视频播放器、工具栏、链接、页面内容等），不再只高亮整个顶层窗口。
- 悬停区域保持原亮度，窗口外变暗，边框改为实线。
- 主进程通过 Electron DPI 接口在 DIP 与物理像素间转换，支持高 DPI。
- 鼠标移动查询节流 30ms，助手启动时预热；实测常驻查询 7–12ms。

### Fixed

- 修复 `DwmGetWindowAttribute` P/Invoke 未指定 `EntryPoint` 导致窗口查询全部返回 `null`。

### Verified

- 窗口吸附 E2E：控件级高亮 166×40，单击后选区与高亮完全一致。
- 完整覆盖层 E2E：手动框选、8 手柄缩放、标注、复制全部通过。
- 42/42 单元测试、准备流程 E2E 通过。

## [0.2.9] - 2026-10-19

### Changed

- 移除“正在截取屏幕…”提示窗；F1 后不再提前显示全屏覆盖层。
- 新增 Windows GDI 快速截屏助手（常驻 PowerShell + `CopyFromScreen`），截屏约 160–300ms；失败自动回退 `desktopCapturer`。
- 覆盖层隐藏时关闭 Chromium 后台节流（`backgroundThrottling: false`），修复隔几秒再按 F1 时 rAF 延迟到 1 秒以上的问题。
- 启动时立即预热覆盖层，并做一次隐藏式 1×1 预热渲染，消除第一次 F1 的冷启动卡顿。
- 选区增加 8 个拖拽手柄（4 角 + 4 边中点），支持自由调整截图框大小；最小 8×8，限制在屏幕内。
- 从左边/上边缩放时已画标注跟随选区平移，撤销/重做历史同步平移。
- 标注画布拆分背景加载与尺寸更新，拖拽缩放时不再重复解码整张截图。
- 设置窗改为透明窗口，去掉圆角外的方角底色。

### Verified

- 真实全局 F1：首次 368ms，长间隔后续 278–402ms。
- 42/42 单元测试通过。
- 覆盖层 E2E：框选、8 手柄缩放、标注、自动复制、剪贴板通过。
- 准备流程 E2E：截屏期间覆盖层保持隐藏，注入完成后才显示。
- 设置页 E2E：启动、Key 加密保存/清除通过。

## [0.2.8] - 2026-10-19

### Changed

- F1 先立即显示蒙层并排除出屏幕捕获（`setContentProtection`），再在后台截取屏幕画面。
- 蒙层阶段显示“正在截取屏幕…”提示；截屏完成后填充冻结画面并进入框选。
- 覆盖层预热改为启动后 600ms 执行，缩短首次 F1 等待。

### Verified

- prepare E2E：蒙层先可见，随后冻结画面可见。
- 覆盖层自动复制、按钮顺序、标注 E2E 回归通过。

## [0.2.7] - 2026-10-19

### Changed

- 启动时不再同步预热所有显示器；改为启动后延迟预热当前显示器一个窗口。
- 预热窗口初始 opacity 0，显示前再设为 1，消除启动闪白。
- 打开设置页时把预热延后到 1.8 秒，优先保证设置窗口出现。
- 工具条操作顺序调整为：关闭、钉图、保存、复制。

### Added

- 框选完成后自动复制原始选区到剪贴板，并显示“截图已自动复制”。

### Verified

- 设置页启动耗时 974ms（含 Playwright 启动开销）。
- 自动复制 E2E 通过。
- 操作按钮顺序 E2E 通过：关闭、钉图、保存、复制。

## [0.2.6] - 2026-10-19

### Fixed

- 翻译请求改用 Electron `net.fetch`，跟随系统代理；免费翻译实测返回“你好世界”。

### Changed

- OCR/翻译窗口按内容自动调整高度，隐藏滚动条。
- OCR/翻译/设置窗口关闭 thick frame、系统阴影和圆角残留，移除四角拖拽白点。

### Verified

- 免费翻译真实联网 E2E 通过。
- OCR 窗口 620×170，翻译窗口 620×332。
- OCR 两轮、旧弹框自动关闭、设置页 Key 加密 E2E 通过。

## [0.2.5] - 2026-10-19

### Changed

- 翻译弹框改为紧凑布局：原文 + 译文 + 翻译/复制，高度 320px。
- 移除翻译弹框的标题、行数、词典、发音和说明文字。
- OCR、翻译、设置窗口全部禁止用户拖角缩放（`resizable:false`）。

### Verified

- OCR 单按钮/自动高度 E2E 通过。
- 翻译紧凑弹框 E2E 通过。
- 两轮 OCR + 旧弹框自动关闭 E2E 通过。
- 设置页 Key 加密 E2E 通过。

## [0.2.4] - 2026-10-19

### Changed

- OCR 弹框改为内容自适应高度：短文本约 160px，长文本按行数增高。
- OCR 弹框移除标题、行数、说明标签；顶部只保留拖动条和关闭，底部只保留复制。
- OCR 输入区改为紧凑文本卡，消除大面积空白。

## [0.2.3] - 2026-10-19

### Changed

- OCR 弹框只保留识别原文和“复制”一个动作按钮。
- 翻译功能拆到独立翻译弹框；OCR 弹框不再包含翻译、词典和发音。
- 新截图开始前自动关闭旧的 OCR/翻译弹框，同一时间只允许一个。

### Fixed

- 修复 OCR 只能成功一次的问题：关闭旧弹框、复用预热覆盖层并重置 OCR 窗口状态。
- 两轮连续 OCR E2E 通过。

### Planned

- 本地翻译模型锁定 OPUS-MT（en↔zh 量化 ONNX）；当前网络无法下载依赖/模型，尚未内置。

## [0.2.2] - 2026-10-19

### Changed

- 移除截图历史记录功能、设置页历史卡片和相关 IPC/存储。
- 钉图窗口增加 20px 阴影留白，图片四边显示完整阴影。
- OCR PowerShell 超时提高到 60 秒，OCR 空结果增加明确提示。

### Fixed

- 避免历史记录写入失败阻断 OCR 流程。

## [0.2.1] - 2026-10-19

### Added

- 免费翻译 provider（Google 公共接口，失败自动切 MyMemory，无需 Key，可能限流）。
- 单词卡支持“翻译此词”，词典未命中时可用免费翻译补充中文释义。

### Changed

- 工具栏、设置页、OCR 窗、贴图控件改为实色背景，移除界面透明度与背景模糊。
- 设置页翻译服务默认选择“免费翻译”。

### Verified

- 37/37 单元测试通过。
- OCR E2E 确认真实 provider 为免费翻译且无 Key 提示。
- 设置页截图、OCR 窗口截图、覆盖层工具栏截图为实色。

## [0.2.0] - 2026-10-19

### Added

- P1 OCR 管线：Windows.Media.Ocr 后端、中文空格清洗、临时图像清理。
- OCR 结果窗口：原文编辑、单词/句子分流、单词卡、发音、复制。
- 截图工具条“识别”和“翻译”入口；OCR 使用原始截图，不合成标注。
- OpenAI 兼容接口与 DeepL 翻译请求构造。
- 设置页翻译服务、接口地址、模型、目标语言和 API Key 配置。
- API Key 使用 Electron safeStorage 加密保存，渲染进程不接触明文。
- OCR、文本清洗、分流、词典、翻译请求单元测试。

### Verified

- 35/35 单元测试通过，含 Windows 中文 OCR 集成测试。
- 覆盖层 OCR 入口 E2E 通过（识别“你好世界”）。
- OCR 窗口 E2E 通过（单词卡、复制、编辑后切句子模式）。
- API Key 加密写入、明文不落盘、清除测试通过。

### Known limitations

- PaddleOCR 模型因网络拦截暂未下载，当前使用 Windows 系统 OCR。
- macOS OCR 后端待实机接入。
- ECDICT 数据未随包分发，当前使用内置常用词条。
- 翻译服务需要用户 Key 和可用网络，尚未做真实联网调用验证。

## [0.1.5] - 2026-10-19

### Added

- 文字编辑过程中切换加粗、斜体、下划线，输入框实时预览；提交后样式保留。

## [0.1.4] - 2026-10-19

### Fixed

- 再次点击文字进入编辑时立即重画画布并隐藏原文字，消除输入框与旧文字重叠的残影。

## [0.1.3] - 2026-10-19

### Fixed

- 文字命中区域改为按 Canvas 实测文字宽度计算，中文文字点击右侧也能进入原文字编辑，不再误新建文字。

## [0.1.2] - 2026-10-19

### Added

- 文字标注支持再次编辑：点击已有文字即可重新输入并更新内容。

### Changed

- 二级菜单与一级菜单之间改为贯穿整个工具条的分割线，展开/收起时同步显示/隐藏。

## [0.1.1] - 2026-10-19

### Fixed

- 文字工具改为释放鼠标后打开输入框，避免 pointer capture 抢走焦点。
- 覆盖层改为启动时预热；F1 只捕获当前显示器，减少等待时间。
- 钉图初始位置改为截图选区位置，不再跳到鼠标右下角。
- 钉图支持按住图片直接拖动，不再依赖顶部窄拖动条。
- 保存 PNG 始终弹出系统保存对话框，移除默认保存目录设置。
- 截图后二级菜单默认收起；点击已选工具展开，再次点击隐藏。
- 马赛克工具移除颜色色卡。
- 应用启动默认只驻留托盘，不再自动打开设置页；托盘右键打开设置。

## [0.1.0] - 2026-10-18

### Added

- Electron + React + TypeScript P0 工程骨架。
- 多显示器透明覆盖层、框选与标注编辑器。
- 矩形、椭圆、线条/箭头、马赛克、文字、序号。
- 手绘箭头稳定切线、平滑尾段、按线宽缩放箭头。
- 六种线型、无文字线型下拉、颜色板、线宽滚轮。
- 复制、保存 PNG、钉图。
- 置顶贴图窗：拖动、滚轮缩放、透明度、鼠标穿透、右键菜单。
- 托盘、设置页、保存目录、主题、开机自启、历史记录。
- Vitest 单测、Electron 设置页冒烟、覆盖层与贴图窗 E2E。

### Verified

- TypeScript 类型检查通过。
- 18/18 单元测试通过。
- 生产构建通过。
- 覆盖层 E2E：框选、手绘标注、复制剪贴板通过。
- 贴图 E2E：创建、复制、关闭通过。

### Known issues

- 当前开发机桌面捕获权限被拒绝，真实截屏需在普通交互桌面复测。
- macOS 实机尚未验证。
