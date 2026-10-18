# белые списки (анти-ключ) через FurkVPN Partner API v2 — https://api.furkvpn.com/docs/v2
# .env: FURK_API_KEY (ключ из @VPNpartenrsbot), FURK_BASE_URL (по умолч. https://api.furkvpn.com/api/v2)
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Optional

ANTI_TRAFFIC_GB = 500  # лимит анти-ключа, как в старом боте
DEFAULT_BASE_URL = "https://api.furkvpn.com/api/v2"
TIMEOUT = 30.0


def _env(*keys: str, default: str = "") -> str:
    for key in keys:
        val = (os.getenv(key) or "").strip()
        if val:
            return val
    return default


class FurkError(Exception):
    def __init__(self, status: int, code: str, message: str = ""):
        super().__init__(f"{status} {code}: {message}".strip())
        self.status = status
        self.code = code
        self.message = message


def base_url() -> str:
    return _env("FURK_BASE_URL", default=DEFAULT_BASE_URL).rstrip("/")


def is_configured() -> bool:
    return bool(_env("FURK_API_KEY"))


def last_error() -> Optional[str]:
    return None if is_configured() else "нет FURK_API_KEY в .env"


def _request(method: str, path: str, body: Optional[dict[str, Any]] = None,
             idem: Optional[str] = None, retries: int = 2) -> dict[str, Any]:
    """запрос к API v2; возвращает result или бросает FurkError."""
    api_key = _env("FURK_API_KEY")
    if not api_key:
        raise FurkError(0, "NOT_CONFIGURED", "нет FURK_API_KEY")
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if idem:
        # повтор с тем же ключом не спишет деньги второй раз (API хранит успешный ответ 24 ч)
        headers["Idempotency-Key"] = idem[:128]
    attempt = 0
    while True:
        attempt += 1
        req = urllib.request.Request(base_url() + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                payload = json.loads(resp.read().decode() or "{}")
                status = resp.status
        except urllib.error.HTTPError as exc:
            status = exc.code
            try:
                payload = json.loads(exc.read().decode() or "{}")
            except Exception:  # noqa: BLE001
                payload = {}
            retry_after = exc.headers.get("Retry-After") if exc.headers else None
            # 429/503/IDEMPOTENCY_IN_PROGRESS — подождать и повторить
            code = ((payload.get("error") or {}).get("code") or "") if isinstance(payload, dict) else ""
            if attempt <= retries and (status in (429, 503) or code == "IDEMPOTENCY_IN_PROGRESS"):
                try:
                    wait = min(10.0, float(retry_after)) if retry_after else 2.0
                except ValueError:
                    wait = 2.0
                time.sleep(wait)
                continue
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            # сетевой сбой: безопасно повторять только идемпотентные запросы
            if attempt <= retries and (method == "GET" or idem):
                time.sleep(2.0)
                continue
            raise FurkError(0, "NETWORK", str(exc)) from exc
        if isinstance(payload, dict) and payload.get("ok"):
            return payload.get("result") or {}
        err = (payload.get("error") or {}) if isinstance(payload, dict) else {}
        raise FurkError(status, str(err.get("code") or f"HTTP_{status}"), str(err.get("message") or ""))


# ── операции ──
def key_info(key_id: str) -> Optional[dict[str, Any]]:
    """ключ или None, если его нет у провайдера."""
    try:
        res = _request("GET", f"/keys/{_safe_id(key_id)}")
    except FurkError as exc:
        if exc.status == 404:
            return None
        raise
    return res.get("key") if isinstance(res.get("key"), dict) else res


def _period(months: Optional[int] = None, days: Optional[int] = None, hours: Optional[int] = None) -> dict[str, int]:
    """ровно одно из months / days / hours, как в API v2."""
    if days is not None:
        d = int(days)
        if not 1 <= d <= 1095:
            raise FurkError(400, "VALIDATION_ERROR", "дней: от 1 до 1095")
        return {"days": d}
    if hours is not None:
        h = int(hours)
        if not 1 <= h <= 26280:
            raise FurkError(400, "VALIDATION_ERROR", "часов: от 1 до 26280")
        return {"hours": h}
    m = max(1, min(36, int(months or 1)))
    return {"months": m}


def create_key(limit_gb: int, months: Optional[int] = None, idem: Optional[str] = None,
               days: Optional[int] = None, hours: Optional[int] = None) -> dict[str, Any]:
    body = {"limit_gb": int(limit_gb), **_period(months, days, hours)}
    res = _request("POST", "/keys", body, idem=idem)
    return res.get("key") or {}


def create_trial_key(idem: Optional[str] = None) -> dict[str, Any]:
    """POST /keys/trial — бесплатный пробный ключ (cost = 0). Тела нет: срок и трафик берутся
    из настроек приложения в @VPNpartenrsbot. Ключ обычный — его можно продлить / перевести на тариф.
    403 TRIAL_DISABLED — пробные ключи у приложения выключены. Возвращает объект key."""
    res = _request("POST", "/keys/trial", None, idem=idem)
    key = res.get("key") or {}
    if key.get("id") and not key.get("subscription_url"):
        try:  # в ответе на создание ссылки может не быть — берём из карточки ключа
            key = key_info(str(key["id"])) or key
        except FurkError:
            pass
    return key


def renew_key(key_id: str, months: Optional[int] = None, idem: Optional[str] = None,
              days: Optional[int] = None, hours: Optional[int] = None) -> dict[str, Any]:
    res = _request("POST", f"/keys/{_safe_id(key_id)}/renew", _period(months, days, hours), idem=idem)
    return res.get("key") or {}


def expand_key(key_id: str, limit_gb: int, idem: Optional[str] = None) -> dict[str, Any]:
    res = _request("POST", f"/keys/{_safe_id(key_id)}/expand", {"limit_gb": int(limit_gb)}, idem=idem)
    return res.get("key") or {}


def edit_key(key_id: str, limit_gb: int, months: Optional[int] = None, idem: Optional[str] = None,
             days: Optional[int] = None, hours: Optional[int] = None) -> dict[str, Any]:
    body = {"limit_gb": int(limit_gb), **_period(months, days, hours)}
    res = _request("POST", f"/keys/{_safe_id(key_id)}/edit", body, idem=idem)
    return res.get("key") or {}


def balance() -> dict[str, Any]:
    """баланс партнёра (копейки → рубли)."""
    res = _request("GET", "/balance")
    out: dict[str, Any] = {}
    for k in ("balance", "credit"):
        if res.get(k) is not None:
            try:
                out[k] = round(int(res[k]) / 100, 2)
            except (TypeError, ValueError):
                pass
    return out


def _safe_id(key_id: str) -> str:
    kid = str(key_id or "").strip()
    if not kid or not all(c.isalnum() or c in "-_" for c in kid) or len(kid) > 64:
        raise FurkError(400, "BAD_KEY_ID", "некорректный id ключа")
    return kid


def key_id_from_url(url: str) -> str:
    """для ключей старого бота: id — последний сегмент ссылки."""
    return str(url or "").rstrip("/").rsplit("/", 1)[-1]


def _limit_gb(key: dict[str, Any]) -> int:
    tr = key.get("traffic") or {}
    for v in (tr.get("base_limit_gb"), tr.get("limit_gb")):
        try:
            if v is not None:
                return int(float(v))
        except (TypeError, ValueError):
            continue
    return 0


def issue_or_renew(key_id: Optional[str], months: Optional[int] = None, idem: Optional[str] = None,
                   days: Optional[int] = None) -> dict[str, Any]:
    """логика старого бота: продлить анти-ключ или выпустить новый (500 ГБ).
    Возвращает {"id", "subscription_url", "expires_at"}."""
    period = dict(days=days) if days is not None else dict(months=max(1, min(36, int(months or 1))))
    tag = (idem or "").strip()

    def _k(step: str) -> Optional[str]:
        return f"{tag}:{step}" if tag else None

    key = key_info(key_id) if key_id else None
    if key is None:
        key = create_key(ANTI_TRAFFIC_GB, idem=_k("create"), **period)
    else:
        tr = key.get("traffic") or {}
        if key.get("is_trial") or tr.get("unlimited"):
            # продление/расширение для пробных и безлимитных недоступно — меняем тариф
            key = edit_key(key["id"], ANTI_TRAFFIC_GB, idem=_k("edit"), **period) or key
        else:
            try:
                key = renew_key(key["id"], idem=_k("renew"), **period) or key
            except FurkError as exc:
                if exc.code != "KEY_NOT_ELIGIBLE":
                    raise
                key = edit_key(key["id"], ANTI_TRAFFIC_GB, idem=_k("edit"), **period) or key
            if _limit_gb(key) and _limit_gb(key) < ANTI_TRAFFIC_GB:
                try:
                    key = expand_key(key["id"], ANTI_TRAFFIC_GB, idem=_k("expand")) or key
                except FurkError as exc:
                    if exc.code != "KEY_NOT_ELIGIBLE":
                        raise
    if not key.get("id"):
        raise FurkError(0, "BAD_RESPONSE", "в ответе нет id ключа")
    return {"id": str(key["id"]), "subscription_url": key.get("subscription_url"),
            "expires_at": key.get("expires_at")}


def traffic(key_id: str) -> dict[str, Any]:
    """трафик анти-ключа для мини-приложения; пусто, если не узнали."""
    try:
        key = key_info(key_id)
    except Exception:  # noqa: BLE001
        return {}
    if not key:
        return {}
    tr = key.get("traffic") or {}

    def _n(v: Any) -> Optional[int]:
        try:
            return int(float(v)) if v is not None else None
        except (TypeError, ValueError):
            return None

    return {"used_bytes": _n(tr.get("used_bytes")),
            "limit_bytes": 0 if tr.get("unlimited") else (_n(tr.get("limit_bytes")) or 0)}
