# Pixmint 官网（静态版）

这是 2026-10-26 保存的官网版本，与 `demos/official-site.html` 单文件预览一致。

## 预览

直接打开 `index.html`，或在仓库根目录运行：

```powershell
python -m http.server 8080 --directory official-site
```

然后访问 `http://localhost:8080`。

## 部署

无需构建，整个 `official-site/` 目录可以直接上传到任意静态托管：

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel

`.nojekyll` 已包含，GitHub Pages 不会对静态资源做 Jekyll 处理。

## 买域名后

1. 在托管平台添加自定义域名。
2. 按平台提示配置 DNS：通常根域名用 A/ALIAS，`www` 用 CNAME。
3. 开启 HTTPS。
4. 如果使用 GitHub Pages，可以在 `official-site/` 下新增 `CNAME` 文件，写入域名。
5. 不需要改 HTML 结构。

## 上线前要改的地方

- 下载按钮目前是演示提示（点击弹出“安装包在桌面”）。上线前把 `.js-download` 按钮改成真实安装包链接，例如 GitHub Release 或 CDN。
- 如果需要把安装包放在站内，建议单独放 CDN，不要把 100MB+ 的 exe 提交进 Git。
- 更新下载区文案里的版本号和大小（当前 v0.3.10 / 约 114MB）。
- 如有需要，补 `og:title`、`og:description`、`og:image` 和站点图标。

## 文件说明

- `index.html`：官网主体，纯 HTML/CSS/JS，无构建步骤
- `assets/icon.png`：Pixmint 应用图标
- `assets/ocr-clear.png`：语言明确时的 OCR 截图
- `assets/ocr-clear-open.png`：语言明确、方向菜单展开
- `assets/ocr-ambiguous-open.png`：语言不明确、默认“请选择”
- `demos/official-site.html`：同一版的单文件预览，图片已内嵌

## 已实现的交互

- 深色 / 浅色主题切换
- OCR 示例“语言明确 / 语言不明确”标签切换
- 导航滚动高亮
- 滚动淡入
- 下载按钮演示提示

## 已验证

- 桌面 1440px、移动端 390px
- 深色 / 浅色主题
- 浏览器无 JS 报错
