#!/usr/bin/env python3
"""
数据库每日备份
背景：下载数据可以从 nginx 日志重建，但用户反馈不能，必须留备份。
设计意图：用 sqlite3 的 backup API 做在线热备（不阻塞写入），先写临时文件、
         校验通过后再原子改名，避免留下半截文件。保留 7 天。
关键约束：备份文件带日期；校验失败不覆盖旧备份；清理只删自己的命名格式。
"""
import os
import re
import sqlite3
import sys
from datetime import datetime, timedelta

DB_PATH = os.environ.get("HUGDATA_DB", "/var/lib/hugdata/data.db")
BACKUP_DIR = os.environ.get("HUGDATA_BACKUP_DIR", "/var/backups/hugdata")
KEEP_DAYS = 7
NAME_RE = re.compile(r"^data-\d{8}-\d{4}\.db$")


def main():
    if not os.path.exists(DB_PATH):
        print(f"源数据库不存在：{DB_PATH}", file=sys.stderr)
        return 1
    os.makedirs(BACKUP_DIR, exist_ok=True)

    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    final = os.path.join(BACKUP_DIR, f"data-{stamp}.db")
    tmp = final + ".tmp"

    src = sqlite3.connect(DB_PATH)
    dst = sqlite3.connect(tmp)
    try:
        src.backup(dst)          # 在线热备，读操作不会阻塞写入
    finally:
        dst.close()
        src.close()

    check = sqlite3.connect(tmp)
    ok = check.execute("PRAGMA integrity_check").fetchone()[0]
    check.close()
    if ok != "ok":
        os.remove(tmp)
        print(f"备份校验失败：{ok}", file=sys.stderr)
        return 1

    os.replace(tmp, final)       # 原子替换，不会出现半截文件
    size = os.path.getsize(final)
    print(f"备份完成：{final}（{size} 字节）")

    cutoff = datetime.now() - timedelta(days=KEEP_DAYS)
    for name in os.listdir(BACKUP_DIR):
        if not NAME_RE.match(name):
            continue
        path = os.path.join(BACKUP_DIR, name)
        try:
            mtime = datetime.fromtimestamp(os.path.getmtime(path))
        except OSError:
            continue
        if mtime < cutoff:
            os.remove(path)
            print(f"已清理过期备份：{name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
