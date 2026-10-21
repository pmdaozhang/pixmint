# P0 截图地基 · 实施计划

> 状态：已执行完成（真实屏幕捕获受当前桌面权限阻塞）

## 1. 工程骨架

- [x] Electron + React + TypeScript + electron-vite
- [x] 主进程 / preload / renderer 三段构建
- [x] TypeScript 严格模式
- [x] Vitest 单元测试
- [x] Playwright Electron E2E
- [x] electron-builder 配置
- [x] pnpm 构建脚本白名单

## 2. 主进程

- [x] 单实例、托盘、全局快捷键
- [x] 设置存储（userData/settings.json）
- [x] 历史存储（PNG + 缩略图 + index.json）
- [x] 多显示器截图与覆盖窗
- [x] 覆盖层 IPC：ready / complete / cancel
- [x] 复制 / 保存 / 贴图动作
- [x] 贴图窗：置顶、缩放、透明度、穿透、右键菜单
- [x] 设置窗口、历史列表、打开保存目录
- [x] 冒烟测试模式：settings / capture / overlay

## 3. 渲染层

- [x] 覆盖层框选与尺寸提示
- [x] 毛玻璃工具条
- [x] 矩形 / 椭圆 / 线条箭头 / 马赛克 / 文字 / 序号
- [x] 手绘箭头稳定切线 + 平滑尾段
- [x] 六种线型与无文字线型下拉
- [x] 颜色板、线宽滚轮、撤销/重做
- [x] 标注移动、双击删除
- [x] 贴图窗 UI
- [x] 设置页与历史缩略图

## 4. 测试与验收

- [x] 选区几何单测
- [x] 高 DPI 裁剪单测
- [x] 手绘箭头单测
- [x] 标注命中 / 移动单测
- [x] 贴图缩放单测
- [x] 设置页冒烟
- [x] 覆盖层框选 + 标注 + 复制 E2E
- [x] 贴图创建 + 复制 + 关闭 E2E
- [ ] 普通桌面会话真实截屏复测
- [ ] macOS 实机权限与 vibrancy 复测

## 5. 命令

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
pnpm e2e:overlay
pnpm e2e:pin
```

## 6. 依赖关系

- 选区坐标 → 复制/保存 → 历史记录
- 标注模型 → 画布渲染 → 复制/保存/贴图
- 贴图窗状态 → 缩放/透明度/穿透/菜单
- 设置存储 → 快捷键注册 / 主题 / 开机自启 / 保存目录
