# Pixmint 反馈后台对接契约

这份文档是实现依据。Pixmint 客户端按这里的字段、错误码和附件接口对接；
后台可以按同一契约调整白名单和数据库字段。

## 1. 基本参数

- 工具标识：`tool = "pixmint"`
- 默认类型：`type = "other"`
- 文本接口：`POST https://data.hugproducthub.top/api/v1/feedback`
- 附件接口：`POST https://data.hugproducthub.top/api/v1/feedback/<feedback_id>/attachments`
- 客户端只从主进程发起请求，不走渲染层，因此不需要 CORS。
- 生产默认必须 HTTPS。

## 2. 文本提交

请求头：

```http
Content-Type: application/json
```

请求体：

```json
{
  "tool": "pixmint",
  "type": "other",
  "content": "用户填写的反馈内容",
  "version": "0.6.1",
  "request_id": "7d0f2dad-3c55-4a48-8c26-44f26c2631e5",
  "platform": "win32",
  "os_version": "10.0.26100",
  "arch": "x64"
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `tool` | 是 | 固定 `pixmint` |
| `type` | 是 | 当前固定 `other`；以后加分类时再扩展 |
| `content` | 是 | 1–1000 字，客户端已去掉首尾空白 |
| `version` | 是 | `app.getVersion()` |
| `request_id` | 是 | UUID，客户端重试复用，后台必须做唯一索引 |
| `platform` | 否 | `process.platform` |
| `os_version` | 否 | `os.release()` |
| `arch` | 否 | `process.arch` |

成功响应：

```http
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "id": "fb_01J...",
  "request_id": "7d0f2dad-3c55-4a48-8c26-44f26c2631e5"
}
```

幂等重试允许返回 `200` 和已有记录的 `id`。客户端接受任意 2xx，但附件上传需要
响应中存在非空 `id`。

## 3. 错误码

| 状态 | 客户端行为 |
|---|---|
| 400 | 不重试，展示错误；当前处理 `content_too_short`、`content_too_long`、字段缺失 |
| 413 | 不重试，展示请求过大 |
| 429 | 按 2s → 8s → 30s 重试，之后留在本地队列 |
| 5xx | 按 2s → 8s → 30s 重试，之后留在本地队列 |
| 网络错误 / 超时 | 进入本地队列，自动补发 |

错误响应建议：

```json
{ "error": "content_too_short" }
```

## 4. 附件上传

附件接口已在生产上线，并已通过真实联调：

```http
POST /api/v1/feedback/<feedback_id>/attachments
Content-Type: multipart/form-data
```

表单字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `file` | 是 | 每次请求一张图片 |
| `request_id` | 否 | 用于关联和排障 |

限制：

- 单张不超过 5MB。
- 允许 `image/png`、`image/jpeg`、`image/webp`。
- 客户端最多 10 张，按顺序逐张上传。
- 客户端会先把超过 5MB 的图片压缩为 WebP，再上传。
- 建议响应 `201 { "ok": true }`。
- 如果附件接口返回 404/5xx，文字反馈保持成功，客户端显示“截图上传失败”，
  不做文字重复提交。

## 5. 客户端离线队列

- 文件：`<userData>/feedback-queue.json`
- 只持久化文字和系统信息，不持久化截图。
- 同一个 `request_id` 重试时不变，后台据此去重。
- 重启应用后扫描队列，补发到期记录。
- 400/413 直接丢弃；429/5xx/网络错误保留。

队列记录包含：

```json
{
  "requestId": "uuid",
  "type": "other",
  "content": "反馈内容",
  "version": "0.6.1",
  "platform": "win32",
  "osVersion": "10.0.26100",
  "arch": "x64",
  "createdAt": 1761790000000,
  "attempts": 1,
  "nextAttemptAt": 1761790002000,
  "lastError": "http_503"
}
```

## 6. 隐私与安全

- 不采集 MAC、硬件序列号、用户名或完整 IP。
- 发送内容：反馈文字、截图（用户主动粘贴时）、版本号、系统平台、系统版本、架构。
- 服务端可把 IP 存成 `sha256(ip + salt)` 前 16 位用于反刷，不保存明文。
- 客户端没有后台 API Key，不能把密钥放进渲染层。

## 7. 联调验收

1. 本地契约回归：`pnpm e2e:feedback`。
2. 生产真实联调（会创建一条“生产联调、可删除”记录）：

```powershell
$env:PIXMINT_FEEDBACK_LIVE = '1'
pnpm e2e:feedback:live
```

3. 已验证：文本 201、同 `request_id` 幂等 200 同 ID、PNG/JPEG 各 201、
   不存在 ID 404、`text/plain` 400、6MB 413。
4. 429 已由后台完成 13 条连发实测，客户端不主动在生产触发限速。
5. 打开统计后台，确认反馈记录和附件可查看。

## 8. 可直接执行的联调命令

文本：

```bash
curl -X POST "https://data.hugproducthub.top/api/v1/feedback" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "pixmint",
    "type": "other",
    "content": "Pixmint 后台联调测试",
    "version": "0.6.1",
    "request_id": "7d0f2dad-3c55-4a48-8c26-44f26c2631e5",
    "platform": "win32",
    "os_version": "10.0.26100",
    "arch": "x64"
  }'
```

附件：

```bash
curl -X POST "https://data.hugproducthub.top/api/v1/feedback/<feedback_id>/attachments" \
  -F "request_id=7d0f2dad-3c55-4a48-8c26-44f26c2631e5" \
  -F "file=@screenshot.png;type=image/png"
```

## 9. Claude 侧需要确认/补齐

- 工具白名单加入 `pixmint`。
- 类型白名单加入 `other`。
- 字段白名单加入可选的 `platform`、`os_version`、`arch`，否则后台只能展示基础五项。
- 实现附件接口，字段名使用 `file`，单次一张，单张上限 5MB。
- 文本接口 2xx 响应返回非空 `id`，否则客户端无法上传附件。
- 附件接口保持幂等或可接受重复上传；客户端按反馈 ID 逐张上传。
- 当前客户端没有联系方式字段，也没有 `client_id`；如需扩展请另加字段和隐私说明。

