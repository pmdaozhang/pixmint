"""授权服务端回归测试。运行：python -m unittest discover -s tests"""

import base64
import json
import os
import tempfile
import unittest

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
        cls.app = create_app({"TESTING": True, "pay_mock": True})
        cls.client = cls.app.test_client()

    def admin_headers(self):
        return {"Authorization": "Bearer test-admin-token"}

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
        extra_one, extra_two, fourth = "4" * 64, "5" * 64, "6" * 64
        data = self.create_paid_license(base_device)
        code = data["code"]
        for device in (extra_one, extra_two):
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
            "/v1/license/unbind", json={"code": code, "targetDevice": extra_one}
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

    def test_unknown_code_rejected(self):
        response = self.client.post(
            "/v1/license/activate", json={"code": "forged", "deviceId": DEVICE_A}
        )
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
