# Hug Data 服务

本目录是数据台的线上版本，修改流程：先改这里并提交，再用 scp 部署到服务器，服务器上保留 `.bak-日期` 备份。

## 运行时位置

- `/opt/hugdata/app.py`、`aggregate.py`、`backup.py`（gunicorn，127.0.0.1:8100）
- `/var/www/data/index.html`（数据台静态页）
- `/etc/nginx/conf.d/hugdata.conf`
- `/etc/logrotate.d/nginx`

## 环境变量

在 `/etc/hugdata.env`，包含管理员哈希、会话密钥等，不入库。

## 下载统计

`aggregate.py` 由 `hugdata-aggregate.timer` 每 10 分钟运行，读取 `/var/log/nginx/pixmint.access.log*`。日志目录必须有 `user:hugdata` 的默认 ACL，聚合器读失败时会返回非 0。
