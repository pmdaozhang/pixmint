# P1 OCR + 翻译 · 实施计划

> 上游：`docs/features/P1-ocr-translation.md`  
> 分支：`feat/p1-ocr-translation`

## 1. OCR 管线

- [x] 定义 `OcrProvider` 接口与 `OcrResult`
- [x] 实现 Windows.Media.Ocr PowerShell 助手
- [x] 实现 OCR 文本清洗（中文空格、标点）
- [x] 实现 `recognizeImageDataUrl`：临时 PNG、调用后端、清理
- [x] 增加 OCR 清洗/分流单元测试
- [x] 固定中文测试图跑通 Windows OCR

## 2. OCR 结果窗口

- [x] 主进程 `OcrManager`，IPC `ocr:ready/close/open-settings`
- [x] 渲染路由 `#ocr`
- [x] 毛玻璃窗口：标题、关闭、原文编辑
- [x] 单词卡片 / 句子面板分流
- [x] 发音、复制
- [x] 未配置翻译引导

## 3. 翻译

- [x] Settings 增加 provider/endpoint/model/target
- [x] `SecretStore` 使用 `safeStorage`
- [x] OpenAI 兼容请求构造与解析
- [x] DeepL 请求构造与解析
- [x] `translation:translate` IPC
- [x] 设置页 Key 保存/清除与状态提示
- [x] 翻译请求构造单元测试

## 4. 词典

- [x] `DictionaryProvider` 接口
- [x] 内置常用词条（含音标/词性/释义）
- [x] 未命中状态
- [ ] 预留 ECDICT SQLite provider

## 5. 入口联动

- [x] 标注工具条“识别”走 OCR
- [x] 标注工具条“翻译”走 OCR + 自动翻译
- [x] OCR 使用原始截图，不合成标注
- [x] History 记录 action=ocr

## 6. 验证

- [x] TypeScript 类型检查
- [x] Vitest 全部通过（35/35）
- [x] Electron 构建
- [x] OCR 窗口 E2E
- [x] 设置页冒烟
- [x] 文档/CHANGELOG/ROADMAP 更新
- [ ] 合并回 main 并打 v0.2.0

## 依赖与风险

- PaddleOCR 模型无法下载 → Windows OCR 先行，接口保留
- ECDICT 数据缺失 → 内置词条 + 缺失提示
- 翻译网络不可用 → 请求构造单测 + 无 Key 不 Mock
