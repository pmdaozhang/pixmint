"""数据台 VidGrab 通知中转接口的安全边界测试。运行：python -m unittest discover -s tests"""

import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

TMP = tempfile.mkdtemp(prefix="hugdata-notify-test-")
os.environ["HUGDATA_DB"] = os.path.join(TMP, "data.db")
os.environ["HUGDATA_ATTACH_DIR"] = os.path.join(TMP, "att")
os.environ["HUGDATA_SECRET"] = "test-secret"
os.environ["HUGDATA_ADMIN_HASH"] = "scrypt:32768:8:1$dummy$dummy"
os.environ["VIDGRAB_ORDERS_TOKEN"] = "vg-token"
os.environ["HUGDATA_WECOM_CORP_ID"] = "ww-test"
os.environ["HUGDATA_WECOM_AGENT_ID"] = "1000002"
os.environ["HUGDATA_WECOM_SECRET"] = "secret"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as app_module  # noqa: E402

ORDER = "VG261119-TEST"
PATH = f"/api/internal/vidgrab/notify/{ORDER}"


def _orders_payload(order_id=ORDER, status="reviewing", cents=5800):
    return {
        "orders": [
            {
                "orderId": order_id,
                "status": status,
                "amountCents": cents,
                "plan": "lifetime",
            }
        ]
    }


ORDER_OK = _orders_payload()["orders"][0]
ORDER_PAID = _orders_payload(status="paid")["orders"][0]


class VidgrabNotifyTest(unittest.TestCase):
    def setUp(self):
        self.client = app_module.app.test_client()
        self.client.environ_base["REMOTE_ADDR"] = "127.0.0.1"

    def _call(self, headers=None, addr="127.0.0.1", body=None):
        return self.client.post(
            PATH,
            json=body or {},
            headers=headers if headers is not None else {"Authorization": "Bearer vg-token"},
            environ_overrides={"REMOTE_ADDR": addr},
        )

    def test_success_sends_markdown_with_real_amount(self):
        """正文按订单真实金额生成，忽略调用方传的任何内容（防伪造）。"""
        with patch.object(app_module, "_vidgrab_order_lookup", return_value=(ORDER_OK, None)), patch.object(
            app_module.wecom, "send_markdown", return_value=True
        ) as sent:
            res = self._call(body={"content": "## 假的正文 ¥0.01"})
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.get_json()["ok"])
        content = sent.call_args[0][0]
        self.assertIn("VidGrab 新订单待确认", content)
        self.assertIn(ORDER, content)
        self.assertIn("¥58.00", content)
        self.assertNotIn("假的正文", content)

    def test_reject_non_loopback(self):
        with patch.object(app_module.wecom, "send_markdown") as sent:
            res = self._call(addr="203.0.113.9")
        self.assertEqual(res.status_code, 403)
        sent.assert_not_called()

    def test_reject_wrong_token(self):
        with patch.object(app_module, "_vidgrab_order_lookup") as orders:
            res = self._call(headers={"Authorization": "Bearer nope"})
        self.assertEqual(res.status_code, 401)
        orders.assert_not_called()

    def test_reject_invalid_order_id(self):
        with self.client.post("/api/internal/vidgrab/notify/..%2Fetc", headers={"Authorization": "Bearer vg-token"}) as res:
            self.assertIn(res.status_code, (400, 404))

    def test_reject_already_paid(self):
        with patch.object(
            app_module, "_vidgrab_order_lookup", return_value=(ORDER_PAID, None)
        ), patch.object(app_module.wecom, "send_markdown") as sent:
            res = self._call()
        self.assertEqual(res.status_code, 409)
        sent.assert_not_called()

    def test_reject_unknown_order(self):
        with patch.object(
            app_module, "_vidgrab_order_lookup", return_value=(None, None)
        ), patch.object(app_module.wecom, "send_markdown") as sent:
            res = self._call()
        self.assertEqual(res.status_code, 409)
        sent.assert_not_called()

    def test_wecom_failure_returns_502(self):
        with patch.object(
            app_module, "_vidgrab_order_lookup", return_value=(ORDER_OK, None)
        ), patch.object(app_module.wecom, "send_markdown", return_value=False):
            res = self._call()
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.get_json()["error"], "wecom_failed")


class WecomModuleTest(unittest.TestCase):
    def test_missing_config_returns_false(self):
        self.assertFalse(app_module.wecom.send_markdown("x", "", "", ""))

    def test_agent_id_must_be_numeric(self):
        with patch.object(app_module.wecom, "access_token", return_value="t"):
            self.assertFalse(app_module.wecom.send_markdown("x", "ww", "s", "abc"))


if __name__ == "__main__":
    unittest.main()
