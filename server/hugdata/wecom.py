#!/usr/bin/env python3
"""
企业微信应用消息发送（数据台唯一出口）
背景：Pixmint / VidGrab 各自用一个授权服务，如果各自缓存 access_token
      并各自续期，同一 secret 会把对方的 token 顶掉，偶发通知失败。
设计意图：把 token 管理收敛到数据台这一处，各授权服务通过数据台发通知。
关键约束：只用标准库 urllib（数据台 venv 不保证有 requests）；未配置时返回 False。
"""
import json
import threading
import time
import urllib.parse
import urllib.request

_token_lock = threading.Lock()
_token_cache = {"value": "", "expires_at": 0.0}

API = "https://qyapi.weixin.qq.com/cgi-bin"


def _post(url: str, body: dict, timeout: int = 10) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


def access_token(corp_id: str, secret: str, logger=None) -> str:
    """走缓存取 access_token，提前 60 秒刷新。"""
    if not corp_id or not secret:
        return ""
    now = time.time()
    with _token_lock:
        if _token_cache["value"] and _token_cache["expires_at"] > now + 60:
            return str(_token_cache["value"])
        query = urllib.parse.urlencode({"corpid": corp_id, "corpsecret": secret})
        try:
            with urllib.request.urlopen(f"{API}/gettoken?{query}", timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8") or "{}")
            if data.get("errcode") != 0 or not data.get("access_token"):
                if logger:
                    logger.warning("wecom gettoken failed: %s", data)
                return ""
            _token_cache["value"] = data["access_token"]
            _token_cache["expires_at"] = now + int(data.get("expires_in", 7200))
            return str(data["access_token"])
        except Exception as exc:  # noqa: BLE001
            if logger:
                logger.warning("wecom gettoken error: %s", exc)
            return ""


def send_markdown(content: str, corp_id: str, secret: str, agent_id: str, logger=None) -> bool:
    """给 @all 发 markdown 消息。返回是否成功。"""
    token = access_token(corp_id, secret, logger)
    agent_id = str(agent_id or "").strip()
    if not token or not agent_id.isdigit():
        if logger:
            logger.warning("wecom not configured properly; skip")
        return False
    try:
        query = urllib.parse.urlencode({"access_token": token})
        data = _post(
            f"{API}/message/send?{query}",
            {
                "touser": "@all",
                "msgtype": "markdown",
                "agentid": int(agent_id),
                "markdown": {"content": content},
            },
        )
        if data.get("errcode") == 0:
            return True
        if logger:
            logger.warning("wecom send failed: %s", data)
        return False
    except Exception as exc:  # noqa: BLE001
        if logger:
            logger.warning("wecom send error: %s", exc)
        return False
