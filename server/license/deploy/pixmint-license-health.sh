#!/bin/bash
set -uo pipefail
ENVFILE=/etc/pixmint-license/env
STATE=/var/lib/pixmint-license/.last-health-alert
fail=""

systemctl is-active --quiet pixmint-license || fail="license service inactive"
if [ -z "$fail" ]; then
  curl -fsS -m 5 http://127.0.0.1:8101/healthz >/dev/null || fail="healthz 请求失败"
fi
if [ -z "$fail" ]; then
  check=$(sqlite3 /var/lib/pixmint-license/license.db 'PRAGMA quick_check;' 2>&1 | head -1)
  [ "$check" = "ok" ] || fail="数据库检查失败: $check"
fi
if [ -z "$fail" ]; then
  exit 0
fi

now=$(date +%s)
last=0
[ -f "$STATE" ] && last=$(cat "$STATE" 2>/dev/null || echo 0)
[ $((now - last)) -lt 1800 ] && exit 0
mkdir -p "$(dirname "$STATE")"
echo "$now" > "$STATE"

MSG="Pixmint 授权服务异常：$fail（$(date '+%F %T')）"
CORP=$(grep '^PIXMINT_WECOM_CORP_ID=' "$ENVFILE" | cut -d= -f2-)
SECRET=$(grep '^PIXMINT_WECOM_SECRET=' "$ENVFILE" | cut -d= -f2-)
AGENT=$(grep '^PIXMINT_WECOM_AGENT_ID=' "$ENVFILE" | cut -d= -f2-)
if [ -n "$CORP" ] && [ -n "$SECRET" ] && [ -n "$AGENT" ]; then
  TOKEN=$(curl -s -m 10 "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=$CORP&corpsecret=$SECRET" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')
  if [ -n "$TOKEN" ]; then
    python3 - "$TOKEN" "$AGENT" "$MSG" <<'PY' | curl -s -m 10 -X POST "https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=$TOKEN" -H 'Content-Type: application/json' -d @- >/dev/null
import json, sys
print(json.dumps({"touser": "@all", "msgtype": "text", "agentid": int(sys.argv[2]), "text": {"content": sys.argv[3]}}, ensure_ascii=False))
PY
  fi
fi

PT=$(grep '^PIXMINT_PUSHPLUS_TOKEN=' "$ENVFILE" | cut -d= -f2-)
if [ -n "$PT" ]; then
  python3 - "$PT" "$MSG" <<'PY' | curl -s -m 10 -X POST https://www.pushplus.plus/send -H 'Content-Type: application/json' -d @- >/dev/null
import json, sys
print(json.dumps({"token": sys.argv[1], "title": "Pixmint 授权服务异常", "content": sys.argv[2]}, ensure_ascii=False))
PY
fi
