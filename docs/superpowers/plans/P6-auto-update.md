# P6 应用内更新 · 实施计划

> 上游：`docs/features/P6-auto-update.md`  
> 目标版本：0.4.0

## 0. 前置

- [x] 确认更新源为 GitHub Releases，仓库公开
- [x] 确认本次不做代码签名
- [x] 确认只加设置页入口，不加托盘入口
- [x] 确认允许本机真实安装 0.4.0 → 0.4.1 做完整验证

## 1. 依赖与打包配置

- [x] `package.json` 增加 `electron-updater` 6.x
- [x] `package.json` 版本改为 0.4.0
- [x] 增加 `release:win` 脚本：typecheck + test + build + electron-builder
- [x] `electron-builder.yml` 显式写 `publish` GitHub 配置
- [x] `artifactName` 统一为 `Pixmint-Setup-${version}.${ext}`
- [x] 确认 NSIS 每用户安装，覆盖安装不需要管理员权限

## 2. 共享类型与状态机

- [x] `src/shared/types.ts` 增加 `UpdatePhase`、`UpdateState`、`UpdateProgress`
- [x] `src/shared/update.ts` 实现状态映射、错误映射、字节格式化
- [x] `src/shared/api.ts` 增加 `updater` 接口
- [x] `tests/update.test.ts` 覆盖全部状态和错误文案

## 3. 主进程

- [x] 新增 `src/main/updater.ts`
- [x] 只在 `app.isPackaged` 且 Windows 时初始化
- [x] 启动 15 秒后静默检查
- [x] 监听 `update-available`、`update-not-available`、`download-progress`、`update-downloaded`、`error`
- [x] 支持 `PIXMINT_UPDATE_URL` 覆盖 feed，仅测试使用
- [x] IPC：检查、下载、安装、获取状态、订阅状态
- [x] 更新事件写入 diagnostics
- [x] `src/main/index.ts` 初始化和退出清理

## 4. Preload 与渲染层

- [x] `src/preload/index.ts` 暴露 `updater` API
- [x] `src/renderer/src/settings/SettingsApp.tsx` 增加“关于与更新”卡片
- [x] 卡片状态：idle、checking、up-to-date、available、downloading、verifying、downloaded、installing、error
- [x] `settings.css` 增加进度条、状态点、错误色、主按钮
- [x] `dev-mock.ts` 补 updater mock
- [x] 卡片位置在“外观与启动”之后、“诊断”之前

## 5. 验证

- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm smoke`
- [x] `pnpm e2e:settings`
- [x] 本地 generic 源：同版本检查
- [x] 本地 generic 源：0.4.0 → 0.4.1 完整更新
- [x] 网络失败、404、哈希失败三条异常路径
- [ ] 下载中断与真实安装失败注入未单独实测
- [x] 更新后截图主路径（e2e-overlay）回归
- [ ] OCR / 录制真实路径未重跑

## 6. 文档与门禁

- [x] 更新 `docs/CHANGELOG.md`
- [x] 更新 `docs/ROADMAP.md`
- [x] 更新 `docs/RELEASE_CHECKLIST.md`
- [x] 更新 `docs/regression-map.md`
- [ ] 生成 `docs/reviews/iteration-YYYYMMDD-HHmm-v0.4.0.md/.json`
- [ ] 运行 `node ../scripts/review/release-gate.mjs --project .`

## 7. 发布

- [ ] 创建 GitHub Release `v0.4.0`
- [ ] 上传 `Pixmint-Setup-0.4.0.exe`、`latest.yml`、`.blockmap`
- [ ] 验证 Release 资产名与 `latest.yml` 一致
- [ ] 用 0.3.10 安装包覆盖安装 0.4.0
- [ ] 用 0.4.0 检查线上更新源

## 风险

- 0.3.10 老用户必须手动安装一次 0.4.0。
- 未签名安装包会触发 SmartScreen。
- GitHub 国内下载速度不可控。
- 发布端 `git push` 受 schannel 影响，改用 GitHub API + Token。
- 差分更新依赖本地旧安装包缓存，缓存缺失时退化为全量下载。
