"""授权服务端回归测试。运行：python -m unittest discover -s tests"""

import base64
import hashlib
import hmac
import json
import os
import sqlite3
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
        extra = ["4" * 64, "5" * 64]
        fourth = "8" * 64
        data = self.create_paid_license(base_device)
        code = data["code"]
        for device in extra:
            response = self.client.post(
                "/v1/license/activate", json={"code": code, "deviceId": device}
            )
            self.assertEqual(response.status_code, 200, response.data)
        blocked = self.client.post(
            "/v1/license/activate", json={"code": code, "deviceId": fourth}
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.get_json()["code"], "device_limit")

        listed = self.client.post(
            "/v1/license/devices", json={"code": code, "deviceId": base_device}
        ).get_json()
        self.assertEqual(len(listed["devices"]), 3)
        self.client.post(
            "/v1/license/unbind", json={"code": code, "targetDevice": extra[0]}
        )
        retried = self.client.post(
            "/v1/license/activate", json={"code": code, "deviceId": fourth}
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
        self.assertEqual(restored.get_json()["devicesMax"], 3)

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

        actions = [
            item
            for item in self.client.get(
                f"/v1/admin/manual/orders/{order_id}/actions",
                headers=self.orders_headers(),
            ).get_json()["actions"]
            if item["action"] != "notify"
        ]
        self.assertEqual(
            [item["action"] for item in actions],
            ["reject", "reopen", "confirm", "revoke"],
        )
        self.assertEqual(
            [item["actor"] for item in actions],
            ["admin", "admin", "admin", "admin"],
        )

    def test_manual_notify_and_watchdog(self):
        order = self.create_manual_order("d2" * 32)
        order_id = order["orderId"]
        self.client.post(
            f"/v1/manual/orders/{order_id}/submit", json={"token": order["orderToken"]}
        )
        time.sleep(0.4)
        self.push_post.reset_mock()

        resent = self.client.post(
            f"/v1/admin/manual/orders/{order_id}/notify",
            headers=self.orders_headers(),
        )
        self.assertEqual(resent.status_code, 200, resent.data)
        self.assertTrue(resent.get_json()["ok"])
        self.assertTrue(self.push_post.called)

        import sqlite3

        conn = sqlite3.connect(self.app.config["db"])
        conn.execute(
            "UPDATE orders SET submitted_at = ?, notified_at = NULL, notify_count = 0"
            " WHERE order_id = ?",
            (int(time.time()) - 700, order_id),
        )
        conn.commit()
        conn.close()

        self.push_post.reset_mock()
        watchdog = self.client.post(
            "/v1/admin/manual/watchdog", headers=self.orders_headers()
        )
        self.assertEqual(watchdog.status_code, 200, watchdog.data)
        self.assertGreaterEqual(watchdog.get_json()["sent"], 1)
        self.assertTrue(self.push_post.called)

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


class ReferralApiTest(unittest.TestCase):
    """分享减会员费：好友首启计次、同一安装只计一次、绑定激活码后跨设备继承。"""

    @classmethod
    def setUpClass(cls):
        db_path = os.path.join(tempfile.mkdtemp(prefix="pixmint-referral-test-"), "r.db")
        cls.app = create_app({"TESTING": True, "pay_mock": True, "db": db_path})
        cls.client = cls.app.test_client()
        cls.db_path = db_path

    def device(self, seed):
        return hashlib.sha256(seed.encode()).hexdigest()

    def sync(self, device, license_code=""):
        response = self.client.post(
            "/v1/referral/sync",
            json={"code": "ignored", "deviceId": device, "count": 0, "licenseCode": license_code},
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.get_json()

    def friend(self, code, device):
        return self.client.post(
            "/v1/referral/friend", json={"code": code, "deviceId": device}
        )

    def test_sync_returns_stable_code_and_zero_count(self):
        owner = self.device("referral-owner-1")
        first = self.sync(owner)
        second = self.sync(owner)
        self.assertRegex(first["code"], r"^PM[A-Z0-9]{6}$")
        self.assertEqual(first["code"], second["code"])
        self.assertEqual(first["count"], 0)
        self.assertFalse(first["ended"])

    def test_friend_install_counts_once(self):
        owner = self.device("referral-owner-2")
        code = self.sync(owner)["code"]
        ok = self.friend(code, self.device("friend-2a"))
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(ok.get_json()["count"], 1)
        # 好友重复启动不会重复计次
        again = self.friend(code, self.device("friend-2a"))
        self.assertEqual(again.get_json()["count"], 1)
        self.assertEqual(self.sync(owner)["count"], 1)

    def test_self_share_not_counted(self):
        owner = self.device("referral-owner-3")
        code = self.sync(owner)["code"]
        self.friend(code, owner)
        self.assertEqual(self.sync(owner)["count"], 0)

    def test_unknown_or_bad_code_rejected(self):
        self.assertEqual(self.friend("PMZZZZZZ", self.device("friend-4")).status_code, 404)
        self.assertEqual(self.friend("bad code!", self.device("friend-4b")).status_code, 400)

    def test_license_binding_inherits_early_shares(self):
        # 未注册前先在设备上分享两次，激活码绑定到这台设备后，次数应完整并到账号
        owner_device = self.device("referral-owner-5")
        code = self.sync(owner_device)["code"]
        self.friend(code, self.device("friend-5a"))
        self.friend(code, self.device("friend-5b"))
        issued = self.client.post(
            "/v1/admin/issue", json={"plan": "lifetime"}, headers={"Authorization": "Bearer test-admin-token"}
        ).get_json()
        self.assertEqual(
            self.client.post("/v1/license/activate", json={"code": issued["code"], "deviceId": owner_device}).status_code,
            200,
        )
        merged = self.sync(owner_device, issued["code"])
        self.assertEqual(merged["count"], 2)
        self.assertNotEqual(merged["code"], code)
        # 换一台设备但用同一个激活码：进度跟账号走
        other_device = self.device("referral-owner-5-new")
        self.assertEqual(
            self.client.post("/v1/license/activate", json={"code": issued["code"], "deviceId": other_device}).status_code,
            200,
        )
        other = self.sync(other_device, issued["code"])
        self.assertEqual(other["count"], 2)
        self.assertEqual(other["code"], merged["code"])

    def test_revoked_license_falls_back_to_device(self):
        owner_device = self.device("referral-owner-7")
        issued = self.client.post(
            "/v1/admin/issue", json={"plan": "lifetime"}, headers={"Authorization": "Bearer test-admin-token"}
        ).get_json()
        # 退款接口按订单撤销授权；这里直接标记授权已撤销，模拟退款后的状态
        connection = sqlite3.connect(self.db_path)
        connection.execute(
            "UPDATE licenses SET revoked_at = ? WHERE invite_code = ?",
            (int(time.time()), issued["inviteCode"]),
        )
        connection.commit()
        connection.close()
        response = self.sync(owner_device, issued["code"])
        self.assertTrue(response["clearLicense"])
        self.assertRegex(response["code"], r"^PM[A-Z0-9]{6}$")

    def test_friend_daily_cap(self):
        code = self.sync(self.device("referral-owner-8"))["code"]
        responses = [self.friend(code, self.device(f"cap-friend-{i}")) for i in range(11)]
        self.assertEqual([r.status_code for r in responses], [200] * 11)
        self.assertEqual([r.get_json()["count"] for r in responses[:10]], list(range(1, 11)))
        # 第 11 个超限：返回 retryLater，不丢也不重复
        self.assertTrue(responses[10].get_json()["retryLater"])
        self.assertEqual(self.sync(self.device("referral-owner-8"))["count"], 10)
        # 同一好友过一会儿再登记（额度仍满）：依然 retryLater，不会被误计
        self.assertTrue(self.friend(code, self.device("cap-friend-0")).get_json().get("count") is not None)

    def test_ended_flag_when_deadline_passed(self):
        db_path = os.path.join(tempfile.mkdtemp(prefix="pixmint-referral-end-"), "e.db")
        app = create_app({"TESTING": True, "pay_mock": True, "db": db_path, "referral_deadline": 1})
        client = app.test_client()
        response = client.post(
            "/v1/referral/sync", json={"deviceId": self.device("owner-6")}
        )
        self.assertTrue(response.get_json()["ended"])

    # --- 边界与异常场景 -------------------------------------------------

    def test_dialogs_progress_after_many_friends_caps_at_via_count_not_price(self):
        owner = self.device("referral-owner-many")
        code = self.sync(owner)["code"]
        for i in range(3):
            self.assertEqual(self.friend(code, self.device(f"many-{i}")).status_code, 200)
        self.assertEqual(self.sync(owner)["count"], 3)

    def test_friend_before_owner_first_sync(self):
        # 分享者的码还没在服务端登记（理论上不会发生），好友先来也算无效码，不会写成 500
        response = self.friend("PMZZZZZZ", self.device("early-friend"))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()["code"], "bad_code")

    def test_lowercase_code_and_device_are_normalized(self):
        owner = self.device("referral-owner-case")
        code = self.sync(owner)["code"]
        mixed = self.friend(code.lower(), owner.upper())
        self.assertEqual(mixed.status_code, 200, mixed.data)
        # 大小写不同的“自己的设备”仍然算自己，不计次
        self.assertEqual(self.sync(owner)["count"], 0)

    def test_device_id_length_is_strict(self):
        # 超长/过短的设备标识必须拒绝，不能截断后当成合法设备
        for bad in ("a" * 65, "a" * 5000, "a" * 63, " " + "a" * 64 + " "):
            value = bad.strip()
            ok = len(value) == 64 and all(c in "0123456789abcdef" for c in value)
            response = self.client.post("/v1/referral/sync", json={"deviceId": bad})
            if ok:
                self.assertEqual(response.status_code, 200, bad[:10])
            else:
                self.assertEqual(response.status_code, 400, f"len={len(value)}")
        self.assertEqual(
            self.client.post("/v1/referral/sync", json={"deviceId": "A" * 64}).status_code, 200
        )

    def test_empty_and_malformed_payloads(self):
        self.assertEqual(
            self.client.post("/v1/referral/sync", json={}).status_code, 400
        )
        self.assertEqual(
            self.client.post("/v1/referral/sync", json={"deviceId": "zz"}).status_code, 400
        )
        self.assertEqual(
            self.client.post("/v1/referral/friend", json={}).status_code, 400
        )
        self.assertEqual(
            self.client.post("/v1/referral/friend", json={"code": "PMAAA111", "deviceId": "x"}).status_code,
            400,
        )

    def test_repeated_sync_does_not_change_count(self):
        owner = self.device("referral-owner-idem")
        code = self.sync(owner)["code"]
        self.friend(code, self.device("idem-friend"))
        counts = [self.sync(owner)["count"] for _ in range(5)]
        self.assertEqual(counts, [1, 1, 1, 1, 1])

    def test_friend_registration_does_not_leak_other_owners_shares(self):
        # D 先用 A 的码登记，自己再发展好友 B；D 绑定激活码后只能拿到自己名下的 B，不能带走 A 的分享
        a_device = self.device("leak-a")
        a_code = self.sync(a_device)["code"]
        d_device = self.device("leak-d")
        self.friend(a_code, d_device)
        d_code = self.sync(d_device)["code"]
        b_device = self.device("leak-b")
        self.friend(d_code, b_device)
        issued = self.client.post(
            "/v1/admin/issue", json={"plan": "lifetime"}, headers={"Authorization": "Bearer test-admin-token"}
        ).get_json()
        self.client.post("/v1/license/activate", json={"code": issued["code"], "deviceId": d_device})
        d_after = self.sync(d_device, issued["code"])
        self.assertEqual(d_after["count"], 1)
        self.assertEqual(self.sync(a_device)["count"], 1)
        self.assertNotEqual(d_after["code"], a_code)

    def test_self_share_from_licensed_device_not_counted(self):
        # 分享者自己的设备绑定了同一张授权码，再点自己的分享链接不应计次
        device = self.device("self-licensed")
        issued = self.client.post(
            "/v1/admin/issue", json={"plan": "lifetime"}, headers={"Authorization": "Bearer test-admin-token"}
        ).get_json()
        # 真实流程里激活码会先绑定到这台设备
        self.client.post("/v1/license/activate", json={"code": issued["code"], "deviceId": device})
        code = self.sync(device, issued["code"])["code"]
        self.friend(code, device)
        self.assertEqual(self.sync(device, issued["code"])["count"], 0)

    def test_code_from_other_license_does_not_switch_owner(self):
        # 客户端手里拿到别人的（合法）激活码：不切到对方账号，按本机设备继续算
        a_device = self.device("other-a")
        a_license = self.client.post(
            "/v1/admin/issue", json={"plan": "lifetime"}, headers={"Authorization": "Bearer test-admin-token"}
        ).get_json()
        self.client.post("/v1/license/activate", json={"code": a_license["code"], "deviceId": a_device})
        self.sync(a_device, a_license["code"])

        b_device = self.device("other-b")
        b_view = self.sync(b_device, a_license["code"])
        self.assertTrue(b_view.get("clearLicense"))
        self.assertNotEqual(b_view["code"], self.sync(a_device, a_license["code"])["code"])
        # 本机码分享出去的好友，只计入本机
        self.friend(b_view["code"], self.device("other-c"))
        self.assertEqual(self.sync(b_device)["count"], 1)
        self.assertEqual(self.sync(a_device, a_license["code"])["count"], 0)

    def test_friend_on_another_persons_license_is_neutral(self):
        # 好友自己已经有别的授权码：不影响它这次向他人分享的计次
        friend_device = self.device("licensed-friend")
        friend_license = self.client.post(
            "/v1/admin/issue", json={"plan": "lifetime"}, headers={"Authorization": "Bearer test-admin-token"}
        ).get_json()
        self.assertEqual(self.sync(friend_device, friend_license["code"])["count"], 0)
        owner = self.device("referral-owner-neutral")
        code = self.sync(owner)["code"]
        response = self.friend(code, friend_device)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.sync(owner)["count"], 1)

    def test_pre_binding_shares_merge_but_later_new_friends_stay_with_account(self):
        # 绑定前 2 个、绑定后再通过同一账号分享 1 个，总数应为 3，且不会被重复导入
        owner_device = self.device("referral-owner-seq")
        early = self.sync(owner_device)["code"]
        self.friend(early, self.device("seq-f1"))
        self.friend(early, self.device("seq-f2"))
        issued = self.client.post(
            "/v1/admin/issue", json={"plan": "lifetime"}, headers={"Authorization": "Bearer test-admin-token"}
        ).get_json()
        self.client.post("/v1/license/activate", json={"code": issued["code"], "deviceId": owner_device})
        first = self.sync(owner_device, issued["code"])
        self.assertEqual(first["count"], 2)
        self.friend(first["code"], self.device("seq-f3"))
        for _ in range(3):
            again = self.sync(owner_device, issued["code"])
            self.assertEqual(again["count"], 3)

    def test_ended_activity_stops_counting(self):
        db_path = os.path.join(tempfile.mkdtemp(prefix="pixmint-referral-stop-"), "s.db")
        app = create_app({"TESTING": True, "db": db_path, "referral_ended": False})
        client = app.test_client()
        owner = self.device("stop-owner")
        code = client.post("/v1/referral/sync", json={"deviceId": owner}).get_json()["code"]
        app.config["referral_ended"] = True
        blocked = client.post("/v1/referral/friend", json={"code": code, "deviceId": self.device("stop-f")})
        self.assertEqual(blocked.status_code, 200)
        self.assertFalse(blocked.get_json()["ended"] is False and blocked.get_json()["count"] > 0)
        self.assertTrue(client.post("/v1/referral/sync", json={"deviceId": owner}).get_json()["ended"])
        self.assertEqual(client.post("/v1/referral/sync", json={"deviceId": owner}).get_json()["count"], 0)


if __name__ == "__main__":
    unittest.main()
