/**
 * 轻量 i18n：以中文原文作为 key，英文词典按需补齐。
 * 背景：项目此前所有文案硬编码中文，语言设置只存不用。
 * 设计意图：不引入 i18n 依赖，渲染层与主进程共用同一份词典；
 *          变量使用 {name} 占位，缺失翻译时回退中文，避免界面出现 key。
 */

export type Language = 'zh-CN' | 'en-US'

const EN: Record<string, string> = {
  // ===== 设置页 =====
  '截图 · 贴图 · OCR 翻译 · 录屏': 'Screenshot · Pin · OCR Translate · Record',
  '关闭': 'Close',
  '快捷键': 'Shortcuts',
  '截图快捷键': 'Screenshot shortcut',
  '点击输入框后直接按下组合键': 'Click the field, then press the key combination',
  'OCR 与翻译': 'OCR & Translation',
  '翻译服务': 'Translation service',
  '不配置时只使用离线 OCR 与内置词典':
    'Without a provider, only offline OCR and the built-in dictionary are used',
  '未配置': 'Not configured',
  '免费翻译（公共接口）': 'Free translation (public endpoint)',
  'OpenAI 兼容接口': 'OpenAI-compatible API',
  '接口地址': 'Endpoint',
  '例如 https://api.openai.com/v1': 'e.g. https://api.openai.com/v1',
  '模型': 'Model',
  '用于翻译的模型名': 'Model name used for translation',
  'DeepL 接口': 'DeepL endpoint',
  '默认使用 api-free.deepl.com': 'Uses api-free.deepl.com by default',
  '免费翻译': 'Free translation',
  '使用 Google 公共接口，无需 Key；可能被限流或不可用':
    "Uses Google's public endpoint; no key required; may be rate-limited or unavailable",
  '目标语言': 'Target language',
  '单词卡片不受此项影响': 'Word cards are not affected',
  '简体中文': 'Simplified Chinese',
  '已加密保存到系统安全存储': 'Encrypted in the system keychain',
  '输入新 Key 可覆盖': 'Enter a new key to replace',
  '粘贴 API Key': 'Paste API key',
  '保存': 'Save',
  'API Key 已加密保存': 'API key saved and encrypted',
  'API Key 已清除': 'API key cleared',
  'OCR 当前使用 Windows 系统识别；PaddleOCR 与 ECDICT 数据待模型/数据可下载后接入。':
    'OCR currently uses Windows system recognition; PaddleOCR and ECDICT will be wired in when models/data are downloadable.',
  '外观与启动': 'Appearance & Startup',
  '主题': 'Theme',
  '跟随系统或固定深浅色': 'Follow the system or force light/dark',
  '跟随系统': 'System',
  '深色': 'Dark',
  '浅色': 'Light',
  '界面语言': 'Language',
  '新版本介绍': 'Release notes',
  '新功能': "What's new",
  '发现新版本': 'Update available',
  '发现新版本 v{version}': 'Update available: v{version}',
  '这次更新带来了这些变化：': "Here's what's new:",
  '性能与稳定性改进': 'Performance and stability improvements',
  '跳过此版本': 'Skip this version',
  '立即更新': 'Update now',
  '应用语言': 'App language',
  '切换整个应用界面，立即生效':
    'Changes the entire app interface immediately',
  '只影响翻译结果': 'Only affects translation output',
  '英文 → 中文': 'English → Chinese',
  '中文 → 英文': 'Chinese → English',
  '切换后立即生效': 'Applies immediately',
  '开机自启': 'Launch at login',
  '登录系统后自动驻留托盘': 'Stay in the tray after sign-in',
  '关于与更新': 'About & Updates',
  '诊断': 'Diagnostics',
  '诊断日志': 'Diagnostics log',
  '导出报告': 'Export report',
  '打开目录': 'Open folder',
  '诊断报告已导出': 'Diagnostics report exported',
  '已打开日志目录': 'Opened log folder',
  '崩溃报告': 'Crash reports',
  '{count} 份': '{count} reports',
  '最近 {time}': 'last {time}',
  '兼容模式': 'Compatibility mode',
  '已启用（上次会话异常退出）': 'Enabled (last session did not exit cleanly)',
  '未启用': 'Disabled',
  '立即写入日志': 'Flush log now',
  '诊断日志已写入': 'Diagnostics log flushed',
  '已打开崩溃报告目录': 'Opened crash report folder',
  '正在加载设置…': 'Loading settings…',
  '设置已保存': 'Settings saved',

  // ===== 更新状态 =====
  '正在检查更新…': 'Checking for updates…',
  '检查中…': 'Checking…',
  '正在连接更新源，通常不超过 15 秒':
    'Connecting to the update server; usually under 15 seconds',
  '已是最新版本': "You're up to date",
  '再次检查': 'Check again',
  '更新源暂无发布记录 · 发布新版本后会自动检测':
    'No releases published yet · new versions are detected automatically',
  '更新源 GitHub Releases · 已检查最新版本':
    'Source: GitHub Releases · latest version checked',
  '发现新版本 {version}': 'Version {version} available',
  '下载更新': 'Download update',
  '安装包约 {size} · 下载完成后会校验 SHA-512':
    'Installer is about {size} · SHA-512 verified after download',
  '下载完成后会校验 SHA-512': 'SHA-512 verified after download',
  '正在下载 {version}': 'Downloading {version}',
  '下载中…': 'Downloading…',
  '下载在后台进行，可以继续使用截图和 OCR':
    'Downloads in the background; you can keep using screenshot and OCR',
  '正在校验安装包…': 'Verifying installer…',
  '校验中…': 'Verifying…',
  '安装包已下载 · 正在校验 SHA-512': 'Installer downloaded · verifying SHA-512',
  '校验失败会阻止安装并提示重试':
    'A failed check blocks installation and asks you to retry',
  '{version} 已下载并校验完成，重启后安装':
    '{version} downloaded and verified; install after restart',
  '重启并安装': 'Restart and install',
  '安装包已校验': 'Installer verified',
  '重启会关闭当前窗口，安装完成后自动重新启动 Pixmint':
    'Restart closes this window and relaunches Pixmint after installation',
  '正在安装 {version}，应用即将重启…':
    'Installing {version}; the app will restart shortly…',
  '安装中…': 'Installing…',
  '正在替换程序文件': 'Replacing application files',
  '请不要手动关闭进程，安装完成后会自动启动':
    'Do not close the process manually; it will relaunch when installation finishes',
  '检查更新失败': 'Update check failed',
  '重试': 'Retry',
  '已下载 {size}': 'Downloaded {size}',
  '已写入诊断日志，可稍后重试': 'Written to diagnostics; try again later',
  '当前环境不检查更新': 'Updates are disabled in this environment',
  '检查更新': 'Check for updates',
  '检查更新，获取最新功能与修复':
    'Check for updates to get the latest features and fixes',
  '更新源 GitHub Releases · 下载后校验 SHA-512 · 重启后完成安装':
    'Source: GitHub Releases · SHA-512 verified · installs after restart',
  '更新源暂无发布版本': 'No releases available',
  '更新源不可用，请稍后重试': 'Update server unavailable; try again later',
  '安装包校验失败，已阻止安装': 'Installer checksum failed; installation blocked',
  '检查更新失败：无法连接更新源':
    'Update check failed: cannot reach the update server',
  '磁盘空间不足，无法下载更新': 'Not enough disk space to download the update',
  '安装失败，请手动下载最新版本':
    'Installation failed; download the latest version manually',
  '检查更新失败：{message}': 'Update check failed: {message}',

  // ===== 覆盖层工具栏 =====
  '带箭头': 'Arrow',
  '纯线条': 'Line',
  '双箭头': 'Double arrow',
  '线条样式': 'Line style',
  '线条端样式：{label}': 'Line ends: {label}',
  '滚轮调节粗细': 'Scroll to adjust width',
  '矩形 / 椭圆': 'Rectangle / Ellipse',
  '线条 / 箭头': 'Line / Arrow',
  '马赛克': 'Mosaic',
  '文字': 'Text',
  '序号': 'Number',
  '撤销 Ctrl+Z': 'Undo Ctrl+Z',
  '重做 Ctrl+Shift+Z': 'Redo Ctrl+Shift+Z',
  '完成编辑': 'Finish editing',
  '完成': 'Done',
  '识别选区文字': 'Recognize text in selection',
  '识别': 'Recognize',
  '识别并翻译': 'Recognize and translate',
  '翻译': 'Translate',
  '录制 GIF': 'Record GIF',
  '录制视频': 'Record video',
  '钉图': 'Pin',
  '矩形': 'Rectangle',
  '椭圆': 'Ellipse',
  '实线': 'Solid',
  '细线': 'Thin',
  '点线': 'Dotted',
  '马赛克画笔大小：拖动圆点或滑杆调节':
    'Mosaic brush size: drag the dot or use the slider',
  '拖动调整画笔大小': 'Drag to adjust brush size',
  '马赛克画笔大小': 'Mosaic brush size',
  '笔刷马赛克': 'Brush mosaic',
  '矩形马赛克': 'Rectangle mosaic',
  '马赛克密度：数值越大越细腻': 'Mosaic density: higher is finer',
  '加粗': 'Bold',
  '斜体': 'Italic',
  '下划线': 'Underline',
  '复制': 'Copy',

  // ===== 覆盖层提示 =====
  '选区太小，至少需要 64 × 64': 'Selection is too small; at least 64 × 64',
  '录制初始化超时，请重试': 'Recording setup timed out; try again',
  '3 秒后开始': 'Starts in 3 seconds',
  '视频': 'Video',
  '准备中 · {label}': 'Preparing · {label}',
  '待机 · {label}': 'Ready · {label}',
  '正在生成': 'Generating',
  '正在生成…': 'Generating…',

  // ===== OCR 窗口 =====
  '请先在设置页选择翻译服务': 'Choose a translation service in settings first',
  '请先在设置页配置翻译 API Key':
    'Configure a translation API key in settings first',
  '正在打开结果…': 'Opening result…',
  '未识别到文字。请重新截图并放大文字区域，或确认 Windows OCR 语言包已安装。':
    'No text detected. Take a new screenshot and enlarge the text area, or make sure the Windows OCR language pack is installed.',
  '英 {value}': 'UK {value}',
  '美 {value}': 'US {value}',
  '请选择': 'Select',
  '翻译方向': 'Translation direction',
  '翻译中…': 'Translating…',
  '译文会显示在这里': 'Translation will appear here',
  '未配置翻译服务，请先在托盘设置中配置。':
    'No translation service configured. Set it up in settings first.',

  // ===== 钉图 =====
  '无法进入编辑模式': 'Cannot enter edit mode',
  '生成编辑图片失败': 'Failed to create the edited image',
  '保存编辑失败': 'Failed to save the edit',
  '文字已可选中': 'Text is selectable',
  '未识别到文字': 'No text detected',
  '已识别文字，可拖选复制': 'Text recognized; drag to select and copy',
  '文字识别失败': 'Text recognition failed',
  '已复制选中文字': 'Selected text copied',
  '复制文字失败': 'Failed to copy text',
  '鼠标穿透已开启，可从托盘恢复': 'Mouse passthrough on; restore from the tray',
  '鼠标穿透已关闭': 'Mouse passthrough off',
  '识别文字中…': 'Recognizing text…',
  '文字识别不可用': 'Text recognition unavailable',
  '识别文字': 'Recognize text',
  '已复制': 'Copied',
  '已复制颜色 {color}': 'Color {color} copied',
  '按 C 复制颜色值': 'Press C to copy the color',
  '按 Shift 切换 RGB/HEX': 'Press Shift to switch RGB/HEX',
  '已保存': 'Saved',
  '保存失败': 'Save failed',
  '鼠标穿透': 'Mouse passthrough',

  // ===== 意见反馈 =====
  '请先填写反馈内容。': 'Please enter your feedback first.',
  '反馈内容不能超过 1000 字。': 'Feedback cannot exceed 1000 characters.',
  '反馈内容太短，请再补充一些细节。':
    'Feedback is too short; add a little more detail.',
  '本次反馈标识异常，请再试一次。':
    'Something went wrong with this submission; please try again.',
  '最多只能粘贴 10 张截图。': 'You can paste up to 10 screenshots.',
  '截图格式不支持，请重新复制后再粘贴。':
    'Unsupported image format; copy it again and paste.',
  '截图内容为空，请重新复制。': 'The screenshot is empty; copy it again.',
  '截图压缩后仍超过 5MB，请减少截图范围。':
    'Still over 5MB after compression; capture a smaller area.',
  '截图总大小超出上限，请删除部分截图。':
    'Total attachment size is over the limit; remove some screenshots.',
  '反馈已提交，但后台没有返回反馈编号，截图无法上传。':
    'Feedback was submitted, but no ticket ID was returned, so screenshots cannot be uploaded.',
  '反馈已提交，但后台附件接口尚未就绪。':
    'Feedback was submitted, but the attachment endpoint is not ready yet.',
  '截图或内容超过后台限制，请减少后重试。':
    'Content or attachments exceed server limits; reduce and try again.',
  '提交失败，请稍后再试。': 'Submission failed; try again later.',
  '网络不可用，反馈会进入发送队列。':
    'Network unavailable; feedback will be queued.',
  '截图上传失败，文字反馈已保存。':
    'Screenshot upload failed; text feedback was saved.',
  '后台附件接口尚未就绪，文字反馈已保存。':
    'Attachment endpoint not ready; text feedback was saved.',
  '有截图超过 5MB，文字反馈已保存。':
    'A screenshot is over 5MB; text feedback was saved.',
  '截图上传时网络中断，文字反馈已保存。':
    'Network dropped during upload; text feedback was saved.',
  '最多只能粘贴 {count} 张截图': 'You can paste up to {count} screenshots',
  '截图 {index}': 'Screenshot {index}',
  '最多 {count} 张，已保留前 {kept} 张':
    'Up to {count}; kept the first {kept}',
  '已粘贴 {count} 张截图': 'Pasted {count} screenshots',
  '截图处理失败，请移除后重试。':
    'Failed to process the screenshot; remove it and try again.',
  '意见反馈': 'Feedback',
  '遇到问题，或者有想做的功能，都可以告诉我们。截图能帮助定位得更快。':
    'Found a bug or have an idea? Tell us. A screenshot helps us locate the issue faster.',
  '反馈内容': 'Feedback',
  '必填': 'Required',
  '已粘贴的截图': 'Pasted screenshots',
  '移除截图 {index}': 'Remove screenshot {index}',
  '描述你遇到的问题或建议。截图后直接按 Ctrl+V，粘贴进来。':
    'Describe the problem or suggestion. Press Ctrl+V to paste a screenshot.',
  '直接粘贴截图，超过 5MB 自动压缩':
    'Paste screenshots directly; over 5MB is compressed automatically',
  '{current} / {max} 张': '{current} / {max}',
  '提交内容、版本号、系统版本和截图会发送到 Pixmint 反馈后台。':
    'Your message, version, OS version, and screenshots are sent to the feedback backend.',
  '取消': 'Cancel',
  '正在提交…': 'Submitting…',
  '提交反馈': 'Submit feedback',
  '已加入发送队列': 'Added to the queue',
  '反馈已发送': 'Feedback sent',
  '网络暂时不可用，文字反馈会在恢复后自动发送。':
    'Network is temporarily unavailable; text feedback will be sent automatically when it recovers.',
  '谢谢你帮助 Pixmint 变得更好。我们会认真读完每一条反馈。':
    'Thanks for helping make Pixmint better. We read every piece of feedback.',
  '已提交文字与 {count} 张截图': 'Submitted text and {count} screenshots',
  '已提交文字反馈': 'Text feedback submitted',
  '文字已提交，{count} 张截图未上传':
    'Text submitted; {count} screenshots were not uploaded',
  '截图不会跨重启保留': 'Screenshots do not survive a restart',
  '网络恢复后会在当前运行期间继续上传；关闭 Pixmint 前请保持联网。':
    'Uploads continue while the app is running once the network returns; stay online before quitting Pixmint.',
  '再写一条': 'Write another',

  // ===== 首次引导 =====
  '02 · GIF 动画': '02 · GIF',
  '支持录制 GIF 动画': 'Record GIF animations',
  '划定区域后点 GIF 按钮，自动录制框选区域，':
    'Select an area, hit GIF, and record it automatically — ',
  '最长 60 秒': 'up to 60 seconds',
  'GIF 录制': 'GIF recording',
  '选区录制': 'Selection recording',
  '03 · 视频': '03 · Video',
  '视频也能录制': 'Video recording too',
  '按框选区域录制视频，支持麦克风和系统声音，':
    'Record a selected area with microphone and system audio, ',
  '高清 1080P': 'up to 1080p',
  '视频录制': 'Video recording',
  '04 · 识别与翻译': '04 · OCR & Translation',
  'OCR、翻译页都有': 'OCR and translation built in',
  '框选内容，OCR 识别、翻译任你选，一键复制更方便。':
    'Select content, recognize or translate it, and copy in one click.',
  'OCR 识别': 'OCR',
  '中英互译': 'Chinese ↔ English',
  '把眼前的文字，': 'Turn what you see',
  '变成可以继续使用的文本。': 'into text you can use.',
  '识别原文': 'Recognized text',
  '把眼前的文字，变成可以继续使用的文本。':
    'Turn what you see into text you can use.',
  '翻译结果': 'Translation',
  '04 · 快捷键': '04 · Shortcut',
  '按一下 {key}，': 'Press {key},',
  '截下眼前的画面。': 'capture what you see.',
  'Pixmint 会安静地待在系统托盘。需要截图时，按下默认快捷键即可直接框选区域。':
    'Pixmint stays quietly in the system tray. Press the shortcut to select an area.',
  '默认截图快捷键': 'Default screenshot shortcut',
  '之后可在设置中修改': 'Change it later in settings',
  '框选截图': 'Capture',
  '标注': 'Annotate',
  '05 · 划线工具': '05 · Line tool',
  '拖一下，': 'Drag once,',
  '或者点两下。': 'or click twice.',
  '按住鼠标拖拽可以自由画线；也可以先单击起点，再单击终点，拉出一条直线。':
    'Drag to draw freely, or click the start and end points to draw a straight line.',
  '按住拖拽': 'Drag',
  '想画多长，就拖多长': 'Drag as far as you need',
  '单击两次': 'Click twice',
  '第一次定起点，第二次定终点':
    'First click sets the start, the second sets the end',
  '线条风格': 'Line styles',
  '画好后，切回线条工具仍可拖动；文字可拖动，单击继续编辑。':
    'After drawing, switch back to the line tool to move it; text can be dragged and clicked to edit.',
  '两种方式都会循环演示': 'Both methods loop automatically',
  '重播': 'Replay',
  '跳过': 'Skip',
  '上一步': 'Back',
  '下一步': 'Next',
  '开始使用': 'Get started',
  '第 {n} 页': 'Page {n}',
  '引导进度': 'Onboarding progress',
  '软件中的线条风格选项': 'Line style options in the app',
  '划线工具两种用法动画': 'Line tool demo',
  '按快捷键呼出区域截图示意': 'Screenshot shortcut demo',
  'Pixmint 首次使用引导': 'Pixmint onboarding',
  '{key} 已按下 · 正在框选': '{key} pressed · selecting',

  // ===== 录制界面 =====
  '原始': 'Original',
  '3 秒': '3s',
  '1 秒': '1s',
  '最长 10 分钟': 'up to 10 minutes',
  '帧率': 'Frame rate',
  '声音': 'Audio',
  '麦克风': 'Microphone',
  '系统音': 'System audio',
  '输出尺寸': 'Output size',
  '倒计时': 'Countdown',
  '开始录制': 'Start recording',
  '建议先把鼠标移到选区外，避免录进点击动作。':
    'Move the cursor outside the selection first to avoid recording clicks.',
  '系统音依赖系统与平台支持，不可用时会自动静音。':
    'System audio depends on the OS and platform; it mutes automatically when unavailable.',
  '返回工具条': 'Back to toolbar',
  '录制设置': 'Recording settings',
  '开始': 'Start',
  '取消录制': 'Cancel recording',
  '准备中…': 'Preparing…',
  '倒计时…': 'Countdown…',
  '继续': 'Resume',
  '暂停': 'Pause',
  '停止': 'Stop',
  '保存中…': 'Saving…',
  '打开文件': 'Open file',
  '关闭并删除未保存的临时文件':
    'Close and delete the unsaved temporary file',
  '{count} 帧': '{count} frames',
  '已达 1 分钟上限': '1-minute limit reached',
  '已达 10 分钟上限': '10-minute limit reached',
  '屏幕画面加载超时': 'Screen capture timed out',
  '无法读取屏幕画面，请检查屏幕录制权限':
    'Cannot read the screen; check screen recording permission.',
  '无法创建录制画布': 'Cannot create the recording canvas.',
  '视频录制器尚未准备好': 'Video recorder is not ready.',
  '视频写入初始化超时，请重试':
    'Video writer initialization timed out; try again.',
  'GIF 编码器未启动': 'GIF encoder is not running.',
  'GIF 编码超时': 'GIF encoding timed out.',
  '录制画布未准备好': 'Recording canvas is not ready.',
  '当前系统不支持视频录制编码':
    'Video encoding is not supported on this system.',
  '麦克风不可用': 'Microphone unavailable',
  '系统音不可用': 'System audio unavailable',
  '视频录制失败': 'Video recording failed',
  '视频录制器未启动': 'Video recorder did not start',
  '视频元数据缺失': 'Video metadata missing',

  // ===== 主进程提示 =====
  '上次截图/录制会话未正常结束': 'Last capture/recording session did not end cleanly',
  '快捷键 {key} 注册失败，可能已被占用':
    'Shortcut {key} could not be registered; it may be in use.',
  '快捷键 {key} 无效': 'Shortcut {key} is invalid.',
  '上次截图/录制异常退出，已启用兼容模式':
    'The last capture/recording session exited unexpectedly; compatibility mode is on.',
  'Pixmint 已启动，右键托盘图标打开设置':
    'Pixmint is running. Right-click the tray icon to open settings.',
  '截图超时，请检查屏幕录制权限':
    'Screenshot timed out; check screen recording permission.',
  '截图失败': 'Screenshot failed',
  '已复制到剪贴板': 'Copied to clipboard',
  '保存截图': 'Save screenshot',
  'PNG 图片': 'PNG image',
  '已保存：{path}': 'Saved: {path}',
  '识别中...': 'Recognizing...',
  'OCR 失败': 'OCR failed',
  '录制初始化超时，已退出': 'Recording setup timed out; exited.',
  '共 {count} 帧 · 调色板两遍量化': '{count} frames · two-pass palette quantization',
  ' · 已缩放至 720 长边以保证流畅': ' · scaled to 720px long edge for smoothness',
  '视频写入失败，请检查磁盘空间':
    'Failed to write video; check disk space.',
  '没有可读取的录制结果': 'No recording result available.',
  'GIF 图片': 'GIF image',
  'MP4 视频': 'MP4 video',
  'WebM 视频': 'WebM video',
  '保存 GIF': 'Save GIF',
  '保存视频': 'Save video',
  '没有可复制的录制结果': 'No recording result to copy.',
  '视频不支持复制到剪贴板，请使用保存':
    'Video cannot be copied to the clipboard; use Save.',
  '无法读取 GIF 首帧': 'Cannot read the GIF first frame.',
  '已复制 GIF 首帧到剪贴板': 'Copied the GIF first frame to the clipboard.',
  '没有可用的屏幕录制源，请检查屏幕录制权限':
    'No screen capture source available; check screen recording permission.',
  '录制完成': 'Recording complete',
  '录制启动超时，已退出': 'Recording start timed out; exited.',
  '录制已取消': 'Recording cancelled',
  '未配置翻译 API Key，请先在设置页配置':
    'Translation API key is not configured; set it in settings.',

  // ===== 购买 / 授权 =====
  '升级 Pixmint Pro': 'Upgrade to Pixmint Pro',
  '免费额度': 'Free quota',
  '今日 {limit} 次 {feature}用完啦，明天再来吧！':
    "You've used all {limit} {feature} runs today. Come back tomorrow!",
  '你已是 Pro，感谢支持': "You're already Pro. Thank you!",
  '升级 Pro，解锁无限使用': 'Go Pro for unlimited use',
  '截图、标注、钉图永久免费；Pro 解锁 OCR、翻译、GIF 与视频录制无限次。':
    'Screenshots, annotations and pins stay free. Pro unlocks unlimited OCR, translation, GIF and video recording.',
  '截图、标注、钉图永久免费；Pro解锁OCR、翻译、GIF与视频录制无限次，也包括后续即将上线的新奇功能哦~':
    'Screenshots, annotations and pins stay free. Pro unlocks unlimited OCR, translation, GIF and video recording, plus all the exciting new features coming soon~',
  '按月': 'Monthly',
  '按年': 'Yearly',
  '终身': 'Lifetime',
  '¥9 / 月': '¥9 / month',
  '¥80 / 年': '¥80 / year',
  '¥198': '¥198',
  '30 天 Pro': '30 days of Pro',
  '365 天 Pro': '365 days of Pro',
  '30 天完整 Pro': '30 days of full Pro',
  '365 天完整 Pro': '365 days of full Pro',
  '一次': 'one-time',
  '省 26%': 'Save 26%',
  '最划算': 'Best value',
  '无限 OCR': 'Unlimited OCR',
  '无限翻译': 'Unlimited translation',
  'GIF / 视频无限录制': 'Unlimited GIF / video',
  '未来 Pro 功能': 'Future Pro features',
  '永久使用 · 1.x 免费更新': 'Lifetime use · free 1.x updates',
  '支付方式': 'Payment method',
  '支付宝': 'Alipay',
  '微信支付': 'WeChat Pay',
  '正在创建订单…': 'Creating order…',
  '立即购买': 'Buy now',
  '已有激活码 / 换电脑恢复': 'I have a code / restore on a new PC',
  '已有激活码': 'I have a code',
  '换电脑恢复只需输入激活码，一个激活码最多绑定 5 台设备。':
    'To restore on a new PC, just enter your activation code; one code binds up to 5 devices.',
  '填写邀请码，领 7 天 Pro': 'Enter an invite code for 7 days of Pro',
  '扫码支付': 'Scan to pay',
  '用手机扫码完成支付': 'Scan the code with your phone',
  '支付成功后会自动激活，本窗口无需其他操作。':
    'Your device activates automatically after payment; no further action needed here.',
  '支付二维码': 'Payment QR code',
  '二维码生成中…': 'Generating QR code…',
  '请使用支付宝扫码': 'Scan with Alipay',
  '请使用微信扫码；如无法支付，请在手机浏览器打开':
    'Scan with WeChat; if payment fails, open the link in your phone browser',
  '返回套餐': 'Back to plans',
  '已激活': 'Activated',
  'Pro 已激活': 'Pro activated',
  '授权已更新': 'License updated',
  '有效期至 {date}': 'Valid until {date}',
  '已解锁全部 Pro 功能': 'All Pro features unlocked',
  '激活码': 'Activation code',
  '输入邮箱，把激活码发给你': 'Enter your email and we will send the code',
  '发送': 'Send',
  '换电脑时输入这个激活码即可，一个激活码最多绑定 5 台设备。':
    'Enter this code on a new PC. One code can bind up to 5 devices.',
  '恢复购买': 'Restore purchase',
  '输入激活码': 'Enter activation code',
  '换电脑或重装后，在这里输入购买时收到的激活码。':
    'After switching PCs or reinstalling, enter the code you received at purchase.',
  '粘贴激活码': 'Paste activation code',
  '激活中…': 'Activating…',
  '激活': 'Activate',
  '返回': 'Back',
  '邀请码': 'Invite code',
  '领取 7 天 Pro': 'Claim 7 days of Pro',
  '仅限新设备，每台设备只能领取一次。':
    'New devices only; each device can claim once.',
  '输入邀请码': 'Enter invite code',
  '领取中…': 'Claiming…',
  '截图 · 标注 · 钉图 永久免费': 'Screenshot · Annotate · Pin are free forever',
  '支持支付宝 / 微信': 'Alipay / WeChat supported',
  '今日翻译次数已用完，明天再来吧': 'Translation limit reached for today. Come back tomorrow.',
  '支付暂未开放，请稍后再试': 'Payments are not open yet. Please try again later.',
  '二维码已过期，请重新下单': 'QR code expired. Please place a new order.',
  '订单已退款': 'Order refunded',
  '激活码已发送到 {email}': 'Activation code sent to {email}',
  '激活码已复制': 'Activation code copied',
  'Pixmint Pro': 'Pixmint Pro',
  '免费版': 'Free',
  '永久授权': 'Lifetime license',
  '每日免费额度': 'Daily free quota',
  '今日剩余：OCR {ocr}/{ocrLimit} · 翻译 {translate}/{translateLimit} · GIF {gif}/{gifLimit} · 视频 {video}/{videoLimit}':
    'Remaining today: OCR {ocr}/{ocrLimit} · Translation {translate}/{translateLimit} · GIF {gif}/{gifLimit} · Video {video}/{videoLimit}',
  '管理授权': 'Manage license',
  '管理设备': 'Manage devices',
  '授权设备': 'Licensed devices',
  '当前已绑定 {used}/{max} 台设备': '{used}/{max} devices bound',
  '一个激活码最多绑定 5 台设备；解绑后该设备下次使用需要重新激活。':
    'One code binds up to 5 devices. After unbinding, that device must activate again.',
  '正在加载设备…': 'Loading devices…',
  '还没有绑定设备，或当前没有可管理的授权。':
    'No devices bound, or no license to manage.',
  '本机': 'This PC',
  '最后使用 {date}': 'Last used {date}',
  '当前设备': 'Current device',
  '确认解绑': 'Confirm unbind',
  '解绑': 'Unbind',
  '已解绑该设备': 'Device unbound',
  '升级 Pro': 'Upgrade to Pro',
  '换电脑时输入此码，最多绑定 5 台设备':
    'Enter this code on a new PC; up to 5 devices',
  '接收激活码的邮箱': 'Email for your activation code',
  '付款确认后会自动把激活码发到这个邮箱':
    'We will email the activation code here after payment is confirmed.',
  '生成订单并付款': 'Create order and pay',
  '支付 {amount}': 'Pay {amount}',
  '{plan} · 付款后人工确认，通常 10 分钟内完成':
    '{plan} · Manually confirmed after payment, usually within 10 minutes',
  '订单号': 'Order number',
  '收款二维码': 'Payment QR code',
  '收款码暂未配置，请联系客服并说明订单号':
    'Payment QR code is not configured yet. Contact support with your order number.',
  '收款码加载失败，请检查网络':
    'Failed to load the payment QR code. Check your network and try again.',
  '重新加载': 'Reload',
  '请使用微信扫码': 'Scan with WeChat',
  '扫码付款 {amount}': 'Scan and pay {amount}',
  '付款备注填写订单号 {order}': 'Put order number {order} in the payment note',
  '回到此窗口点「我已完成支付」':
    'Return to this window and click "I have paid"',
  '虚拟商品，付款后不支持退款。人工确认通常 10 分钟内完成。':
    'Digital goods are non-refundable. Manual confirmation usually takes under 10 minutes.',
  '我已完成支付': 'I have paid',
  '等待确认': 'Awaiting confirmation',
  '正在核对付款': 'Verifying your payment',
  '已收到你的付款信息，人工确认通常 10 分钟内完成。此窗口会自动更新，无需重复操作。':
    'We received your payment details. Manual confirmation usually takes under 10 minutes; this window updates automatically.',
  '确认后会自动激活，并把激活码发送到 {email}':
    'Once confirmed, Pro activates automatically and the code is emailed to {email}.',
  '激活码已发送至 {email}': 'Activation code sent to {email}',
  '自动发信失败：{error}': 'Automatic email failed: {error}',
  '重新发送': 'Resend',
  '邮箱（用于接收激活码）': 'Email (for your activation code)',
  '请填写正确的邮箱，用于接收激活码':
    'Enter a valid email to receive your activation code.',
  '下单失败，请稍后再试': 'Could not create the order. Please try again.',
  '提交失败，请稍后再试': 'Could not submit. Please try again.',
  '订单未通过审核，请重新下单':
    'The order was not approved. Please place a new order.',
  '订单已过期，请重新下单': 'The order expired. Please place a new order.',
  '订单号已复制': 'Order number copied',

  // ===== 托盘 =====
  '截图  F1': 'Screenshot  F1',
  '设置': 'Settings',
  '意见反馈…': 'Send feedback…',
  '退出 Pixmint': 'Quit Pixmint'
}

export function t(
  language: Language | undefined,
  zh: string,
  vars?: Record<string, string | number>
): string {
  const template = language === 'en-US' ? EN[zh] ?? zh : zh
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key])
  )
}

export function isEnglish(language: Language | undefined): boolean {
  return language === 'en-US'
}
