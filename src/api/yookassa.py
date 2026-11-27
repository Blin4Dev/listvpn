"""
YooKassa API v3 client (https://yookassa.ru/developers/api).

Только стандартная библиотека: urllib + Basic-авторизация shopId:secretKey.
"""

from __future__ import annotations

import base64
import ipaddress
import json
import os
import re
import urllib.error
import urllib.request
import uuid
from typing import Any, Optional

API_URL = "https://api.yookassa.ru/v3"

# способы в приложении (на форму ЮKassa не передаём: иначе «method is not available»)
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


try:
    import projects as _projects  # type: ignore  # src/core: env проекта (FGN__YOOKASSA_SHOP_ID …)
except ImportError:  # pragma: no cover
    _projects = None  # type: ignore


def _env(*keys: str, default: str = "") -> str:
    """env текущего проекта сети: ID__NAME, у проекта по умолчанию — как раньше, без префикса."""
    for key in keys:
        val = (_projects.env(key) if _projects is not None else (os.getenv(key) or "")).strip()
        if val:
            return val
    return default


def _money(value: float) -> str:
    return f"{round(float(value), 2):.2f}"


_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}$")


def _host(value: Optional[str]) -> str:
    """домен из «example.com», «https://example.com:8443/path» и т.п."""
    return re.sub(r"^[a-z]+://", "", (value or "").strip(), flags=re.I).split("/", 1)[0].split(":", 1)[0].lower()


def _customer_email(*candidates: Optional[str]) -> str:
    """ЮKassa принимает только чистый email, не «Имя <addr>» и не MAIL_FROM без @."""
    for raw in candidates:
        s = (raw or "").strip().strip("'\"")
        m = re.search(r"<([^<>]+@[^<>]+)>", s)
        if m:
            s = m.group(1).strip()
        s = s.split()[-1] if s and " " in s and "@" in s.split()[-1] else s
        if s and _EMAIL_RE.fullmatch(s) and ".." not in s:
            return s
    return ""


class YooKassaError(Exception):
    def __init__(self, message: str, *, status: Optional[int] = None, payload: Any = None):
        super().__init__(message)
        self.status = status
        self.payload = payload


def _is_receipt_error(exc: YooKassaError) -> bool:
    blob = f"{exc} {exc.payload or ''}".lower()
    return "receipt" in blob or "чек" in blob


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
                param = payload.get("parameter")
                if param and msg:
                    msg = f"{msg} ({param})"
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
        """Платёж с redirect. Способ не фиксируем в payment_method_data: иначе ЮKassa
        отвечает «Payment method is not available», если СБП/карта/SberPay не подключены
        в этом магазине. Форма ЮKassa сама покажет доступные методы.
        Чек 54-ФЗ — в том же запросе (https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/payments)."""
        body: dict[str, Any] = {
            "amount": {"value": _money(amount), "currency": "RUB"},
            "capture": True,
            "confirmation": {
                "type": "redirect",
                "return_url": return_url or _env("YOOKASSA_RETURN_URL") or "https://yookassa.ru",
            },
            "metadata": {"payment_id": str(payment_id)},
        }
        if user_id:
            body["metadata"]["user_id"] = str(user_id)
        if method:
            body["metadata"]["method"] = str(method)
        if description:
            body["description"] = description[:128]
        receipt = self._receipt(amount, receipt_email, receipt_item or description)
        if receipt:
            body["receipt"] = receipt
        resp = self._send_with_receipt_fallback("POST", "/payments", body, f"pay-{payment_id}",
                                                amount, receipt_email, receipt_item or description)
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
        ik = key or f"refund-{yk_payment_id}-{uuid.uuid4().hex[:8]}"
        resp = self._send_with_receipt_fallback("POST", "/refunds", body, ik,
                                                amount, receipt_email, receipt_item)
        if not isinstance(resp, dict):
            raise YooKassaError("Некорректный ответ ЮKassa при возврате", payload=resp)
        return resp

    # ---- чеки 54-ФЗ (если включены в магазине) ----

    @staticmethod
    def receipts_enabled() -> bool:
        # выкл. только явно: магазину с 54-ФЗ чек обязателен при каждом платеже
        return _env("YOOKASSA_RECEIPT", default="1").lower() not in ("0", "false", "no", "off")

    def _send_with_receipt_fallback(self, method: str, path: str, body: dict[str, Any], key: str,
                                    amount: float, receipt_email: Optional[str],
                                    receipt_item: Optional[str]) -> Any:
        """магазин без 54-ФЗ отвергает чек; с 54-ФЗ — требует. один повтор с другим Idempotence-Key.
        Если не помог и повтор — наружу первая ошибка (она про наш чек, а не про его отсутствие)."""
        try:
            return self._request(method, path, body, idempotence_key=key)
        except YooKassaError as exc:
            if not _is_receipt_error(exc):
                raise
            if body.get("receipt"):
                retry = {k: v for k, v in body.items() if k != "receipt"}
                suffix = "-nr"
            else:
                # магазин сам требует чек — собираем его даже при YOOKASSA_RECEIPT=0 (так ставит установщик):
                # флаг лишь отключает чек «заранее», но не должен ломать оплату в магазине с 54-ФЗ
                extra = self._receipt(amount, receipt_email, receipt_item, force=True)
                if not extra:
                    raise YooKassaError(
                        "Магазин ЮKassa требует чек, а email для чека не найден: укажите YOOKASSA_RECEIPT_EMAIL "
                        "в .env или домен мини-приложения проекта (письма no-reply@домен)",
                        status=exc.status, payload=exc.payload) from exc
                retry = {**body, "receipt": extra}
                suffix = "-r"
            try:
                return self._request(method, path, retry, idempotence_key=f"{key}{suffix}")
            except YooKassaError as exc2:
                if _is_receipt_error(exc2):
                    raise exc
                raise

    @staticmethod
    def _receipt_contact(email: Optional[str]) -> str:
        """email для чека: покупателя → YOOKASSA_RECEIPT_EMAIL → адрес писем проекта → no-reply@домен проекта.
        У пользователей из Telegram email обычно нет, а магазину с 54-ФЗ чек нужен в каждом платеже."""
        cands: list[Optional[str]] = [email, _env("YOOKASSA_RECEIPT_EMAIL"), _env("MAIL_FROM")]
        try:
            try:
                import mailer  # type: ignore
            except ImportError:  # pragma: no cover
                from core import mailer  # type: ignore
            cands.append(mailer.mail_from())
        except Exception:  # noqa: BLE001
            pass
        # домены текущего проекта, затем общие домены установки (панель, вебхуки, API)
        for key in ("MINIAPP_DOMAIN", "MINIAPP_URL", "SITE_DOMAIN", "SITE_URL",
                    "PANEL_DOMAIN", "WEBHOOK_DOMAIN", "API_DOMAIN"):
            dom = _host(_env(key))
            if dom:
                cands.append(f"no-reply@{dom}")
        # последний вариант — домен основного проекта: у нового проекта сети своего домена может ещё не быть
        if _projects is not None:
            try:
                for key in ("MINIAPP_DOMAIN", "MINIAPP_URL"):
                    dom = _host(_projects.env(key, project=_projects.DEFAULT))
                    if dom:
                        cands.append(f"no-reply@{dom}")
            except Exception:  # noqa: BLE001
                pass
        return _customer_email(*cands)

    def _receipt(self, amount: float, email: Optional[str], item: Optional[str],
                 *, force: bool = False) -> Optional[dict[str, Any]]:
        if not force and not self.receipts_enabled():
            return None
        contact = self._receipt_contact(email)
        if not contact:
            return None
        try:
            vat = int(_env("YOOKASSA_VAT_CODE", default="1"))  # 1 = НДС не облагается
        except ValueError:
            vat = 1
        if vat < 1 or vat > 12:
            vat = 1
        desc = (item or "Доступ к VPN-сервису").strip() or "Доступ к VPN-сервису"
        receipt: dict[str, Any] = {
            "customer": {"email": contact},
            "items": [{
                "description": desc[:128],
                "quantity": "1.00",
                "amount": {"value": _money(amount), "currency": "RUB"},
                "vat_code": vat,
                # обязательны для «Чеков от ЮKassa» и ФФД 1.05+: услуга, полная предоплата/расчёт
                "payment_subject": _env("YOOKASSA_PAYMENT_SUBJECT", default="service"),
                "payment_mode": _env("YOOKASSA_PAYMENT_MODE", default="full_payment"),
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
