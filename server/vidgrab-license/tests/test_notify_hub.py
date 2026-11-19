"""VidGrab 新订单通知：先走数据台中枢，失败再回落本地渠道。运行：python -m unittest discover -s tests"""

import io
import json
import os
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

TMP = tempfile.mkdtemp(prefix="vidgrab-notify-test-")
KEY_PATH = os.path.join(TMP, "ed25519.key")
with open(KEY_PATH, "wb") as handle:
    handle.write(
        Ed25519PrivateKey.generate().private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )

os.environ.setdefault("PIXMINT_LICENSE_KEY", KEY_PATH)
os.environ.setdefault("PIXMINT_LICENSE_DB", os.path.join(TMP, "license.db"))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as app_module  # noqa: E402


class FakeNet:
    """中枢走 urllib，本地企微/PushPlus 走 requests；分别记账。"""

    def __init__(self, hub_ok=True):
        self.hub_ok = hub_ok
        self.hub_calls = []
        self.other_calls = []

    # urllib
    def urlopen(self, req, timeout=10):
        url = getattr(req, "full_url", str(req))
        if "/api/internal/vidgrab/notify/" in url:
            self.hub_calls.append(url)
            body = {"ok": self.hub_ok, "error": None if self.hub_ok else "wecom_failed"}
            return io.BytesIO(json.dumps(body).encode())
        self.other_calls.append(url)
        return io.BytesIO(b"{}")

    # requests
    class _Resp:
        ok = True
        status_code = 200

        def __init__(self, payload):
            self._payload = payload

        def json(self):
            return self._payload

    def get(self, url, *a, **kw):
        self.other_calls.append(url)
        return self._Resp({"errcode": 0, "access_token": "t", "expires_in": 7200})

    def post(self, url, *a, **kw):
        self.other_calls.append(url)
        return self._Resp({"errcode": 0, "code": 200})


class NotifyHubTest(unittest.TestCase):
    def setUp(self):
        self.app = app_module.create_app(
            {
                "TESTING": True,
                "pay_mock": True,
                "action_secret": "test-action-secret",
                "pushplus_token": "test-pushplus",
                "pushplus_url": "https://pushplus.invalid/send",
                "wecom_corp_id": "",
                "notify_hub_url": "http://127.0.0.1:8100/api/internal/vidgrab/notify",
                "notify_hub_token": "hub-token",
            }
        )
        self.client = self.app.test_client()

    def _submit_order(self, suffix):
        created = self.client.post(
            "/v1/manual/orders",
            json={"plan": "lifetime", "provider": "alipay", "deviceId": suffix * 64},
        )
        self.assertEqual(created.status_code, 200, created.data)
        order = created.get_json()
        submitted = self.client.post(
            f"/v1/manual/orders/{order['orderId']}/submit",
            json={"token": order["orderToken"]},
        )
        self.assertEqual(submitted.status_code, 200, submitted.data)
        return order

    def _wait(self, cond):
        for _ in range(100):
            if cond():
                return True
            time.sleep(0.02)
        return False

    def test_hub_success_skips_local_channels(self):
        net = FakeNet(hub_ok=True)
        with patch("app.urllib.request.urlopen", side_effect=net.urlopen), patch(
            "app.requests.get", side_effect=net.get
        ), patch("app.requests.post", side_effect=net.post):
            order = self._submit_order("a")
            self.assertTrue(self._wait(lambda: net.hub_calls), "应调用数据台中枢")
        self.assertIn(order["orderId"], net.hub_calls[0])
        self.assertEqual(net.other_calls, [], "中枢成功后不应再走企微/PushPlus")

    def test_hub_failure_falls_back_to_local(self):
        net = FakeNet(hub_ok=False)
        with patch("app.urllib.request.urlopen", side_effect=net.urlopen), patch(
            "app.requests.get", side_effect=net.get
        ), patch("app.requests.post", side_effect=net.post):
            self._submit_order("b")
            self.assertTrue(
                self._wait(lambda: any("pushplus" in u or "qyapi" in u for u in net.other_calls)),
                "中枢失败后应回落本地渠道",
            )

    def test_hub_skipped_without_token(self):
        self.app.config["notify_hub_token"] = ""
        net = FakeNet(hub_ok=True)
        with patch("app.urllib.request.urlopen", side_effect=net.urlopen), patch(
            "app.requests.get", side_effect=net.get
        ), patch("app.requests.post", side_effect=net.post):
            self._submit_order("c")
            self._wait(lambda: bool(net.other_calls))
        self.assertEqual(net.hub_calls, [], "没有中枢凭证时不应调用中枢")


if __name__ == "__main__":
    unittest.main()
