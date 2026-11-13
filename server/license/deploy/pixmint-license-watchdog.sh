#!/bin/bash
set -uo pipefail
ENVFILE=/etc/pixmint-license/env
TOKEN=$(grep '^PIXMINT_ORDERS_TOKEN=' "$ENVFILE" | cut -d= -f2-)
if [ -z "$TOKEN" ]; then
  echo "orders token missing" >&2
  exit 1
fi
curl -fsS -m 90 -X POST http://127.0.0.1:8101/v1/admin/manual/watchdog \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
