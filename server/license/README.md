# Pixmint 授权与订单服务

独立 Flask + SQLite 服务，部署在 `data.hugproducthub.top/api/v1/*`，与反馈后台进程隔离。

## 已上线状态（2026-11-05）

- 服务：`pixmint-license.service`，监听 `127.0.0.1:8101`
- 数据库：`/var/lib/pixmint-license/license.db`
- 私钥：`/etc/pixmint-license/ed25519.key`（`640 root:pixmint`，只备份，不重新生成）
- 配置：`/etc/pixmint-license/env`（`600 root:root`）
- 备份：`pixmint-license-backup.timer`，每天 03:17，保留 30 天
- 当前 `purchaseEnabled=false`：面包多Pay 密钥未配置；客户端购买按钮会提示“支付暂未开放”
- 邮件未配置：`/v1/license/email` 返回 503，客户端提示复制页面上的激活码

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/plans` | 套餐与购买开关 |
| POST | `/v1/pay/orders` | 创建订单，返回二维码/支付页 |
| GET | `/v1/pay/orders/<id>?token=` | 轮询订单，支付后返回激活码与设备 token |
| POST | `/v1/pay/webhook/mbd` | 面包多Pay 回调（必须反查订单验真） |
| GET | `/pay/<id>?k=` | 手机支付页 |
| POST | `/v1/license/activate` | 激活码绑定设备 |
| POST | `/v1/license/refresh` | 7 天续签；退款后返回 410 |
| POST | `/v1/license/by-device` | 支付后关掉应用，下次启动按设备恢复 |
| POST | `/v1/license/devices` / `/v1/license/unbind` | 设备列表 / 自助解绑 |
| POST | `/v1/license/trial` | 邀请码领 7 天试用，邀请人 +90 天 |
| POST | `/v1/license/email` | 发送激活码邮件 |
| POST | `/v1/admin/issue` | 手动签发授权（Bearer token） |
| POST | `/v1/admin/refund` | 退款并撤销授权 |

管理接口需要 `Authorization: Bearer $PIXMINT_ADMIN_TOKEN`。

## 部署

```bash
# 服务器
useradd --system --home /opt/pixmint-license --shell /usr/sbin/nologin pixmint
mkdir -p /opt/pixmint-license /var/lib/pixmint-license /etc/pixmint-license
python3 -m venv /opt/pixmint-license/venv
/opt/pixmint-license/venv/bin/pip install -r requirements.txt

cp app.py requirements.txt /opt/pixmint-license/
cp ed25519.key /etc/pixmint-license/
cp env.example /etc/pixmint-license/env   # 填 token / 支付 / SMTP
chown root:pixmint /etc/pixmint-license/ed25519.key
chmod 640 /etc/pixmint-license/ed25519.key
chmod 600 /etc/pixmint-license/env

cp deploy/pixmint-license.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now pixmint-license
cp deploy/nginx-location.conf /tmp/ && 按 README 插入 hugdata.conf
nginx -t && systemctl reload nginx
```

## 生成生产密钥

密钥对已生成并部署，客户端 `src/main/license/public-key.ts` 内置对应公钥。
**除非做密钥轮换，不要重新生成**；轮换时新增 `kid` 并在客户端同时保留旧公钥。

```bash
openssl genpkey -algorithm ed25519 -out ed25519.key
openssl pkey -in ed25519.key -pubout
```

## 测试

```bash
cd server/license
python -m unittest discover -s tests -v
```

客户端与服务端联调（本地 mock 支付）：

```bash
node e2e-license-live.cjs
```

## 面包多Pay 接入待办

审核通过后，在 `/etc/pixmint-license/env` 填入：

```
MBD_APP_ID=...
MBD_APP_KEY=...
```

并把服务器出口 IP 加入面包多控制台白名单。Webhook URL 填：

```
https://data.hugproducthub.top/api/v1/pay/webhook/mbd
```

微信 H5 需要在面包多控制台添加 H5 域名并通过审核。
