"""Pixmint 授权与订单服务。

独立于反馈后台运行，私钥只保存在本机 env 指定的文件中。
客户端离线验签，本服务只负责设备绑定、续签、发码和支付回调。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import os
import secrets
import smtplib
import sqlite3
import time
from email.message import EmailMessage
from functools import wraps
from typing import Any

import requests
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from flask import Flask, g, jsonify, request, Response

try:  # 二维码可选：未安装时降级为支付链接
    import qrcode
    import qrcode.image.svg
except Exception:  # pragma: no cover - 部署环境不同
    qrcode = None

DAY = 86_400
TRIAL_DAYS = 7
INVITE_REWARD_DAYS = 90
INVITE_REWARD_CAP = 12
MAX_DEVICES = 3

PLANS = {
    "monthly": {"price": 900, "days": 30, "title": "Pixmint Pro 月付"},
    "yearly": {"price": 8000, "days": 365, "title": "Pixmint Pro 年付"},
    "lifetime": {"price": 19800, "days": None, "title": "Pixmint Pro 终身"},
}


# ---------------------------------------------------------------------------
# 通用工具


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def now_ts() -> int:
    return int(time.time())


def iso(ts: int | None) -> str | None:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)) if ts else None


def error(message: str, code: str = "bad_request", status: int = 400) -> tuple[Any, int]:
    return jsonify({"error": message, "code": code}), status


def json_body() -> dict[str, Any]:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def clean_text(value: Any, limit: int = 200) -> str:
    return str(value or "").strip()[:limit]


def clean_device(value: Any) -> str:
    text = clean_text(value, 80).lower()
    if not text or any(char not in "0123456789abcdef" for char in text):
        raise ValueError("invalid device id")
    return text


# ---------------------------------------------------------------------------
# 授权码


class TokenSigner:
    def __init__(self, private_key: Ed25519PrivateKey, kid: str = "prod-1") -> None:
        self.private_key = private_key
        self.public_key = private_key.public_key()
        self.kid = kid

    def sign(self, payload: dict[str, Any]) -> str:
        part = b64url(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode())
        signature = self.private_key.sign(part.encode("ascii"))
        return f"{part}.{b64url(signature)}"

    def verify(self, token: str) -> dict[str, Any] | None:
        try:
            part, signature = token.split(".", 1)
            self.public_key.verify(b64url_decode(signature), part.encode("ascii"))
            payload = json.loads(b64url_decode(part))
            return payload if isinstance(payload, dict) else None
        except (InvalidSignature, ValueError, TypeError, json.JSONDecodeError):
            return None


def load_signer(path: str, kid: str) -> TokenSigner:
    with open(path, "rb") as handle:
        key = serialization.load_pem_private_key(handle.read(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise RuntimeError("license key must be Ed25519")
    return TokenSigner(key, kid)


# ---------------------------------------------------------------------------
# 数据库


SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  order_token TEXT NOT NULL,
  provider TEXT NOT NULL,
  sku TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  device_id TEXT NOT NULL,
  email TEXT,
  invite_code TEXT,
  pay_url TEXT,
  pay_form TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  refunded_at INTEGER
);
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  invite_code TEXT NOT NULL UNIQUE,
  order_id TEXT,
  plan TEXT NOT NULL,
  kid TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER,
  update_until INTEGER,
  max_devices INTEGER NOT NULL,
  revoked_at INTEGER,
  trial INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  device_name TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  UNIQUE(license_id, device_hash)
);
CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT PRIMARY KEY,
  order_id TEXT,
  payload TEXT,
  received_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS referrals (
  invite_code TEXT NOT NULL,
  owner_license_id TEXT NOT NULL,
  invitee_device_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  reward_days INTEGER NOT NULL,
  granted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS email_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT,
  email TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
"""


def open_db(path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    return conn


def db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = open_db(g.app_config["db"])
    return g.db


def query(sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    return db().execute(sql, params).fetchall()


def one(sql: str, params: tuple[Any, ...] = ()) -> sqlite3.Row | None:
    return db().execute(sql, params).fetchone()


# ---------------------------------------------------------------------------
# 面包多 Pay


class MbdPay:
    """面包多Pay 适配器；未配置密钥时由 create_app 禁用下单。"""

    def __init__(self, app_id: str, app_key: str, base: str, mock: bool) -> None:
        self.app_id = app_id
        self.app_key = app_key
        self.base = base.rstrip("/")
        self.mock = mock

    @property
    def enabled(self) -> bool:
        return self.mock or bool(self.app_id and self.app_key)

    def sign(self, params: dict[str, Any]) -> str:
        filtered = {k: v for k, v in params.items() if v not in (None, "")}
        joined = "&".join(f"{key}={filtered[key]}" for key in sorted(filtered))
        return hashlib.md5(f"{joined}&key={self.app_key}".encode()).hexdigest()

    def _post(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        if self.mock:
            return {"mock": True}
        payload = dict(params)
        payload["app_id"] = self.app_id
        payload["sign"] = self.sign(payload)
        response = requests.post(f"{self.base}{path}", json=payload, timeout=15)
        response.raise_for_status()
        data = response.json()
        if data.get("error"):
            raise RuntimeError(str(data["error"]))
        return data

    def prepay_alipay(self, order_id: str, amount: int, title: str, callback: str) -> str:
        data = self._post(
            "/release/alipay/pay",
            {
                "url": callback,
                "callback_url": callback,
                "description": title,
                "amount_total": amount,
                "out_trade_no": order_id,
            },
        )
        return str(data.get("body") or "")

    def prepay_wechat(self, order_id: str, amount: int, title: str) -> str:
        data = self._post(
            "/release/wx/prepay",
            {
                "channel": "h5",
                "description": title,
                "amount_total": amount,
                "out_trade_no": order_id,
            },
        )
        return str(data.get("h5_url") or "")

    def query_order(self, order_id: str) -> dict[str, Any]:
        if self.mock:
            return {"state": "1", "amount": None}
        params = {"app_id": self.app_id, "out_trade_no": order_id}
        params["sign"] = self.sign(params)
        response = requests.post(
            f"{self.base}/release/main/search_order", json=params, timeout=15
        )
        response.raise_for_status()
        return response.json()


# ---------------------------------------------------------------------------
# 应用工厂


def create_app(config: dict[str, Any] | None = None) -> Flask:
    app = Flask(__name__)
    app.config.update(
        db=os.environ.get("PIXMINT_LICENSE_DB", "/var/lib/pixmint-license/license.db"),
        key_path=os.environ.get("PIXMINT_LICENSE_KEY", "/etc/pixmint-license/ed25519.key"),
        kid=os.environ.get("PIXMINT_LICENSE_KID", "prod-1"),
        base_url=os.environ.get("PIXMINT_BASE_URL", "https://data.hugproducthub.top"),
        admin_token=os.environ.get("PIXMINT_ADMIN_TOKEN", ""),
        mbd_app_id=os.environ.get("MBD_APP_ID", ""),
        mbd_app_key=os.environ.get("MBD_APP_KEY", ""),
        mbd_base=os.environ.get("MBD_API_BASE", "https://newapi.mbd.pub"),
        pay_mock=os.environ.get("PIXMINT_PAY_MOCK", "") == "1",
        pay_mock_auto=os.environ.get("PIXMINT_PAY_MOCK_AUTO", "") == "1",
        smtp_host=os.environ.get("PIXMINT_SMTP_HOST", ""),
        smtp_port=int(os.environ.get("PIXMINT_SMTP_PORT", "465") or 465),
        smtp_user=os.environ.get("PIXMINT_SMTP_USER", ""),
        smtp_password=os.environ.get("PIXMINT_SMTP_PASSWORD", ""),
        smtp_from=os.environ.get("PIXMINT_SMTP_FROM", ""),
    )
    if config:
        app.config.update(config)
    if app.config["pay_mock_auto"] and not app.config["pay_mock"]:
        app.config["pay_mock_auto"] = False

    signer = load_signer(app.config["key_path"], app.config["kid"])
    pay = MbdPay(
        app.config["mbd_app_id"],
        app.config["mbd_app_key"],
        app.config["mbd_base"],
        app.config["pay_mock"],
    )
    app.extensions["signer"] = signer
    app.extensions["pay"] = pay

    @app.before_request
    def bind_config() -> None:
        g.app_config = app.config

    @app.teardown_appcontext
    def close_db(_exc: BaseException | None) -> None:
        conn = g.pop("db", None)
        if conn is not None:
            conn.close()

    # -- 基础 --------------------------------------------------------------

    @app.get("/healthz")
    def health() -> Response:
        return Response("ok\n", mimetype="text/plain")

    @app.get("/v1/plans")
    def plans() -> Any:
        return jsonify(
            {
                "purchaseEnabled": pay.enabled,
                "providers": ["alipay", "wechat"],
                "plans": {
                    key: {"price": value["price"], "days": value["days"]}
                    for key, value in PLANS.items()
                },
            }
        )

    # -- 订单 --------------------------------------------------------------

    def order_public(order: sqlite3.Row) -> dict[str, Any]:
        return {
            "status": order["status"],
            "code": None,
            "token": None,
        }

    def ensure_license_for_order(order: sqlite3.Row) -> sqlite3.Row | None:
        existing = one("SELECT * FROM licenses WHERE order_id = ?", (order["order_id"],))
        if existing:
            return existing
        if order["status"] != "paid":
            return None
        return create_license(
            order_id=order["order_id"],
            plan=order["sku"],
            device_id=order["device_id"],
            expires_at=None,
            trial=False,
        )

    @app.post("/v1/pay/orders")
    def create_order() -> Any:
        body = json_body()
        plan = clean_text(body.get("plan"), 20)
        provider = clean_text(body.get("provider"), 20)
        if plan not in PLANS:
            return error("未知套餐", "bad_plan")
        if provider not in ("alipay", "wechat"):
            return error("不支持的支付方式", "bad_provider")
        if not pay.enabled:
            return error("支付暂未开放，请稍后再试", "pay_unavailable", 503)
        try:
            device_id = clean_device(body.get("deviceId"))
        except ValueError:
            return error("设备标识无效", "bad_device")
        order_id = "PX" + time.strftime("%Y%m%d%H%M%S") + secrets.token_hex(3)
        order_token = secrets.token_urlsafe(24)
        amount = PLANS[plan]["price"]
        title = PLANS[plan]["title"]
        callback = f"{app.config['base_url'].rstrip('/')}/pay/done"
        pay_form = ""
        pay_url = ""
        if provider == "alipay":
            pay_form = pay.prepay_alipay(order_id, amount, title, callback)
        else:
            pay_url = pay.prepay_wechat(order_id, amount, title)
        conn = db()
        conn.execute(
            """INSERT INTO orders
               (order_id, order_token, provider, sku, amount_cents, status, device_id,
                created_at, pay_form, pay_url)
               VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)""",
            (order_id, order_token, provider, plan, amount, device_id, now_ts(), pay_form, pay_url),
        )
        conn.commit()
        if app.config["pay_mock_auto"]:
            mark_order_paid(order_id, "auto_" + order_id, {"mock": True})
        mobile_url = f"{app.config['base_url'].rstrip('/')}/pay/{order_id}?k={order_token}"
        return jsonify(
            {
                "orderId": order_id,
                "orderToken": order_token,
                "payUrl": mobile_url,
                "qrSvg": make_qr(mobile_url),
                "expiresAt": (now_ts() + 15 * 60) * 1000,
            }
        )

    @app.get("/v1/pay/orders/<order_id>")
    def order_status(order_id: str) -> Any:
        token = clean_text(request.args.get("token"), 200)
        order = one("SELECT * FROM orders WHERE order_id = ?", (order_id,))
        if not order or not hmac.compare_digest(order["order_token"], token):
            return error("订单不存在", "not_found", 404)
        if order["status"] == "pending" and now_ts() - order["created_at"] > 15 * 60:
            db().execute("UPDATE orders SET status='expired' WHERE order_id=?", (order_id,))
            db().commit()
            order = one("SELECT * FROM orders WHERE order_id = ?", (order_id,))
        result = order_public(order)
        if order["status"] == "paid":
            license_row = ensure_license_for_order(order)
            if license_row:
                result["code"] = license_row["code"]
                result["token"] = sign_bound_license(license_row, order["device_id"])
        return jsonify(result)

    @app.post("/v1/pay/webhook/mbd")
    def mbd_webhook() -> Any:
        body = json_body()
        if body.get("type") != "charge_succeeded":
            return jsonify({"code": 0, "message": "ignored"})
        data = body.get("data") or {}
        order_id = clean_text(data.get("out_trade_no"), 80)
        if not order_id:
            return jsonify({"code": 0, "message": "ignored"})
        event_id = clean_text(data.get("charge_id") or order_id, 120)
        existing_event = one("SELECT event_id FROM payment_events WHERE event_id = ?", (event_id,))
        if existing_event:
            return jsonify({"code": 0, "message": "duplicate"})
        order = one("SELECT * FROM orders WHERE order_id = ?", (order_id,))
        if not order:
            return jsonify({"code": 0, "message": "unknown order"})
        # 回调本身没有签名，必须反查订单，避免伪造金额。
        try:
            remote = pay.query_order(order_id)
        except Exception as exc:  # noqa: BLE001
            return jsonify({"code": 1, "message": f"query failed: {exc}"}), 502
        if str(remote.get("state")) not in ("1", "2"):
            return jsonify({"code": 0, "message": "unpaid"})
        remote_amount = remote.get("amount")
        if remote_amount is not None and int(remote_amount) != int(order["amount_cents"]):
            return jsonify({"code": 1, "message": "amount mismatch"}), 400
        mark_order_paid(order_id, event_id, data)
        return jsonify({"code": 0})

    @app.post("/v1/pay/mock/complete")
    def mock_complete() -> Any:
        if not app.config["pay_mock"]:
            return error("not found", "not_found", 404)
        body = json_body()
        order_id = clean_text(body.get("orderId") or request.args.get("order"), 80)
        order = one("SELECT * FROM orders WHERE order_id = ?", (order_id,))
        if not order:
            return error("订单不存在", "not_found", 404)
        mark_order_paid(order_id, "mock_" + order_id, {"mock": True})
        return jsonify({"ok": True})

    @app.get("/pay/<order_id>")
    def mobile_pay(order_id: str) -> Response:
        token = clean_text(request.args.get("k"), 200)
        order = one("SELECT * FROM orders WHERE order_id = ?", (order_id,))
        if not order or not hmac.compare_digest(order["order_token"], token):
            return Response("订单不存在", status=404, mimetype="text/html")
        if order["status"] != "pending":
            return Response(pay_result_page(order), mimetype="text/html")
        if order["provider"] == "alipay" and order["pay_form"]:
            return Response(
                wrap_mobile_html("正在打开支付宝…", order["pay_form"]), mimetype="text/html"
            )
        if order["provider"] == "wechat" and order["pay_url"]:
            return Response(
                wrap_mobile_html(
                    "正在打开微信支付…",
                    f'<script>location.href={json.dumps(order["pay_url"])}</script>',
                ),
                mimetype="text/html",
            )
        if app.config["pay_mock"]:
            return Response(
                wrap_mobile_html(
                    "测试支付",
                    f'<form method="post" action="/v1/pay/mock/complete?order={order_id}">'
                    f'<button type="submit">模拟支付成功</button></form>',
                ),
                mimetype="text/html",
            )
        return Response("支付通道未配置", status=503, mimetype="text/html")

    @app.get("/pay/done")
    def pay_done() -> Response:
        return Response(
            wrap_mobile_html("支付完成", "<p>请回到 Pixmint，授权正在自动生效。</p>"),
            mimetype="text/html",
        )

    # -- 授权 --------------------------------------------------------------

    @app.post("/v1/license/activate")
    def activate() -> Any:
        body = json_body()
        code = clean_text(body.get("code"), 4096)
        try:
            device_id = clean_device(body.get("deviceId"))
        except ValueError:
            return error("设备标识无效", "bad_device")
        payload = signer.verify(code)
        if not payload or payload.get("dev") is not None:
            return error("激活码无效", "invalid_code")
        license_row = one("SELECT * FROM licenses WHERE code = ?", (code,))
        if not license_row:
            return error("激活码无效", "invalid_code")
        if license_row["revoked_at"]:
            return error("授权已失效", "revoked", 410)
        if license_row["expires_at"] and license_row["expires_at"] < now_ts():
            return error("授权已过期", "expired", 410)
        existing = one(
            "SELECT id FROM devices WHERE license_id = ? AND device_hash = ?",
            (license_row["id"], device_id),
        )
        if not existing:
            count = one(
                "SELECT COUNT(*) AS total FROM devices WHERE license_id = ?",
                (license_row["id"],),
            )["total"]
            if count >= license_row["max_devices"]:
                return error("设备数已满，请先在旧设备解绑", "device_limit", 409)
            db().execute(
                "INSERT INTO devices (license_id, device_hash, device_name, first_seen, last_seen)"
                " VALUES (?, ?, ?, ?, ?)",
                (
                    license_row["id"],
                    device_id,
                    clean_text(body.get("deviceName"), 60),
                    now_ts(),
                    now_ts(),
                ),
            )
        else:
            db().execute(
                "UPDATE devices SET last_seen = ? WHERE license_id = ? AND device_hash = ?",
                (now_ts(), license_row["id"], device_id),
            )
        db().commit()
        return jsonify(activation_payload(license_row, device_id))

    @app.post("/v1/license/refresh")
    def refresh() -> Any:
        body = json_body()
        token = clean_text(body.get("token"), 4096)
        try:
            device_id = clean_device(body.get("deviceId"))
        except ValueError:
            return error("设备标识无效", "bad_device")
        payload = signer.verify(token)
        if not payload or payload.get("dev") != device_id:
            return error("授权无效", "invalid_token", 401)
        license_row = one("SELECT * FROM licenses WHERE id = ?", (payload.get("lic"),))
        if not license_row or license_row["revoked_at"]:
            return error("授权已失效", "revoked", 410)
        if license_row["expires_at"] and license_row["expires_at"] < now_ts():
            return error("授权已过期", "expired", 410)
        db().execute(
            "UPDATE devices SET last_seen = ? WHERE license_id = ? AND device_hash = ?",
            (now_ts(), license_row["id"], device_id),
        )
        db().commit()
        return jsonify(activation_payload(license_row, device_id))

    @app.post("/v1/license/by-device")
    def by_device() -> Any:
        body = json_body()
        try:
            device_id = clean_device(body.get("deviceId"))
        except ValueError:
            return error("设备标识无效", "bad_device")
        row = one(
            "SELECT licenses.* FROM devices JOIN licenses ON licenses.id = devices.license_id"
            " WHERE devices.device_hash = ? ORDER BY licenses.issued_at DESC LIMIT 1",
            (device_id,),
        )
        if not row or row["revoked_at"]:
            return error("未找到授权", "not_found", 404)
        if row["expires_at"] and row["expires_at"] < now_ts():
            return error("授权已过期", "expired", 410)
        return jsonify(activation_payload(row, device_id))

    @app.post("/v1/license/devices")
    def device_list() -> Any:
        body = json_body()
        code = clean_text(body.get("code"), 4096)
        license_row = license_by_code(code, signer)
        if not license_row:
            return error("激活码无效", "invalid_code")
        rows = query(
            "SELECT device_hash, device_name, first_seen, last_seen FROM devices"
            " WHERE license_id = ? ORDER BY last_seen DESC",
            (license_row["id"],),
        )
        current = clean_text(body.get("deviceId"), 80).lower()
        return jsonify(
            {
                "devices": [
                    {
                        "deviceHash": row["device_hash"],
                        "name": row["device_name"] or "未命名设备",
                        "firstSeen": row["first_seen"],
                        "lastSeen": row["last_seen"],
                        "current": row["device_hash"] == current,
                    }
                    for row in rows
                ]
            }
        )

    @app.post("/v1/license/unbind")
    def unbind() -> Any:
        body = json_body()
        code = clean_text(body.get("code"), 4096)
        license_row = license_by_code(code, signer)
        if not license_row:
            return error("激活码无效", "invalid_code")
        target = clean_text(body.get("targetDevice"), 80).lower()
        db().execute(
            "DELETE FROM devices WHERE license_id = ? AND device_hash = ?",
            (license_row["id"], target),
        )
        db().commit()
        return jsonify({"ok": True})

    @app.post("/v1/license/trial")
    def trial() -> Any:
        body = json_body()
        invite_code = clean_text(body.get("inviteCode"), 32).upper()
        try:
            device_id = clean_device(body.get("deviceId"))
        except ValueError:
            return error("设备标识无效", "bad_device")
        owner = one("SELECT * FROM licenses WHERE invite_code = ?", (invite_code,))
        if not owner or owner["revoked_at"]:
            return error("邀请码无效", "invalid_invite")
        if one("SELECT 1 FROM referrals WHERE invitee_device_hash = ?", (device_id,)):
            return error("该设备已领取过试用", "trial_used", 409)
        if one("SELECT 1 FROM devices WHERE device_hash = ?", (device_id,)):
            return error("该设备已有授权", "already_licensed", 409)
        recent = one(
            "SELECT COUNT(*) AS total FROM referrals WHERE invite_code = ? AND granted_at > ?",
            (invite_code, now_ts() - 365 * DAY),
        )["total"]
        if recent >= INVITE_REWARD_CAP:
            return error("邀请奖励已达上限", "invite_limit", 429)
        expires_at = now_ts() + TRIAL_DAYS * DAY
        license_row = create_license(
            order_id=None,
            plan="monthly",
            device_id=device_id,
            expires_at=expires_at,
            trial=True,
            max_devices=1,
        )
        db().execute(
            "INSERT INTO referrals (invite_code, owner_license_id, invitee_device_hash, status,"
            " reward_days, granted_at) VALUES (?, ?, ?, 'granted', ?, ?)",
            (invite_code, owner["id"], device_id, INVITE_REWARD_DAYS, now_ts()),
        )
        if owner["expires_at"] is None:
            base = owner["update_until"] or now_ts()
            db().execute(
                "UPDATE licenses SET update_until = ? WHERE id = ?",
                (base + INVITE_REWARD_DAYS * DAY, owner["id"]),
            )
        else:
            base = max(owner["expires_at"], now_ts())
            db().execute(
                "UPDATE licenses SET expires_at = ? WHERE id = ?",
                (base + INVITE_REWARD_DAYS * DAY, owner["id"]),
            )
        db().commit()
        return jsonify(activation_payload(license_row, device_id))

    @app.post("/v1/license/email")
    def send_code_email() -> Any:
        body = json_body()
        code = clean_text(body.get("code"), 4096)
        email = clean_text(body.get("email"), 200)
        if "@" not in email or "." not in email:
            return error("邮箱格式不正确", "bad_email")
        license_row = license_by_code(code, signer)
        if not license_row:
            return error("激活码无效", "invalid_code")
        if not app.config["smtp_host"] or not app.config["smtp_from"]:
            return error("邮件服务未配置", "email_unavailable", 503)
        try:
            send_email(app, email, license_row)
        except Exception as exc:  # noqa: BLE001
            db().execute(
                "INSERT INTO email_jobs (license_id, email, status, attempts, last_error, created_at)"
                " VALUES (?, ?, 'failed', 1, ?, ?)",
                (license_row["id"], email, str(exc)[:300], now_ts()),
            )
            db().commit()
            return error("邮件发送失败，请复制页面上的激活码", "email_failed", 502)
        db().execute(
            "INSERT INTO email_jobs (license_id, email, status, attempts, created_at)"
            " VALUES (?, ?, 'sent', 1, ?)",
            (license_row["id"], email, now_ts()),
        )
        db().execute("UPDATE orders SET email = ? WHERE order_id = ?", (email, license_row["order_id"]))
        db().commit()
        return jsonify({"ok": True})

    # -- 管理 --------------------------------------------------------------

    def require_admin(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            expected = app.config["admin_token"]
            header = request.headers.get("Authorization", "")
            if not expected or header != f"Bearer {expected}":
                return error("未授权", "unauthorized", 401)
            return view(*args, **kwargs)

        return wrapper

    @app.get("/v1/admin/orders")
    @require_admin
    def admin_orders() -> Any:
        rows = query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200")
        return jsonify({"orders": [dict(row) for row in rows]})

    @app.get("/v1/admin/licenses")
    @require_admin
    def admin_licenses() -> Any:
        rows = query("SELECT * FROM licenses ORDER BY issued_at DESC LIMIT 200")
        return jsonify({"licenses": [dict(row) for row in rows]})

    @app.post("/v1/admin/issue")
    @require_admin
    def admin_issue() -> Any:
        body = json_body()
        plan = clean_text(body.get("plan"), 20)
        if plan not in PLANS:
            return error("未知套餐", "bad_plan")
        row = create_license(
            order_id=clean_text(body.get("orderId"), 80) or None,
            plan=plan,
            device_id=None,
            expires_at=None,
            trial=False,
        )
        return jsonify({"code": row["code"], "inviteCode": row["invite_code"]})

    @app.post("/v1/admin/refund")
    @require_admin
    def admin_refund() -> Any:
        body = json_body()
        order_id = clean_text(body.get("orderId"), 80)
        order = one("SELECT * FROM orders WHERE order_id = ?", (order_id,))
        if not order:
            return error("订单不存在", "not_found", 404)
        db().execute(
            "UPDATE orders SET status = 'refunded', refunded_at = ? WHERE order_id = ?",
            (now_ts(), order_id),
        )
        db().execute(
            "UPDATE licenses SET revoked_at = ? WHERE order_id = ?",
            (now_ts(), order_id),
        )
        db().commit()
        return jsonify({"ok": True})

    # ------------------------------------------------------------------
    # 内部工具

    def make_qr(url: str) -> str | None:
        if qrcode is None:
            return None
        try:
            image = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage)
            return image.to_string(encoding="unicode")
        except Exception:  # noqa: BLE001
            return None

    def mark_order_paid(order_id: str, event_id: str, raw: dict[str, Any]) -> None:
        conn = db()
        conn.execute(
            "INSERT OR IGNORE INTO payment_events (event_id, order_id, payload, received_at)"
            " VALUES (?, ?, ?, ?)",
            (event_id, order_id, json.dumps(raw, ensure_ascii=False)[:4000], now_ts()),
        )
        conn.execute(
            "UPDATE orders SET status = 'paid', paid_at = ? WHERE order_id = ? AND status = 'pending'",
            (now_ts(), order_id),
        )
        conn.commit()
        order = one("SELECT * FROM orders WHERE order_id = ?", (order_id,))
        if order:
            ensure_license_for_order(order)

    def create_license(
        order_id: str | None,
        plan: str,
        device_id: str | None,
        expires_at: int | None,
        trial: bool,
        max_devices: int = MAX_DEVICES,
    ) -> sqlite3.Row:
        license_id = secrets.token_hex(8)
        invite_code = "".join(
            secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(8)
        )
        plan_days = PLANS.get(plan, {}).get("days")
        if expires_at is None and plan_days:
            expires_at = now_ts() + plan_days * DAY
        payload = {
            "v": 1,
            "kid": app.config["kid"],
            "plan": "pro",
            "lic": license_id,
            "dev": None,
            "order": order_id,
            "iat": now_ts(),
            "exp": expires_at,
            "upd": None,
            "feat": ["pro"],
            "trial": trial,
        }
        code = signer.sign(payload)
        db().execute(
            "INSERT INTO licenses (id, code, invite_code, order_id, plan, kid, issued_at,"
            " expires_at, update_until, max_devices, trial) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                license_id,
                code,
                invite_code,
                order_id,
                plan,
                app.config["kid"],
                now_ts(),
                expires_at,
                None,
                max_devices,
                1 if trial else 0,
            ),
        )
        if device_id:
            db().execute(
                "INSERT OR IGNORE INTO devices (license_id, device_hash, device_name, first_seen, last_seen)"
                " VALUES (?, ?, ?, ?, ?)",
                (license_id, device_id, "购买设备", now_ts(), now_ts()),
            )
        db().commit()
        return one("SELECT * FROM licenses WHERE id = ?", (license_id,))

    def sign_bound_license(license_row: sqlite3.Row, device_id: str) -> str:
        payload = {
            "v": 1,
            "kid": license_row["kid"],
            "plan": "pro",
            "lic": license_row["id"],
            "dev": device_id,
            "order": license_row["order_id"],
            "iat": now_ts(),
            "exp": license_row["expires_at"],
            "upd": license_row["update_until"],
            "feat": ["pro"],
            "trial": bool(license_row["trial"]),
        }
        return signer.sign(payload)

    def activation_payload(license_row: sqlite3.Row, device_id: str) -> dict[str, Any]:
        count = one(
            "SELECT COUNT(*) AS total FROM devices WHERE license_id = ?",
            (license_row["id"],),
        )["total"]
        return {
            "token": sign_bound_license(license_row, device_id),
            "code": license_row["code"],
            "plan": "pro",
            "expiresAt": license_row["expires_at"],
            "devicesUsed": count,
            "devicesMax": license_row["max_devices"],
        }

    def license_by_code(code: str, signer_obj: TokenSigner) -> sqlite3.Row | None:
        payload = signer_obj.verify(code)
        if not payload or payload.get("dev") is not None:
            return None
        return one("SELECT * FROM licenses WHERE code = ?", (code,))

    def wrap_mobile_html(title: str, extra: str) -> str:
        return f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<style>body{{font-family:-apple-system,"PingFang SC",sans-serif;margin:0;background:#f6f6f6;
display:grid;place-items:center;min-height:100vh;color:#111}}main{{padding:28px;text-align:center}}
h1{{font-size:18px;margin:0 0 10px}}p{{color:#666;font-size:14px}}button{{margin-top:20px;height:42px;
padding:0 20px;border:0;border-radius:10px;background:#111;color:#fff;font-size:15px}}</style></head>
<body><main><h1>{html.escape(title)}</h1>{extra}</main></body></html>"""

    def pay_result_page(order: sqlite3.Row) -> str:
        if order["status"] == "paid":
            return wrap_mobile_html("支付成功", "<p>请回到 Pixmint，授权正在自动生效。</p>")
        return wrap_mobile_html("订单状态", f"<p>当前状态：{html.escape(order['status'])}</p>")

    return app


def send_email(app: Flask, email: str, license_row: sqlite3.Row) -> None:
    message = EmailMessage()
    message["Subject"] = "Pixmint Pro 激活码"
    message["From"] = app.config["smtp_from"]
    message["To"] = email
    message.set_content(
        "感谢购买 Pixmint Pro！\n\n"
        f"激活码：\n{license_row['code']}\n\n"
        f"订单号：{license_row['order_id'] or '试用授权'}\n"
        "换电脑时在应用内输入这个激活码即可，一个激活码最多绑定 3 台设备。\n"
    )
    port = app.config["smtp_port"]
    if port == 465:
        server = smtplib.SMTP_SSL(app.config["smtp_host"], port, timeout=15)
    else:
        server = smtplib.SMTP(app.config["smtp_host"], port, timeout=15)
        server.starttls()
    try:
        if app.config["smtp_user"]:
            server.login(app.config["smtp_user"], app.config["smtp_password"])
        server.send_message(message)
    finally:
        server.quit()


app = create_app()
