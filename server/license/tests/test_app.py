"""授权服务端回归测试。运行：python -m unittest discover -s tests"""

import base64
import hashlib
import hmac
import json
import os
import tempfile
import time
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

TMP = tempfile.mkdtemp(prefix="pixmint-license-test-")
KEY_PATH = os.path.join(TMP, "ed25519.key")
with open(KEY_PATH, "wb") as handle:
    handle.write(
        Ed25519PrivateKey.generate()
        .private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )

os.environ["PIXMINT_LICENSE_KEY"] = KEY_PATH
os.environ["PIXMINT_LICENSE_DB"] = os.path.join(TMP, "license.db")
os.environ["PIXMINT_PAY_MOCK"] = "1"
os.environ["PIXMINT_ADMIN_TOKEN"] = "test-admin-token"

from app import create_app  # noqa: E402

DEVICE_A = "a" * 64
DEVICE_B = "b" * 64
DEVICE_C = "c" * 64
DEVICE_D = "d" * 64
DEVICE_E = "e" * 64


class LicenseApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = create_app(
            {
                "TESTING": True,
                "pay_mock": True,
                "orders_token": "test-orders-token",
                "pushplus_token": "test-pushplus-token",
                "pushplus_url": "https://pushplus.invalid/send",
                "action_secret": "test-action-secret",
            }
        )
        cls.client = cls.app.test_client()

    def setUp(self):
        class FakeResponse:
            ok = True
            status_code = 200

            def json(self):
                return {"code": 200}

        patcher = patch("app.requests.post", return_value=FakeResponse())
        self.push_post = patcher.start()
        self.addCleanup(patcher.stop)

    def mobile_token(self, order_id, ttl=300):
        exp = int(time.time()) + ttl
        sig = hmac.new(
            b"test-action-secret", f"{order_id}|{exp}".encode(), hashlib.sha256
        ).hexdigest()
        return f"{exp}.{sig}"

    def admin_headers(self):
        return {"Authorization": "Bearer test-admin-token"}

    def orders_headers(self):
        return {"Authorization": "Bearer test-orders-token"}

    def create_paid_license(self, device_id=DEVICE_A):
        created = self.client.post(
            "/v1/pay/orders",
            json={"plan": "lifetime", "provider": "alipay", "deviceId": device_id},
        )
        self.assertEqual(created.status_code, 200, created.data)
        order = created.get_json()
        completed = self.client.post(
            "/v1/pay/mock/complete", json={"orderId": order["orderId"]}
        )
        self.assertEqual(completed.status_code, 200, completed.data)
        status = self.client.get(
            f"/v1/pay/orders/{order['orderId']}?token={order['orderToken']}"
        )
        self.assertEqual(status.status_code, 200, status.data)
        data = status.get_json()
        self.assertEqual(data["status"], "paid")
        return data

    def test_purchase_auto_activation(self):
        device = "1" * 64
        data = self.create_paid_license(device)
        self.assertTrue(data["code"])
        part = data["token"].split(".")[0]
        payload = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        self.assertEqual(payload["dev"], device)

    def test_device_limit_and_unbind(self):
        base_device = "3" * 64
        extra = ["4" * 64, "5" * 64, "6" * 64, "7" * 64]
        sixth = "8" * 64
        data = self.create_paid_license(base_device)
        code = data["code"]
        for device in extra:
            response = self.client.post(
                "/v1/license/activate", json={"code": code, "deviceId": device}
            )
            self.assertEqual(response.status_code, 200, response.data)
        blocked = self.client.post(
            "/v1/license/activate", json={"code": code, "deviceId": sixth}
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.get_json()["code"], "device_limit")

        listed = self.client.post(
            "/v1/license/devices", json={"code": code, "deviceId": base_device}
        ).get_json()
        self.assertEqual(len(listed["devices"]), 5)
        self.client.post(
            "/v1/license/unbind", json={"code": code, "targetDevice": extra[0]}
        )
        retried = self.client.post(
            "/v1/license/activate", json={"code": code, "deviceId": sixth}
        )
        self.assertEqual(retried.status_code, 200, retried.data)

    def test_refresh_and_by_device(self):
        device = "2" * 64
        data = self.create_paid_license(device)
        refreshed = self.client.post(
            "/v1/license/refresh", json={"token": data["token"], "deviceId": device}
        )
        self.assertEqual(refreshed.status_code, 200, refreshed.data)
        self.assertTrue(refreshed.get_json()["token"])
        restored = self.client.post("/v1/license/by-device", json={"deviceId": device})
        self.assertEqual(restored.status_code, 200, restored.data)
        self.assertEqual(restored.get_json()["code"], data["code"])

    def test_refund_revokes(self):
        device = "f" * 64
        data = self.create_paid_license(device)
        orders = self.client.get("/v1/admin/orders", headers=self.admin_headers()).get_json()[
            "orders"
        ]
        target = next(
            order
            for order in orders
            if order["device_id"] == device and order["status"] == "paid"
        )
        refunded = self.client.post(
            "/v1/admin/refund",
            json={"orderId": target["order_id"]},
            headers=self.admin_headers(),
        )
        self.assertEqual(refunded.status_code, 200, refunded.data)
        refreshed = self.client.post(
            "/v1/license/refresh", json={"token": data["token"], "deviceId": device}
        )
        self.assertEqual(refreshed.status_code, 410)

    def test_trial_and_invite_reward(self):
        owner = self.client.post(
            "/v1/admin/issue",
            json={"plan": "monthly"},
            headers=self.admin_headers(),
        ).get_json()
        invite = owner["inviteCode"]
        trial = self.client.post(
            "/v1/license/trial",
            json={"inviteCode": invite, "deviceId": DEVICE_E},
        )
        self.assertEqual(trial.status_code, 200, trial.data)
        self.assertIsNotNone(trial.get_json()["expiresAt"])
        again = self.client.post(
            "/v1/license/trial",
            json={"inviteCode": invite, "deviceId": DEVICE_E},
        )
        self.assertEqual(again.status_code, 409)

    def create_manual_order(self, device_id, provider="alipay"):
        response = self.client.post(
            "/v1/manual/orders",
            json={
                "plan": "lifetime",
                "provider": provider,
                "deviceId": device_id,
                "deviceName": "测试机",
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.get_json()

    def test_manual_order_flow_and_auto_activation(self):
        device = "9" * 64
        order = self.create_manual_order(device)
        self.assertEqual(order["status"], "pending_payment")
        self.assertEqual(order["amountCents"], 5800)
        self.assertTrue(order["qrUrls"]["alipay"].endswith("/alipay.png"))
        order_id = order["orderId"]
        token = order["orderToken"]

        pending = self.client.get(f"/v1/manual/orders/{order_id}?token={token}")
        self.assertEqual(pending.status_code, 200, pending.data)
        self.assertEqual(pending.get_json()["status"], "pending_payment")

        submitted = self.client.post(
            f"/v1/manual/orders/{order_id}/submit", json={"token": token}
        )
        self.assertEqual(submitted.status_code, 200, submitted.data)
        self.assertEqual(submitted.get_json()["status"], "reviewing")

        listed = self.client.get(
            "/v1/admin/manual/orders?status=reviewing", headers=self.orders_headers()
        )
        self.assertEqual(listed.status_code, 200, listed.data)
        self.assertTrue(
            any(item["orderId"] == order_id for item in listed.get_json()["orders"])
        )

        confirmed = self.client.post(
            f"/v1/admin/manual/orders/{order_id}/confirm",
            headers=self.orders_headers(),
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.data)
        code = confirmed.get_json()["code"]
        self.assertTrue(code)

        paid = self.client.get(f"/v1/manual/orders/{order_id}?token={token}")
        self.assertEqual(paid.status_code, 200, paid.data)
        paid_data = paid.get_json()
        self.assertEqual(paid_data["status"], "paid")
        self.assertEqual(paid_data["code"], code)
        self.assertTrue(paid_data["token"])

        restored = self.client.post("/v1/license/by-device", json={"deviceId": device})
        self.assertEqual(restored.status_code, 200, restored.data)
        self.assertEqual(restored.get_json()["code"], code)
        self.assertEqual(restored.get_json()["devicesMax"], 5)

        again = self.client.post(
            f"/v1/admin/manual/orders/{order_id}/confirm",
            headers=self.orders_headers(),
        )
        self.assertEqual(again.status_code, 200, again.data)
        self.assertEqual(again.get_json()["code"], code)

    def test_manual_order_reject_blocks_confirm(self):
        device = "ab" * 32
        order = self.create_manual_order(device)
        order_id = order["orderId"]
        token = order["orderToken"]
        self.client.post(f"/v1/manual/orders/{order_id}/submit", json={"token": token})
        rejected = self.client.post(
            f"/v1/admin/manual/orders/{order_id}/reject",
            json={"reason": "未查到对应金额"},
            headers=self.orders_headers(),
        )
        self.assertEqual(rejected.status_code, 200, rejected.data)
        status = self.client.get(f"/v1/manual/orders/{order_id}?token={token}").get_json()
        self.assertEqual(status["status"], "rejected")
        self.assertEqual(status["rejectReason"], "未查到对应金额")
        blocked = self.client.post(
            f"/v1/admin/manual/orders/{order_id}/confirm",
            headers=self.orders_headers(),
        )
        self.assertEqual(blocked.status_code, 409)

    def test_manual_order_without_email(self):
        response = self.client.post(
            "/v1/manual/orders",
            json={
                "plan": "monthly",
                "provider": "wechat",
                "deviceId": "cd" * 32,
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.get_json()["status"], "pending_payment")

    def test_pushplus_notify_and_mobile_confirm(self):
        order = self.create_manual_order("e1" * 32, provider="wechat")
        order_id = order["orderId"]
        order_token = order["orderToken"]

        submitted = self.client.post(
            f"/v1/manual/orders/{order_id}/submit", json={"token": order_token}
        )
        self.assertEqual(submitted.status_code, 200, submitted.data)

        for _ in range(100):
            if self.push_post.called:
                break
            time.sleep(0.02)
        self.assertTrue(self.push_post.called)
        payload = self.push_post.call_args.kwargs["json"]
        self.assertEqual(payload["token"], "test-pushplus-token")
        self.assertIn(order_id, payload["content"])
        self.assertIn("微信支付", payload["content"])
        self.assertIn(f"/pay/confirm/{order_id}", payload["content"])

        # 重复提交同一订单不应重复推送
        self.push_post.reset_mock()
        self.client.post(
            f"/v1/manual/orders/{order_id}/submit", json={"token": order_token}
        )
        time.sleep(0.3)
        self.assertFalse(self.push_post.called)

        mobile = self.mobile_token(order_id)
        page = self.client.get(f"/pay/confirm/{order_id}?t={mobile}")
        self.assertEqual(page.status_code, 200)
        self.assertIn(order_id.encode(), page.data)
        self.assertIn("微信支付".encode("utf-8"), page.data)
        self.assertIn("确认拒绝这笔订单？".encode("utf-8"), page.data)

        confirmed = self.client.post(
            f"/pay/confirm/{order_id}", data={"t": mobile, "action": "confirm"}
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.data)
        self.assertIn("已确认收款".encode("utf-8"), confirmed.data)

        status = self.client.get(
            f"/v1/manual/orders/{order_id}?token={order_token}"
        ).get_json()
        self.assertEqual(status["status"], "paid")
        self.assertTrue(status["code"])

        actions = self.client.get(
            f"/v1/admin/manual/orders/{order_id}/actions",
            headers=self.orders_headers(),
        ).get_json()["actions"]
        self.assertEqual(actions[-1]["action"], "confirm")
        self.assertEqual(actions[-1]["actor"], "phone")

    def test_reopen_revoke_and_action_log(self):
        order = self.create_manual_order("d1" * 32)
        order_id = order["orderId"]
        order_token = order["orderToken"]
        self.client.post(
            f"/v1/manual/orders/{order_id}/submit", json={"token": order_token}
        )

        rejected = self.client.post(
            f"/v1/admin/manual/orders/{order_id}/reject",
            json={"reason": "测试拒绝"},
            headers=self.orders_headers(),
        )
        self.assertEqual(rejected.status_code, 200, rejected.data)

        reopened = self.client.post(
            f"/v1/admin/manual/orders/{order_id}/reopen",
            headers=self.orders_headers(),
        )
        self.assertEqual(reopened.status_code, 200, reopened.data)
        status = self.client.get(
            f"/v1/manual/orders/{order_id}?token={order_token}"
        ).get_json()
        self.assertEqual(status["status"], "reviewing")

        confirmed = self.client.post(
            f"/v1/admin/manual/orders/{order_id}/confirm",
            headers=self.orders_headers(),
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.data)
        self.assertTrue(confirmed.get_json()["code"])

        revoked = self.client.post(
            f"/v1/admin/manual/orders/{order_id}/revoke",
            headers=self.orders_headers(),
        )
        self.assertEqual(revoked.status_code, 200, revoked.data)
        status = self.client.get(
            f"/v1/manual/orders/{order_id}?token={order_token}"
        ).get_json()
        self.assertEqual(status["status"], "refunded")

        actions = self.client.get(
            f"/v1/admin/manual/orders/{order_id}/actions",
            headers=self.orders_headers(),
        ).get_json()["actions"]
        self.assertEqual(
            [item["action"] for item in actions],
            ["reject", "reopen", "confirm", "revoke"],
        )
        self.assertEqual(
            [item["actor"] for item in actions],
            ["admin", "admin", "admin", "admin"],
        )

    def test_wecom_notify_priority(self):
        self.app.config.update(
            wecom_corp_id="ww-test-corp",
            wecom_agent_id="1000003",
            wecom_secret="test-wecom-secret",
        )
        self.addCleanup(
            lambda: self.app.config.update(
                wecom_corp_id="", wecom_agent_id="", wecom_secret=""
            )
        )

        class TokenResponse:
            ok = True
            status_code = 200

            def json(self):
                return {
                    "errcode": 0,
                    "access_token": "test-access-token",
                    "expires_in": 7200,
                }

        class SendResponse:
            ok = True
            status_code = 200

            def json(self):
                return {"errcode": 0, "errmsg": "ok"}

        order = self.create_manual_order("c1" * 32)
        order_id = order["orderId"]
        with patch("app.requests.get", return_value=TokenResponse()), patch(
            "app.requests.post", return_value=SendResponse()
        ) as post:
            self.client.post(
                f"/v1/manual/orders/{order_id}/submit",
                json={"token": order["orderToken"]},
            )
            for _ in range(100):
                if post.called:
                    break
                time.sleep(0.02)
            self.assertTrue(post.called)
            kwargs = post.call_args.kwargs
            self.assertEqual(kwargs["json"]["agentid"], 1000003)
            self.assertEqual(kwargs["json"]["touser"], "@all")
            self.assertIn("支付宝", kwargs["json"]["markdown"]["content"])
            self.assertIn(
                f"/pay/confirm/{order_id}", kwargs["json"]["markdown"]["content"]
            )
            self.assertEqual(kwargs["params"]["access_token"], "test-access-token")

    def test_mobile_confirm_rejects_bad_token(self):
        order = self.create_manual_order("e2" * 32)
        response = self.client.get(f"/pay/confirm/{order['orderId']}?t=1.deadbeef")
        self.assertEqual(response.status_code, 403)

    def test_mobile_reject(self):
        order = self.create_manual_order("e3" * 32)
        order_id = order["orderId"]
        self.client.post(
            f"/v1/manual/orders/{order_id}/submit", json={"token": order["orderToken"]}
        )
        mobile = self.mobile_token(order_id)

        rejected = self.client.post(
            f"/pay/confirm/{order_id}", data={"t": mobile, "action": "reject"}
        )
        self.assertEqual(rejected.status_code, 200, rejected.data)
        status = self.client.get(
            f"/v1/manual/orders/{order_id}?token={order['orderToken']}"
        ).get_json()
        self.assertEqual(status["status"], "rejected")

        blocked = self.client.post(
            f"/pay/confirm/{order_id}", data={"t": mobile, "action": "confirm"}
        )
        self.assertEqual(blocked.status_code, 409)

    def test_unknown_code_rejected(self):
        response = self.client.post(
            "/v1/license/activate", json={"code": "forged", "deviceId": DEVICE_A}
        )
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
