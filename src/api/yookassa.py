"""
YooKassa API v3 client (https://yookassa.ru/developers/api).

Только стандартная библиотека: urllib + Basic-авторизация shopId:secretKey.
"""

from __future__ import annotations

import base64
import ipaddress
import json
import os
import urllib.error
import urllib.request
import uuid
from typing import Any, Optional

API_URL = "https://api.yookassa.ru/v3"

# способ оплаты в мини-приложении → payment_method_data.type YooKassa
APP_METHOD_MAP: dict[str, str] = {
    "sbp": "sbp",
    "card": "bank_card",
    "sberpay": "sberbank",
}

# статусы платежа
STATUS_PENDING = "pending"
STATUS_WAITING = "waiting_for_capture"
STATUS_SUCCEEDED = "succeeded"
STATUS_CANCELED = "canceled"

# IP, с которых YooKassa шлёт уведомления (https://yookassa.ru/developers/using-api/webhooks)
NOTIFY_NETWORKS = [
    "185.71.76.0/27",
    "185.71.77.0/27",
    "77.75.153.0/25",
    "77.75.156.11/32",
    "77.75.156.35/32",
    "77.75.154.128/25",
    "2a02:5180::/32",
]


def _env(*keys: str, default: str = "") -> str:
    for key in keys:
        val = (os.getenv(key) or "").strip()
        if val:
            return val
    return default


def _money(value: float) -> str:
    return f"{round(float(value), 2):.2f}"


class YooKassaError(Exception):
    def __init__(self, message: str, *, status: Optional[int] = None, payload: Any = None):
        super().__init__(message)
        self.status = status
        self.payload = payload


class YooKassaClient:

    def __init__(
        self,
        shop_id: Optional[str] = None,
        secret_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        timeout: float = 30.0,
    ) -> None:
        self.base_url = (base_url or _env("YOOKASSA_API_URL", default=API_URL)).rstrip("/")
        self.shop_id = shop_id or _env("YOOKASSA_SHOP_ID")
        self.secret_key = secret_key or _env("YOOKASSA_SECRET_KEY")
        self.timeout = timeout

    def is_configured(self) -> bool:
        return bool(self.shop_id and self.secret_key)

    def _require_config(self) -> None:
        if not self.is_configured():
            raise YooKassaError("ЮKassa не настроена: задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY")

    def _headers(self, idempotence_key: Optional[str]) -> dict[str, str]:
        token = base64.b64encode(f"{self.shop_id}:{self.secret_key}".encode()).decode()
        h = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Basic {token}",
        }
        if idempotence_key:
            h["Idempotence-Key"] = idempotence_key
        return h

    def _request(self, method: str, path: str, body: Optional[dict[str, Any]] = None,
                 idempotence_key: Optional[str] = None) -> Any:
        self._require_config()
        if not path.startswith("/"):
            path = "/" + path
        url = f"{self.base_url}{path}"
        data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, headers=self._headers(idempotence_key), method=method.upper())
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
                if not raw:
                    return None
                try:
                    return json.loads(raw.decode("utf-8"))
                except json.JSONDecodeError:
                    return raw.decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
            try:
                payload = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                payload = raw
            msg = None
            if isinstance(payload, dict):
                msg = payload.get("description") or payload.get("code")
            raise YooKassaError(str(msg or raw or e.reason), status=e.code, payload=payload) from e
        except urllib.error.URLError as e:
            raise YooKassaError(f"Не удалось связаться с ЮKassa: {e.reason}") from e

    # ---- платежи ----

    def create_payment(
        self,
        *,
        amount: float,
        method: Optional[str] = None,
        description: Optional[str] = None,
        return_url: Optional[str] = None,
        payment_id: str,
        user_id: Optional[str] = None,
        receipt_email: Optional[str] = None,
        receipt_item: Optional[str] = None,
    ) -> dict[str, Any]:
        """Платёж с подтверждением через redirect; payment_id — наш id (metadata + ключ идемпотентности)."""
        body: dict[str, Any] = {
            "amount": {"value": _money(amount), "currency": "RUB"},
            "capture": True,
            "confirmation": {"type": "redirect", "return_url": return_url or _env("YOOKASSA_RETURN_URL") or "https://yookassa.ru"},
            "metadata": {"payment_id": str(payment_id)},
        }
        if user_id:
            body["metadata"]["user_id"] = str(user_id)
        if description:
            body["description"] = description[:128]
        pm_type = APP_METHOD_MAP.get(str(method or ""))
        if pm_type:
            body["payment_method_data"] = {"type": pm_type}
        receipt = self._receipt(amount, receipt_email, receipt_item or description)
        if receipt:
            body["receipt"] = receipt
        resp = self._request("POST", "/payments", body, idempotence_key=f"pay-{payment_id}")
        if not isinstance(resp, dict) or not resp.get("id"):
            raise YooKassaError("Некорректный ответ ЮKassa при создании платежа", payload=resp)
        return resp

    def get_payment(self, yk_payment_id: str) -> dict[str, Any]:
        resp = self._request("GET", f"/payments/{yk_payment_id}")
        if not isinstance(resp, dict):
            raise YooKassaError("Некорректный ответ ЮKassa при проверке статуса", payload=resp)
        return resp

    # ---- возвраты ----

    def create_refund(self, yk_payment_id: str, amount: float, *, key: Optional[str] = None,
                      receipt_email: Optional[str] = None, receipt_item: Optional[str] = None) -> dict[str, Any]:
        body: dict[str, Any] = {
            "payment_id": yk_payment_id,
            "amount": {"value": _money(amount), "currency": "RUB"},
        }
        receipt = self._receipt(amount, receipt_email, receipt_item)
        if receipt:
            body["receipt"] = receipt
        resp = self._request("POST", "/refunds", body, idempotence_key=key or f"refund-{yk_payment_id}-{uuid.uuid4().hex[:8]}")
        if not isinstance(resp, dict):
            raise YooKassaError("Некорректный ответ ЮKassa при возврате", payload=resp)
        return resp

    # ---- чеки 54-ФЗ (если включены в магазине) ----

    @staticmethod
    def receipts_enabled() -> bool:
        return _env("YOOKASSA_RECEIPT", default="0").lower() in ("1", "true", "yes", "on")

    def _receipt(self, amount: float, email: Optional[str], item: Optional[str]) -> Optional[dict[str, Any]]:
        if not self.receipts_enabled():
            return None
        contact = (email or "").strip() or _env("YOOKASSA_RECEIPT_EMAIL")
        if not contact:
            return None
        try:
            vat = int(_env("YOOKASSA_VAT_CODE", default="1"))  # 1 = без НДС
        except ValueError:
            vat = 1
        receipt: dict[str, Any] = {
            "customer": {"email": contact},
            "items": [{
                "description": (item or "Доступ к VPN-сервису")[:128],
                "quantity": "1.00",
                "amount": {"value": _money(amount), "currency": "RUB"},
                "vat_code": vat,
                "payment_subject": "service",
                "payment_mode": "full_payment",
            }],
        }
        tax = _env("YOOKASSA_TAX_SYSTEM_CODE")
        if tax.isdigit():
            receipt["tax_system_code"] = int(tax)
        return receipt

    # ---- уведомления ----

    @staticmethod
    def ip_allowed(ip: str) -> bool:
        try:
            addr = ipaddress.ip_address((ip or "").strip())
        except ValueError:
            return False
        return any(addr in ipaddress.ip_network(net) for net in NOTIFY_NETWORKS)

    @staticmethod
    def normalize_status(status: Optional[str]) -> str:
        s = (status or "").lower()
        if s == STATUS_SUCCEEDED:
            return "paid"
        if s == STATUS_CANCELED:
            return "failed"
        return "pending"

    @staticmethod
    def payment_amount(p: dict[str, Any]) -> Optional[float]:
        amt = p.get("amount") if isinstance(p.get("amount"), dict) else {}
        try:
            return float(amt.get("value")) if amt.get("value") is not None else None
        except (TypeError, ValueError):
            return None

    @staticmethod
    def matches(p: dict[str, Any], our_payment_id: str) -> bool:
        """платёж ЮKassa создан для нашего payment_id (metadata) и в рублях."""
        meta = p.get("metadata") if isinstance(p.get("metadata"), dict) else {}
        amt = p.get("amount") if isinstance(p.get("amount"), dict) else {}
        if str(amt.get("currency") or "RUB") != "RUB":
            return False
        return str(meta.get("payment_id") or "") == str(our_payment_id)


def get_client() -> YooKassaClient:
    return YooKassaClient()
