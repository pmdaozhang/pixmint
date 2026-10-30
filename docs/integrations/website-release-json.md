# 官网安装包自动更新约定

目标：官网不写死版本号和安装包 URL。每次发版只更新一个 `release.json`，
官网的版本号、文件大小、下载按钮自动变化。

## 1. 目录结构

```text
/var/www/pixmint/
  index.html
  release.json

/var/www/pixmint-downloads/
  Pixmint-Setup-0.6.2.exe
  Pixmint-Setup-0.6.2.exe.sha256
  latest.yml
  Pixmint-Setup-0.6.2.exe.blockmap
```

- `release.json` 放在官网根目录，公开访问：`https://pixmint.hugproducthub.top/release.json`
- 安装包放在 `/var/www/pixmint-downloads/`，通过 `/downloads/` 访问。
- 文件名必须带版本号，不覆盖旧文件，方便回滚。
- `latest.yml` 和 `.blockmap` 给应用内自动更新使用，官网下载按钮不直接引用。

## 2. release.json

```json
{
  "schemaVersion": 1,
  "product": "Pixmint",
  "channel": "stable",
  "version": "0.6.2",
  "publishedAt": "2026-10-30T14:20:00+08:00",
  "downloads": {
    "windows-x64": {
      "url": "https://pixmint.hugproducthub.top/downloads/Pixmint-Setup-0.6.2.exe",
      "fileName": "Pixmint-Setup-0.6.2.exe",
      "size": 120423342,
      "sha256": "填入安装包 SHA256",
      "minOs": "Windows 10",
      "arch": "x64"
    }
  }
}
```

字段约定：

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | 是 | 当前固定 `1` |
| `product` | 是 | 固定 `Pixmint` |
| `channel` | 是 | 当前固定 `stable` |
| `version` | 是 | 不带 `v`，与 `package.json` 一致 |
| `publishedAt` | 是 | ISO 8601，带时区 |
| `downloads.windows-x64.url` | 是 | 完整 HTTPS 下载地址 |
| `downloads.windows-x64.fileName` | 是 | 文件名 |
| `downloads.windows-x64.size` | 是 | 字节数 |
| `downloads.windows-x64.sha256` | 是 | 安装包 SHA256 小写十六进制 |
| `downloads.windows-x64.minOs` | 是 | 当前 `Windows 10` |
| `downloads.windows-x64.arch` | 是 | 当前 `x64` |

## 3. 官网接入方式

按钮和文案增加标识：

```html
<a class="js-download" href="/downloads/Pixmint-Setup-0.6.1.exe">
  下载 Windows 版
</a>
<p>
  Windows 10/11 · <span class="js-version">v0.6.1</span> ·
  约 <span class="js-size">115</span>MB
</p>
```

页面加载后读取 `release.json`：

```html
<script>
  fetch('/release.json', { cache: 'no-store' })
    .then((response) => response.json())
    .then((release) => {
      const win = release.downloads['windows-x64']
      document.querySelectorAll('.js-download').forEach((button) => {
        button.href = win.url
      })
      document.querySelectorAll('.js-version').forEach((node) => {
        node.textContent = `v${release.version}`
      })
      document.querySelectorAll('.js-size').forEach((node) => {
        node.textContent = Math.round(win.size / 1024 / 1024)
      })
    })
    .catch(() => {
      // 保留 HTML 中上一版静态链接，release.json 临时失败不影响下载
    })
</script>
```

## 4. 发布步骤

1. 本地构建 `Pixmint-Setup-<version>.exe`。
2. 计算 SHA256 和字节数。
3. 上传安装包、`.sha256`、`latest.yml`、`.blockmap` 到 `/var/www/pixmint-downloads/`。
4. 先上传安装包，最后原子替换 `/var/www/pixmint/release.json`。
5. 用无缓存请求验证：
   - `GET /release.json`
   - `HEAD /downloads/Pixmint-Setup-<version>.exe`
   - 下载后 SHA256 与 `release.json` 一致
6. 保留上一版 `release.json` 副本，失败时恢复。

## 5. 应用内自动更新

当前 `electron-builder.yml` 使用 GitHub provider。如果后续不再使用 Git 仓库/CI，
建议改为 generic provider：

```yaml
publish:
  provider: generic
  url: https://pixmint.hugproducthub.top/downloads/
```

然后 `latest.yml`、安装包、`.blockmap` 必须放在 `/var/www/pixmint-downloads/`。
这是一个独立的打包配置变更，需要单独确认后再改。

