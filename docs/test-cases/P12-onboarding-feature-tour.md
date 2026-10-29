# P12 首次引导测试用例

| 编号 | 场景 | 输入 / 操作 | 期望 | 结果 |
|---|---|---|---|---|
| P12-01 | 新装首次启动 | 空 userData 启动 | 打开引导，停在第 1 页 | PASS（E2E） |
| P12-02 | 页数与文案 | 读取步骤条与 6 个标题 | 6 页，标题与需求一致 | PASS（E2E） |
| P12-03 | 光标跟随 | 第 2 页绘制中读取选区与光标矩形 | 光标尖端与选区右下角误差 < 1px | PASS（实测 0.003 / 0.002px） |
| P12-04 | 视频素材 | 第 3 页读取 video | 加载完成、未暂停、时长约 8.2s | PASS（readyState=4，duration=8.204） |
| P12-05 | OCR 居中 | 第 4 页读取 stage 与面板布局值 | 水平、垂直偏差 < 1px | PASS（dx=0，dy=0） |
| P12-06 | 完成写入 | 第 6 页点「开始使用」 | 设置写入 `onboardingCompleted=true`、`onboardingVersion=2` | PASS（E2E 读取 settings.json） |
| P12-07 | 旧设置迁移 | `{ onboardingCompleted: true }` 归一化 | `onboardingVersion=1` | PASS（单测） |
| P12-08 | 已完成不重复 | `onboardingVersion=2` 启动 | 不再弹引导 | PASS（版本比较逻辑） |
| P12-09 | 减少动效 | 系统开启 reduced motion | 只显示静态中间态，不循环 | 待人工抽查 |
| P12-10 | 跳过 | 任意页点「跳过」 | 直接关闭并写入完成标记 | 手工路径 |

## 回归

- 第 5、6 页沿用原有快捷键/划线演示，F1 与划线相关回归不受影响。
- 设置 schema 仅新增字段，旧字段与翻译配置保持不变。
