# Pixmint 0.7.0 架构体检报告

> 体检对象：`D:\AI project\audio_type\_snapglass_app`，分支 `codex/pixmint-pin-text`（含 9 项未提交改动）
> 体检日期：2026-11-04
> 方法：静态代码审查（约 116 个源文件 / 690KB）+ 文档比对 + CI 配置核对
> 说明：本机当前 shell 的 PATH 中没有可用 Node（只找到 Photoshop 自带的 node.exe），因此**未能复跑 typecheck 与单测**；下文关于测试的结论来自测试文件本身与 CI 配置，不是运行结果。

---

## 一、总体判断

**一句话：这是一套"工艺不错、但骨架还没有为平台化留出接口"的单体应用。**

它能稳稳支撑现在这 8 个功能；加上插件系统和你列的 17 项扩展、再叠加付费门禁，会在三个地方先崩：**主进程、IPC 契约、构建环境**。

### 评分

| 维度    | 评分     | 判断                                    |
| ----- | ------ | ------------------------------------- |
| 架构分层  | 6 / 10 | 文档写得比代码好；`services/`、`ipc/` 目录根本不存在   |
| 可扩展性  | 4 / 10 | 无插件抽象、preload 是扁平大对象、IPC 频道散落         |
| 稳定性   | 7 / 10 | 崩溃采集、安全模式、压测体系是真的；但内存增长未封顶            |
| 健壮性   | 8 / 10 | 设置损坏备份、原子写入、超时、schema 归一化做得扎实         |
| 安全性   | 7 / 10 | 沙箱、CSP、导航拦截、safeStorage 都有；IPC 无运行时校验 |
| 测试    | 7 / 10 | 25 个单测 + 19 个 E2E 脚本 + 压测；缺主进程集成测试    |
| 工程化   | 6 / 10 | 无 lint、无代码签名、无 macOS CI、本地构建环境不可复现    |
| 商业化就绪 | 2 / 10 | 没有许可、没有埋点、没有账号、没有付费门禁                 |
| 跨平台就绪 | 3 / 10 | 接口留了，实现为零；macOS 上截图/OCR 直接抛错          |

---

## 二、做得好的地方（先别推翻）

这些是很多商业软件都做不到的，改造时要保留：

1. **设置容错扎实**：`settings-utils.ts:38` 的 `normalizeSettings` 做白名单归一化，非法值回退默认；`settings-utils.ts:80` 的 `writeJsonAtomic` 先写临时文件再 rename，失败还留 `.bak`。
2. **密钥用系统安全存储**：`secret-store.ts:46` 用 `safeStorage.encryptString`，不是明文存 JSON。
3. **渲染层安全边界清晰**：`security.ts:26` 统一安装导航拦截、拒绝 `window.open`、拒绝 webview；窗口全部开启 `sandbox: true`。
4. **崩溃与诊断成体系**：崩溃采集、面包屑、分级日志轮转、脱敏、诊断报告导出、安全模式（`index.ts:93-112`）。
5. **压测与门禁意识**：覆盖层 300 次、OCR 100 次、录制 3×10 分钟的预算都写进了 `AGENTS.md` 和 CI。
6. **协议白名单**：自定义 `snapglass-media` 协议带路径白名单校验（`index.ts:522`），不是裸 `file://`。

> 结论：地基的**质量**是够的，缺的是**结构**。

---

## 三、必须先修的 5 个 P0 问题

### P0-1 · `main/index.ts` 是 960 行上帝模块 —— ✅ 已修复（2026-11-04，960 → 362 行）

**现象**：`src/main/index.ts` 一个文件同时承担：应用启动、单实例锁、20 多个 `process.argv` 测试开关、全部 IPC 注册（`registerIpc()`，293–482 行）、截图业务编排（`handleOverlayComplete`，230–291 行）、6 个 smoke 运行器。

**同时**：`docs/ARCHITECTURE.md:10-18` 明确写了应该有 `src/main/services/`、`src/main/ipc/`、`src/main/windows/` 三层，但实际只有 `windows/`，前两个目录不存在。

**风险**：现在加一个插件要往这里塞 3–5 个 IPC handler + 一段初始化逻辑。17 个插件就是 2000+ 行塞进同一个文件，改 A 必看 B，是这个项目未来最大的维护成本来源。

**建议**：

```
src/main/bootstrap.ts       只做 app 生命周期与单实例
src/main/ipc/index.ts       注册器：按域调用 registerXxxIpc()
src/main/ipc/overlay.ts     …按域拆分，每个 <150 行
src/main/services/capture-service.ts   把 handleOverlayComplete 搬出来
src/main/runtime/flags.ts   收敛 20 多个 argv 开关
```

先做"拆分不改变行为"的纯搬运，有 E2E 兜底，风险可控。

---

### P0-2 · IPC 没有运行时校验，且违背自己定的规则 —— ✅ 已修复（2026-11-04，zod + 来源校验）

**现象**：`docs/ARCHITECTURE.md:26` 写的是"IPC 参数必须经过运行时校验"，但 `package.json` 里**没有 zod**，也没有任何 schema 库。实际写法：

```ts
// index.ts:402
ipcMain.handle('settings:update', (_event, patch: Partial<Settings>) => {
  const { hasTranslationKey: _ignored, ...rest } = patch   // 直接信任渲染层
  const next = settingsStore.update(rest)
  ...
})
```

`Partial<Settings>` 只是编译期类型，运行时不校验。`overlay:complete` 传进来的 `payload.pngBytes`、`record:video-chunk` 的 `ArrayBuffer` 同样无校验。

**风险**：现在渲染层全是自家代码，风险可控；一旦有插件/第三方内容进入渲染层，这里就是提权入口（写任意设置、触发任意窗口操作）。**插件化之前必须补。**

**建议**：引入 zod（或 valibot，体积更小），每个 channel 一份 schema，在注册器里统一包一层 `handle(channel, schema, fn)`；顺带把 sender 校验也统一做掉（见 P1-6）。

---

### P0-3 · OCR 推理跑在主进程里 —— ✅ 已修复（2026-11-04，utilityProcess + 进程内回退）

**现象**：`src/main/ocr/paddle.ts:5-6` 直接 `import * as ort from 'onnxruntime-node'` 和 `PaddleOcrService`，在 `index.ts:459` 的 IPC handler 里 `await`。主进程没有 `utilityProcess`、没有 `worker_threads`（全仓 grep 无结果）。

**风险**：

- ONNX 推理的 CPU/内存与主进程共享同一进程配额。单张 OCR 现在 p95 约 950ms（ROADMAP P4），批量 OCR / 表格 / 公式会让主进程长时间占满，**托盘菜单、快捷键、窗口管理全部变慢**。
- 更严重的是**崩溃半径**：ONNX Runtime 原生层崩了，整个应用一起没。

**建议**：把 OCR、录制编码、格式转换这类重活全部移到 `utilityProcess`（Electron 原生支持，Node 子进程），主进程只做调度。这也正好是插件化的运行载体——第三方插件天然就跑在子进程里。

---

### P0-4 · 覆盖层内存线性增长，尚未封顶 —— ✅ 已修复（2026-11-04，策略 + 强制触发验证）

**现象**：`docs/ROADMAP.md:107-111` 自己记着"1000 次覆盖层长跑确认原生内存线性增长、尚未封顶"，后来通过与"真实路径内存治理"把 300 次压到 private +19.3MB。

**风险**：这是个托盘常驻、一天按几十上百次 F1 的工具。300 次 +19.3MB 意味着重度用户连续用一天，内存会持续爬。现在功能少还能忍，**加了 17 个插件后，每个插件都可能持有自己的 Chromium 内存**，这个问题会从"可接受"变成"用户投诉"。

**建议**：

- 明确一个硬指标：8 小时 / 500 次截图，private 增长 ≤ 100MB，超出则重启 overlay 渲染进程。
- 把"进程重建兜底"从文档里的原则（`AGENTS.md:62`）真正实现出来：overlay renderer 达到阈值就销毁重建。
- 插件宿主也要有同样的回收策略。

---

## 四、P1 级问题（影响扩展，不阻塞发版）

### P1-6 · IPC 的 sender 校验只做了一半

部分 handler 用 `event.sender.id` 反查会话（`index.ts:296`、`323`、`328`），但 `recorder:state`、`recorder:video-chunk`、`settings:update`、`translation:translate` 等直接信任调用方。插件化后需要一条统一规则：**每个 channel 声明允许的窗口类型**，注册器统一校验。

### P1-7 · preload 是单一扁平 API

`src/preload/index.ts:23-167` 把所有能力挂在一个 `window.snapglass` 上，169 行平铺。再加 17 个插件会变成 500 行，且插件拿不到"只属于自己"的 API 视图。

**建议**：改成 `window.pixmint.core.*` + `window.pixmint.plugin(id).*`，插件只能看到自己命名空间 + 声明的 capability。

### P1-8 · 设置没有迁移管线

`settings-utils.ts:12` 有 `SETTINGS_SCHEMA_VERSION = 1`，但 `normalizeSettings` 永远写回当前版本，没有 `v1→v2` 的迁移函数。现在字段少没事；一旦加了 `plugins.*`、`license.*`、`vocab.*`，用户从 0.7 升到 0.9 会**静默丢配置**。

**建议**：`migrations/` 数组，按版本顺序执行，每次迁移配一个单测。

### P1-9 · 完全没有埋点

全仓 grep 无 analytics / sentry / posthog / umami。你无法知道：多少用户开了哪个插件、OCR 每天调几次、录屏平均多长、在哪一步放弃付费。

**收费的第一步不是写许可，是能看见漏斗。** 建议最小事件集（本地缓冲 + 匿名上报，可关闭）：`app_launch`、`plugin_toggled`、`capture_done`、`ocr_done`、`record_done`、`paywall_shown`、`trial_started`、`purchase`。

### P1-10 · 生产包混入测试代码

`index.ts:45` 把 `FAKE_SCREEN_PNG`（测试假屏幕）import 进主进程，smoke 运行器也编译进正式包。功能无害，但会增大包体、扩大攻击面，也让"生产代码"的可信边界变模糊。建议用构建期常量 + 独立入口拆分。

### P1-11 · 工程化缺口

- 没有 ESLint / Prettier（`tsconfig` 只有 `strict: true`）。
- CI 只有 `windows-latest` 一个 job（`.github/workflows/ci.yml`），macOS 零验证，而 `ARCHITECTURE.md` 把 macOS 当作一等目标。
- 本地构建环境不可复现：本次体检的 shell 与 WSL 里都没有可用的 `node`。

### P1-12 · 其他接近临界点的文件

`src/main/recording.ts` 23KB、`src/main/windows/overlay.ts` 19KB、`OverlayApp.tsx` 28KB、`AnnotationCanvas.tsx` 25KB。单文件超过 800 行后，插件化改造的回归风险会明显上升，建议在动手加功能前先做一轮拆分。

---

## 五、macOS 就绪度（因后续要做 Mac 版，单列）

**结论：架构上留了口子，代码上一步没走。** Mac 上现在能编译、能启动，但按 F1 截图会直接抛错。

| 项目            | 现状                                                         | 位置                                 |
| ------------- | ---------------------------------------------------------- | ---------------------------------- |
| 平台 Provider   | 只有 `win32`；非 Windows 返回 "unavailable" 占位，截图/OCR 调用直接 throw | `src/main/platform/index.ts:16-41` |
| Swift sidecar | `ARCHITECTURE.md:17` 声明的 `native/macos/` 目录**不存在**         | —                                  |
| 屏幕捕获          | GDI 快速截屏是 Windows 实现；macOS 需要 ScreenCaptureKit             | `src/main/platform/win32/`         |
| OCR           | 打包配置**主动排除了 onnxruntime 的 darwin 二进制**，Mac 上 Paddle 跑不起来   | `electron-builder.yml:15`          |
| 自动更新          | 非 Windows 平台直接禁用                                           | `src/main/updater.ts:158`          |
| 打包产物          | mac 只有 `dmg` target；electron-updater 在 macOS 需要 `zip`      | `electron-builder.yml:51`          |
| 签名/公证         | 无任何配置                                                      | —                                  |

### 因此，Mac 版不是"改个平台判断"，而是三件套重写

| 阶段    | 内容                                            | 预估      |
| ----- | --------------------------------------------- | ------- |
| 能启动   | 现在就能（占位 provider）                             | 0       |
| 能日常截图 | ScreenCaptureKit sidecar + 权限引导 + windowQuery | 3–4 周   |
| 能卖    | 再加录屏/系统音频、签名公证、自动更新、双架构构建                     | 共 6–8 周 |

### 平台专属功能在 macOS 上的可行性

| 功能      | macOS | 说明                                              |
| ------- | ----- | ----------------------------------------------- |
| 鼠标光标自定义 | ❌     | 系统没有 `SetSystemCursor` 等价能力，只能做应用内光标            |
| 本地文件搜索  | ✅     | 比 Windows 更简单，`mdfind` 直接用 Spotlight 索引         |
| 定时关机/开机 | ✅     | `pmset repeat` 比 Windows 的 BIOS RTC 可靠，但需要 sudo |
| 磁盘清理    | ⚠️    | 可行，路径与权限模型不同                                    |
| 剪贴板历史   | ✅     | Electron 轮询跨平台可用                                |
| 专业录屏    | ⚠️    | 需要 ScreenCaptureKit sidecar + 系统音频权限（macOS 13+） |

### 现在就该做的 5 件事（3–5 天，能省后面 1–2 个月）

1. **补齐 `PlatformServices` 契约**：在现有 capture / windowQuery / ocr 之外，预留 `audio`、`permissions`、`shell`。插件只准调契约，不准出现 `process.platform`。
2. **插件 manifest 的 `platforms` 字段变成强制项**，注册表按平台过滤，避免 Windows 专属插件在 Mac 上被加载。
3. **公开 API 去掉 Windows 概念**：`captureFast`（GDI 快速截屏）不进插件 API，统一暴露 `capture()`。
4. **设备指纹从第一天就跨平台**：Windows `MachineGuid` / macOS `IOPlatformUUID`，否则未来授权码无法跨平台通用。
5. **补构建配置**：mac target 改成 `[dmg, zip]`，并在 `electron-builder.yml` 里为 darwin 排除规则加注释说明原因（避免上线时才发现 OCR 缺失）。

---

## 六、能不能支撑你的路线？

分三档说清楚：

| 目标                      | 结论              | 前置条件                                  |
| ----------------------- | --------------- | ------------------------------------- |
| **8 个内置插件 + 基础付费**      | ✅ 能，3–4 周改造后可开工 | P0-1、P0-2、P1-7、P1-8                   |
| **17 个插件 + 云服务 + 订阅**   | ⚠️ 勉强能，但必须先做底座  | 再加 P0-3、P0-4、P1-9、P1-11               |
| **Windows + macOS 双平台** | ⚠️ 能，但需额外 6–8 周 | 平台契约补齐 + Swift sidecar + 签名公证 + 双架构构建 |
| **第三方插件生态 / 插件市场**      | ❌ 远未就绪          | 需要完整的插件沙箱、签名、审核、版本兼容体系                |

**关键判断：不要在 P0-1 / P0-2 / P0-3 完成前开始堆插件。** 现在每加一个功能都是"往里塞"，塞到第 6 个插件时，改一个公共逻辑就要全量回归 19 个 E2E，这是单人开发最容易崩盘的地方。

---

## 七、改造顺序（建议）

| 顺序  | 事项                                  | 预估           | 风险           |
| --- | ----------------------------------- | ------------ | ------------ |
| 1   | `index.ts` 拆分 + `services/ipc` 目录落地 | 3–5 天        | 低（纯搬运，有 E2E） |
| 2   | 引入 zod，统一 IPC 注册器 + sender 校验       | 3–4 天        | 低            |
| 3   | 插件注册表骨架（先只支持内置插件）                   | 5–7 天        | 中            |
| 4   | preload 命名空间化 + 插件 API              | 3 天          | 中            |
| 5   | 设置迁移管线                              | 2 天          | 低            |
| 6   | OCR 迁到 `utilityProcess`             | 4–6 天        | 中高（要重跑压测）    |
| 7   | 埋点最小集                               | 2 天          | 低            |
| 8   | 代码签名 + 构建环境固化                       | 2 天 + 证书办理周期 | 低            |
| 9   | 平台契约补齐 + mac 构建配置（见第五节）             | 3–5 天        | 低            |

合计约 **5 周**（不含证书办理）。这 4–5 周不产生任何用户可见的新功能，但决定了后面 17 个功能是"加法"还是"灾难"。
