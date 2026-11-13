# 授权服务部署文件

| 文件 | 用途 |
|---|---|
| `pixmint-license.service` | 主服务（gunicorn，127.0.0.1:8101） |
| `pixmint-license.service.d/onfailure.conf` | 服务失败时触发健康检查告警 |
| `pixmint-license-watchdog.service/.timer` | 未确认订单看门狗，每 10 分钟 |
| `pixmint-license-watchdog.sh` | 看门狗脚本，调用 `/v1/admin/manual/watchdog` |
| `pixmint-license-health.service/.timer` | 健康检查，每 5 分钟 |
| `pixmint-license-health.sh` | 检查服务、`/healthz`、数据库，异常时发企业微信/PushPlus |
| `pixmint-license-backup.service/.timer/.sh` | 每日 03:17 备份数据库与 Ed25519 私钥 |

脚本安装到 `/usr/local/bin`，单元安装到 `/etc/systemd/system`（drop-in 放到 `pixmint-license.service.d/`），然后 `systemctl daemon-reload` 并启用 timer。

环境变量在 `/etc/pixmint-license/env`，包含企业微信、PushPlus、签名密钥等，不入库。
