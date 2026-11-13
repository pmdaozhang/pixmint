#!/usr/bin/env python3
"""
Hug 数据台后端 API
背景：Pixmint 等工具需要统一的下载统计与用户反馈看板，前台是静态页，只有 /api/ 走这里。
设计意图：单文件 Flask + SQLite，不引入 ORM；数据量是"天 × 文件"级别，SQL 足够。
关键约束：只监听 127.0.0.1，由 nginx 反代暴露；所有管理接口要求登录态。
"""
import os
import uuid
import sqlite3
import time
import hashlib
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import Flask, request, jsonify, session, g, send_file
from werkzeug.security import check_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix

DB_PATH = os.environ.get("HUGDATA_DB", "/var/lib/hugdata/data.db")
SECRET = os.environ.get("HUGDATA_SECRET", "")
ADMIN_USER = os.environ.get("HUGDATA_ADMIN_USER", "admin")
ADMIN_HASH = os.environ.get("HUGDATA_ADMIN_HASH", "")
IP_SALT = os.environ.get("HUGDATA_IP_SALT", "hugdata")
ATTACH_DIR = os.environ.get("HUGDATA_ATTACH_DIR", "/var/lib/hugdata/attachments")
LICENSE_ORDERS_API = os.environ.get(
    "PIXMINT_ORDERS_API", "http://127.0.0.1:8101/v1/admin/manual/orders"
)
LICENSE_ORDERS_TOKEN = os.environ.get("PIXMINT_ORDERS_TOKEN", "")
ORDER_ID_RE = re.compile(r"^[A-Za-z0-9-]{4,40}$")
MAX_ATTACH = 5 * 1024 * 1024
MAX_ATTACH_COUNT = 10
ALLOWED_MIME = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
TZ = timezone(timedelta(hours=8))

if not SECRET or not ADMIN_HASH:
    raise SystemExit("HUGDATA_SECRET / HUGDATA_ADMIN_HASH 未配置")

app = Flask(__name__)
app.secret_key = SECRET
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=True,
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    JSON_AS_ASCII=False,
)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

SCHEMA = """
CREATE TABLE IF NOT EXISTS tools (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  site_url TEXT,
  download_file TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_downloads (
  slug TEXT NOT NULL,
  day TEXT NOT NULL,
  file TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day, file)
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_slug TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  version TEXT,
  os TEXT,
  contact TEXT,
  ip_hash TEXT,
  request_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_tool ON feedback(tool_slug, status, id DESC);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attach_fb ON attachments(feedback_id);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start REAL NOT NULL,
  count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS log_state (
  inode INTEGER PRIMARY KEY,
  path TEXT,
  offset INTEGER NOT NULL DEFAULT 0
);
"""


def db():
    """当前请求的数据库连接。背景：SQLite 连接不能跨线程共享，按请求建连最稳。"""
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=10)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    os.makedirs(ATTACH_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    # 老库补列：客户端契约新增的系统信息字段
    cols = {r[1] for r in conn.execute("PRAGMA table_info(feedback)")}
    for col in ("platform", "os_version", "arch"):
        if col not in cols:
            conn.execute(f"ALTER TABLE feedback ADD COLUMN {col} TEXT")
    conn.commit()
    conn.close()


def parse_fid(raw):
    """接受 fb_12 或 12，统一转整数；非法返回 None。"""
    s = str(raw or "").strip()
    if s.startswith("fb_"):
        s = s[3:]
    return int(s) if s.isdigit() else None


def iso_now():
    return datetime.now(TZ).isoformat(timespec="seconds")


def today_str():
    return datetime.now(TZ).date().isoformat()


def days_back(n):
    end = datetime.now(TZ).date()
    return [(end - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


def ip_hash():
    """只存加盐哈希，不落明文 IP；用于限速与反刷，不对外展示。"""
    ip = request.headers.get("X-Real-IP") or request.remote_addr or ""
    return hashlib.sha256((IP_SALT + ip).encode()).hexdigest()[:16]


# ---------- 登录限速：进程内内存即可（单机、2 worker，量级足够） ----------
_login_fails = {}
LOCK_SECONDS = 300
MAX_FAILS = 5


def login_locked(key):
    rec = _login_fails.get(key)
    if not rec:
        return 0
    fails, until = rec
    if until and until > time.time():
        return int(until - time.time())
    if until and until <= time.time():
        _login_fails.pop(key, None)
    return 0


def record_login_fail(key):
    fails, _ = _login_fails.get(key, (0, 0))
    fails += 1
    until = time.time() + LOCK_SECONDS if fails >= MAX_FAILS else 0
    _login_fails[key] = (fails, until)


# 限速状态放 SQLite：gunicorn 多 worker 时内存计数不共享，会失效
FB_WINDOW = 600
FB_LIMIT = 10


def hit_limit(key, limit, window):
    """滑动窗口计数。返回 True 表示超限。所有 worker 共用同一张表。"""
    now = time.time()
    conn = db()
    conn.execute(
        """INSERT INTO rate_limits(key, window_start, count) VALUES (?,?,1)
           ON CONFLICT(key) DO UPDATE SET
             count = CASE WHEN ? - rate_limits.window_start > ? THEN 1 ELSE rate_limits.count + 1 END,
             window_start = CASE WHEN ? - rate_limits.window_start > ? THEN ? ELSE rate_limits.window_start END""",
        (key, now, now, window, now, window, now),
    )
    conn.commit()
    row = conn.execute("SELECT count FROM rate_limits WHERE key=?", (key,)).fetchone()
    return bool(row and row["count"] > limit)


def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("uid"):
            return jsonify(error="unauthorized"), 401
        return fn(*args, **kwargs)
    return wrapper


def license_order_request(path="", method="GET", body=None):
    """数据台只做界面，订单数据仍以授权服务 SQLite 为准。"""
    if not LICENSE_ORDERS_TOKEN:
        return None, "orders_token_missing"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        LICENSE_ORDERS_API + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {LICENSE_ORDERS_TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            raw = resp.read().decode("utf-8") or "{}"
            return json.loads(raw), None
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8") or "{}")
        except Exception:
            payload = {}
        return None, payload.get("error") or f"license_http_{exc.code}"
    except Exception as exc:  # noqa: BLE001
        return None, f"license_unreachable: {exc}"


# ---------------- 健康检查 ----------------
@app.get("/api/health")
def health():
    checks = {"dashboard": "ok"}
    try:
        db().execute("SELECT 1").fetchone()
    except Exception as exc:
        checks["dashboard"] = str(exc)
    try:
        with urllib.request.urlopen("http://127.0.0.1:8101/healthz", timeout=3) as resp:
            checks["license"] = "ok" if resp.status == 200 else f"http_{resp.status}"
    except Exception as exc:
        checks["license"] = str(exc)
    ok = all(value == "ok" for value in checks.values())
    return jsonify(ok=ok, checks=checks, time=iso_now()), (200 if ok else 503)


# ---------------- 登录 ----------------
@app.post("/api/admin/login")
def login():
    key = ip_hash()
    wait = login_locked(key)
    if wait:
        return jsonify(error="locked", retry_after=wait), 429

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if username != ADMIN_USER or not check_password_hash(ADMIN_HASH, password):
        record_login_fail(key)
        return jsonify(error="invalid_credentials"), 401

    _login_fails.pop(key, None)
    session.clear()
    session.permanent = True
    session["uid"] = ADMIN_USER
    return jsonify(ok=True, user=ADMIN_USER)


@app.post("/api/admin/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/admin/me")
@require_admin
def me():
    return jsonify(ok=True, user=session.get("uid"))


# ---------------- 工具 ----------------
@app.get("/api/admin/tools")
@require_admin
def list_tools():
    rows = db().execute(
        """SELECT t.slug, t.name, t.site_url, t.download_file,
                  COALESCE((SELECT SUM(requests) FROM daily_downloads d WHERE d.slug = t.slug), 0) AS total
           FROM tools t ORDER BY t.created_at"""
    ).fetchall()
    return jsonify(tools=[dict(r) for r in rows])


@app.post("/api/admin/tools")
@require_admin
def create_tool():
    data = request.get_json(silent=True) or {}
    slug = (data.get("slug") or "").strip().lower()
    name = (data.get("name") or "").strip()
    if not slug or not name:
        return jsonify(error="slug_and_name_required"), 400
    if not slug.replace("-", "").isalnum():
        return jsonify(error="invalid_slug"), 400
    try:
        db().execute(
            "INSERT INTO tools(slug, name, site_url, download_file, created_at) VALUES (?,?,?,?,?)",
            (slug, name, data.get("site_url"), data.get("download_file"), iso_now()),
        )
        db().commit()
    except sqlite3.IntegrityError:
        return jsonify(error="slug_exists"), 409
    return jsonify(ok=True, slug=slug), 201


# ---------------- 概览 ----------------
@app.get("/api/admin/overview")
@require_admin
def overview():
    slug = request.args.get("tool", "pixmint")
    try:
        rng = int(request.args.get("range", 30))
    except ValueError:
        rng = 30
    rng = rng if rng in (7, 30, 90) else 30

    conn = db()
    total = conn.execute(
        "SELECT COALESCE(SUM(requests),0) FROM daily_downloads WHERE slug=?", (slug,)
    ).fetchone()[0]

    days = days_back(rng)
    rows = conn.execute(
        """SELECT day, SUM(requests) AS c FROM daily_downloads
           WHERE slug=? AND day>=? GROUP BY day""",
        (slug, days[0]),
    ).fetchall()
    by_day = {r["day"]: r["c"] for r in rows}
    series = [{"day": d, "count": by_day.get(d, 0)} for d in days]

    today = series[-1]["count"]
    week = sum(x["count"] for x in series[-7:]) if len(series) >= 7 else sum(x["count"] for x in series)

    fb = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open
           FROM feedback WHERE tool_slug=?""",
        (slug,),
    ).fetchone()

    tool = conn.execute("SELECT name, site_url, download_file FROM tools WHERE slug=?", (slug,)).fetchone()

    return jsonify(
        tool={"slug": slug, "name": tool["name"] if tool else slug},
        range=rng,
        totals={"total": total, "today": today, "week": week},
        series=series,
        feedback={"total": fb["total"] or 0, "open": fb["open"] or 0},
    )


# ---------------- 反馈 ----------------
@app.get("/api/admin/feedback")
@require_admin
def list_feedback():
    slug = request.args.get("tool", "pixmint")
    status = request.args.get("status", "all")
    try:
        page = max(1, int(request.args.get("page", 1)))
    except ValueError:
        page = 1
    size = 20

    where, params = ["tool_slug=?"], [slug]
    if status in ("open", "done"):
        where.append("status=?")
        params.append(status)
    clause = " AND ".join(where)

    conn = db()
    total = conn.execute(f"SELECT COUNT(*) FROM feedback WHERE {clause}", params).fetchone()[0]
    rows = conn.execute(
        f"""SELECT id, type, content, version, os, platform, os_version, arch,
                   contact, status, created_at,
                   (SELECT COUNT(*) FROM attachments a WHERE a.feedback_id = feedback.id) AS attachment_count
            FROM feedback WHERE {clause} ORDER BY id DESC LIMIT ? OFFSET ?""",
        params + [size, (page - 1) * size],
    ).fetchall()

    return jsonify(
        total=total,
        page=page,
        items=[dict(r) for r in rows],
    )


# ---------------- 人工收款订单（代理授权服务） ----------------
@app.get("/api/admin/manual-orders")
@require_admin
def list_manual_orders():
    query = urllib.parse.urlencode(
        {key: value for key, value in request.args.items() if value}
    )
    data, err = license_order_request("?" + query if query else "")
    if err:
        return jsonify(error=err), 502
    return jsonify(data or {})


@app.post("/api/admin/manual-orders/<order_id>/confirm")
@require_admin
def confirm_manual_order(order_id):
    if not ORDER_ID_RE.match(order_id):
        return jsonify(error="invalid_order_id"), 400
    body = request.get_json(silent=True) or {}
    payload = {"sendEmail": body.get("sendEmail", True)}
    email = (body.get("email") or "").strip()
    if email:
        payload["email"] = email
    data, err = license_order_request(f"/{order_id}/confirm", "POST", payload)
    if err:
        return jsonify(error=err), 502
    return jsonify(data or {})


@app.post("/api/admin/manual-orders/<order_id>/reject")
@require_admin
def reject_manual_order(order_id):
    if not ORDER_ID_RE.match(order_id):
        return jsonify(error="invalid_order_id"), 400
    body = request.get_json(silent=True) or {}
    data, err = license_order_request(
        f"/{order_id}/reject",
        "POST",
        {"reason": (body.get("reason") or "").strip()[:300]},
    )
    if err:
        return jsonify(error=err), 502
    return jsonify(data or {})


@app.post("/api/admin/manual-orders/<order_id>/reopen")
@require_admin
def reopen_manual_order(order_id):
    if not ORDER_ID_RE.match(order_id):
        return jsonify(error="invalid_order_id"), 400
    data, err = license_order_request(f"/{order_id}/reopen", "POST", {})
    if err:
        return jsonify(error=err), 502
    return jsonify(data or {})


@app.post("/api/admin/manual-orders/<order_id>/revoke")
@require_admin
def revoke_manual_order(order_id):
    if not ORDER_ID_RE.match(order_id):
        return jsonify(error="invalid_order_id"), 400
    data, err = license_order_request(f"/{order_id}/revoke", "POST", {})
    if err:
        return jsonify(error=err), 502
    return jsonify(data or {})


@app.post("/api/admin/manual-orders/<order_id>/notify")
@require_admin
def notify_manual_order(order_id):
    if not ORDER_ID_RE.match(order_id):
        return jsonify(error="invalid_order_id"), 400
    data, err = license_order_request(f"/{order_id}/notify", "POST", {})
    if err:
        return jsonify(error=err), 502
    return jsonify(data or {})


@app.patch("/api/admin/feedback/<raw_fid>")
@require_admin
def update_feedback(raw_fid):
    fid = parse_fid(raw_fid)
    if not fid:
        return jsonify(error="invalid_id"), 400
    data = request.get_json(silent=True) or {}
    status = data.get("status")
    if status not in ("open", "done"):
        return jsonify(error="invalid_status"), 400
    cur = db().execute("UPDATE feedback SET status=? WHERE id=?", (status, fid))
    db().commit()
    if cur.rowcount == 0:
        return jsonify(error="not_found"), 404
    return jsonify(ok=True)


# ---------------- 反馈详情与附件（管理端） ----------------
@app.get("/api/admin/feedback/<raw_fid>")
@require_admin
def feedback_detail(raw_fid):
    fid = parse_fid(raw_fid)
    if not fid:
        return jsonify(error="invalid_id"), 400
    row = db().execute(
        """SELECT id, tool_slug, type, content, version, os, platform, os_version, arch,
                  contact, status, created_at
           FROM feedback WHERE id=?""",
        (fid,),
    ).fetchone()
    if not row:
        return jsonify(error="not_found"), 404
    atts = db().execute(
        "SELECT id, mime, size, created_at FROM attachments WHERE feedback_id=? ORDER BY id",
        (fid,),
    ).fetchall()
    item = dict(row)
    item["id"] = f"fb_{row['id']}"
    item["attachments"] = [dict(a) for a in atts]
    return jsonify(item=item)


@app.get("/api/admin/attachments/<int:aid>")
@require_admin
def get_attachment(aid):
    row = db().execute("SELECT filename, mime FROM attachments WHERE id=?", (aid,)).fetchone()
    if not row:
        return jsonify(error="not_found"), 404
    return send_file(row["filename"], mimetype=row["mime"], conditional=True)


# ---------------- 公开接口：文本 + 附件 ----------------
@app.post("/api/v1/feedback/<raw_fid>/attachments")
def upload_attachment(raw_fid):
    """客户端逐张上传截图。失败不影响已成功的文字反馈（契约 4）。"""
    fid = parse_fid(raw_fid)
    if not fid or not db().execute("SELECT 1 FROM feedback WHERE id=?", (fid,)).fetchone():
        return jsonify(error="feedback_not_found"), 404

    count = db().execute("SELECT COUNT(*) FROM attachments WHERE feedback_id=?", (fid,)).fetchone()[0]
    if count >= MAX_ATTACH_COUNT:
        return jsonify(error="too_many_attachments"), 400

    upload = request.files.get("file")
    if not upload:
        return jsonify(error="file_required"), 400

    data = upload.read(MAX_ATTACH + 1)
    if len(data) > MAX_ATTACH:
        return jsonify(error="file_too_large"), 413
    if not data:
        return jsonify(error="file_empty"), 400

    mime = (upload.mimetype or "").split(";")[0].strip().lower()
    if mime not in ALLOWED_MIME:
        return jsonify(error="unsupported_type"), 400

    folder = os.path.join(ATTACH_DIR, str(fid))
    os.makedirs(folder, exist_ok=True)
    filename = os.path.join(folder, f"{uuid.uuid4().hex}.{ALLOWED_MIME[mime]}")
    with open(filename, "wb") as fh:
        fh.write(data)

    cur = db().execute(
        "INSERT INTO attachments(feedback_id, filename, mime, size, created_at) VALUES (?,?,?,?,?)",
        (fid, filename, mime, len(data), iso_now()),
    )
    db().commit()
    return jsonify(ok=True, id=cur.lastrowid), 201


@app.post("/api/v1/feedback")
def public_feedback():
    """客户端文本上报。字段白名单严格按 integrations/feedback-backend-contract.md。"""
    if hit_limit("fb:" + ip_hash(), FB_LIMIT, FB_WINDOW):
        return jsonify(error="rate_limited"), 429
    data = request.get_json(silent=True) or {}
    tool = (data.get("tool") or "").strip()
    ftype = (data.get("type") or "").strip()
    content = (data.get("content") or "").strip()

    if not tool or not db().execute("SELECT 1 FROM tools WHERE slug=?", (tool,)).fetchone():
        return jsonify(error="unknown_tool"), 400
    if ftype not in ("bug", "idea", "other"):
        return jsonify(error="invalid_type"), 400
    if len(content) < 1:
        return jsonify(error="content_too_short"), 400
    if len(content) > 1000:
        return jsonify(error="content_too_long"), 400

    rid = (data.get("request_id") or "").strip() or None
    if not rid:
        return jsonify(error="request_id_required"), 400

    platform = (data.get("platform") or "")[:20] or None
    os_version = (data.get("os_version") or "")[:40] or None
    arch = (data.get("arch") or "")[:20] or None

    try:
        cur = db().execute(
            """INSERT INTO feedback(tool_slug, type, content, version, platform, os_version, arch,
                                    ip_hash, request_id, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                tool, ftype, content, (data.get("version") or "")[:40],
                platform, os_version, arch,
                ip_hash(), rid, iso_now(),
            ),
        )
        db().commit()
        return jsonify(id=f"fb_{cur.lastrowid}", request_id=rid), 201
    except sqlite3.IntegrityError:
        row = db().execute("SELECT id FROM feedback WHERE request_id=?", (rid,)).fetchone()
        return jsonify(id=f"fb_{row['id']}" if row else None, request_id=rid, duplicate=True), 200
    except Exception as exc:
        app.logger.exception("feedback insert failed: %s", exc)
        return jsonify(error="server_error"), 500


with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8100, debug=False)
