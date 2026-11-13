#!/usr/bin/env python3
"""
下载日志聚合器
背景：数据后台要展示每个工具每天被下载了多少次，来源是 nginx 访问日志。
设计意图：按 **inode** 而不是路径记录读取位置。logrotate 轮转时文件改名但 inode 不变，
         这样「改名前读过的内容」不会在改名后被当成新文件重新读一遍（否则会重复计数）。
         文件被截断（copytruncate）时 size < offset，也会重置到 0。
关键约束：只统计 /downloads/ 下状态码 200/206 的 GET 请求；只处理完整行，半行留到下次。
"""
import glob
import os
import re
import sqlite3
import sys
from datetime import datetime

DB_PATH = os.environ.get("HUGDATA_DB", "/var/lib/hugdata/data.db")
LOG_GLOB = "/var/log/nginx/pixmint.access.log*"

LINE_RE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<ts>[^\]]+)\] "(?P<method>[A-Z]+) (?P<path>\S+)[^"]*" (?P<status>\d{3})'
)
DL_RE = re.compile(r"^/downloads/(?P<file>[^/?#]+)")


def db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def slug_from_file(filename):
    """Pixmint-Setup-0.6.1.exe -> pixmint；找不到前缀时退回整体小写。"""
    base = filename.split("-Setup")[0]
    return re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-") or "unknown"


def get_offset(conn, inode):
    row = conn.execute("SELECT offset FROM log_state WHERE inode=?", (inode,)).fetchone()
    return row["offset"] if row else 0


def set_state(conn, inode, path, offset):
    conn.execute(
        "INSERT INTO log_state(inode, path, offset) VALUES (?,?,?) "
        "ON CONFLICT(inode) DO UPDATE SET path=excluded.path, offset=excluded.offset",
        (inode, path, offset),
    )


def parse_line(line):
    """返回 (day, filename) 或 None。只认 /downloads/ 的成功响应。"""
    m = LINE_RE.match(line)
    if not m or m.group("method") != "GET":
        return None
    if m.group("status") not in ("200", "206"):
        return None
    dl = DL_RE.match(m.group("path"))
    if not dl:
        return None
    try:
        dt = datetime.strptime(m.group("ts"), "%d/%b/%Y:%H:%M:%S %z")
    except ValueError:
        return None
    return dt.date().isoformat(), dl.group("file")


def ingest_file(conn, path):
    try:
        st = os.stat(path)
    except FileNotFoundError:
        return 0

    offset = get_offset(conn, st.st_ino)
    if offset > st.st_size:
        offset = 0  # 文件被截断

    with open(path, "rb") as f:
        f.seek(offset)
        data = f.read()

    if not data:
        set_state(conn, st.st_ino, path, offset)
        return 0

    cut = data.rfind(b"\n")
    if cut == -1:
        return 0
    complete = data[: cut + 1]
    new_offset = offset + len(complete)

    counts = {}
    for raw in complete.splitlines():
        parsed = parse_line(raw.decode("utf-8", "ignore"))
        if not parsed:
            continue
        day, filename = parsed
        counts[(day, filename)] = counts.get((day, filename), 0) + 1

    for (day, filename), inc in counts.items():
        slug = slug_from_file(filename)
        conn.execute(
            """INSERT INTO daily_downloads(slug, day, file, requests) VALUES (?,?,?,?)
               ON CONFLICT(slug, day, file) DO UPDATE SET requests = requests + excluded.requests""",
            (slug, day, filename, inc),
        )

    set_state(conn, st.st_ino, path, new_offset)
    return sum(counts.values())


def main():
    if not os.path.exists(DB_PATH):
        print(f"数据库不存在：{DB_PATH}", file=sys.stderr)
        return 1

    conn = db()
    total = 0
    errors = 0
    for path in sorted(glob.glob(LOG_GLOB)):
        try:
            n = ingest_file(conn, path)
        except PermissionError:
            print(f"无权限读取 {path}", file=sys.stderr)
            errors += 1
            continue
        if n:
            print(f"{path}: +{n}")
        total += n
    conn.commit()
    conn.close()
    print(f"本次新增下载记录 {total} 条")
    if errors:
        print(f"有 {errors} 个日志文件读取失败", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
