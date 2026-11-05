#!/bin/bash
set -euo pipefail
DEST=/var/backups/pixmint-license
mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
python3 - "$TMP/license.db" <<'PY'
import sqlite3
import sys

src = sqlite3.connect("/var/lib/pixmint-license/license.db")
dst = sqlite3.connect(sys.argv[1])
src.backup(dst)
dst.close()
src.close()
PY
tar -czf "$DEST/pixmint-license-$STAMP.tar.gz" -C "$TMP" license.db -C /etc/pixmint-license ed25519.key
chmod 600 "$DEST/pixmint-license-$STAMP.tar.gz"
find "$DEST" -type f -mtime +30 -delete
