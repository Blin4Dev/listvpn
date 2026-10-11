# белые списки (анти-ключ) через FURK API — как в старом боте.
# Используется оригинальный furk_api.py из старого проекта (FURKAPI, async):
# положите его рядом с этим файлом (src/api/furk_api.py).
# Конфиг берётся из .env: FURK_API_KEY, FURK_BASE_URL (как в старом config.env).
from __future__ import annotations

import asyncio
import concurrent.futures
import os
import sys
import types
from typing import Any, Optional

ANTI_TRAFFIC_GB = 500  # лимит анти-ключа, как в старом боте
# 499 ГиБ — признак ключа, который нужно переписать через edit_key (логика старого бота)
EDIT_MARK_BYTES = 535797170176
DEFAULT_KEY_URL_BASE = "https://fgn.great-connection.com"

_FURK: Any = None
_IMPORT_ERROR: Optional[str] = None
_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="furk")


def _env(*keys: str, default: str = "") -> str:
    for key in keys:
        val = (os.getenv(key) or "").strip()
        if val:
            return val
    return default


class _Secret(str):
    """аналог pydantic SecretStr для старого кода (config.x.get_secret_value())."""

    def get_secret_value(self) -> str:
        return str(self)


def _install_config_shim() -> None:
    """старый furk_api делает `from config import config` — подставляем значения из .env."""
    existing = sys.modules.get("config")
    if existing is not None and hasattr(existing, "config"):
        return
    cfg = types.SimpleNamespace(
        furk_api_key=_Secret(_env("FURK_API_KEY")),
        furk_base_url=_env("FURK_BASE_URL"),
        remna_api_key=_Secret(_env("REMWAVE_API_KEY", "REMNAWAVE_TOKEN", "REMNAWAVE_API_TOKEN", "REMAN_API_KEY")),
        remnawave_base_url=_env("REMWAVE_BASE_URL", "REMNAWAVE_BASE_URL", "REMNAWAVE_URL"),
        sub_base_url=_env("SUB_BASE_URL", "REMWAVE_SUB_PUBLIC_URL"),
        telegram_token=_Secret(_env("TELEGRAM_BOT_TOKEN", "BOT_TOKEN", "TELEGRAM_TOKEN")),
        yookassa_secret_key=_Secret(_env("YOOKASSA_SECRET_KEY")),
        yookassa_account_id=_env("YOOKASSA_SHOP_ID"),
        admin_id=int(_env("ADMIN_ID", default="0") or 0),
        log_level=_env("LOG_LEVEL", default="INFO"),
    )
    mod = types.ModuleType("config")
    mod.config = cfg  # type: ignore[attr-defined]
    mod.Settings = type(cfg)  # type: ignore[attr-defined]
    sys.modules["config"] = mod


def _load() -> Any:
    global _FURK, _IMPORT_ERROR
    if _FURK is not None:
        return _FURK
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    try:
        _install_config_shim()
        import furk_api  # type: ignore  # noqa: WPS433

        _FURK = getattr(furk_api, "FURKAPI")
        _IMPORT_ERROR = None
    except Exception as exc:  # noqa: BLE001
        _IMPORT_ERROR = f"{type(exc).__name__}: {exc}"
        _FURK = None
    return _FURK


def last_error() -> Optional[str]:
    return _IMPORT_ERROR


def is_configured() -> bool:
    """белые списки включены: есть ключ FURK и модуль furk_api."""
    if not (_env("FURK_API_KEY") and _env("FURK_BASE_URL")):
        return False
    return _load() is not None


def key_url_base() -> str:
    return _env("FURK_KEY_URL_BASE", default=DEFAULT_KEY_URL_BASE).rstrip("/")


def key_url(key_id: str) -> str:
    return f"{key_url_base()}/{key_id}"


def key_id_from_url(url: str) -> str:
    return str(url or "").rstrip("/").rsplit("/", 1)[-1]


def _call(method: str, *args: Any) -> Any:
    """вызвать async-метод FURKAPI из синхронного кода (в отдельном потоке со своим loop)."""
    api = _load()
    if api is None:
        raise RuntimeError(f"furk_api недоступен: {_IMPORT_ERROR or 'нет FURK_API_KEY/FURK_BASE_URL'}")
    fn = getattr(api, method)

    def _run() -> Any:
        res = fn(*args)
        if asyncio.iscoroutine(res):
            return asyncio.run(res)
        return res

    return _POOL.submit(_run).result(timeout=60)


def info_key(key_id: str) -> dict[str, Any]:
    res = _call("info_key", key_id)
    return res if isinstance(res, dict) else {}


def issue_or_renew(current_url: Optional[str], months: int) -> str:
    """логика старого бота: продлить существующий анти-ключ или выпустить новый. Возвращает url ключа."""
    months = max(1, int(months or 1))
    if current_url:
        key_id = key_id_from_url(current_url)
        info = info_key(key_id)
        if info.get("error") == 500:
            # ключ пропал у провайдера — выпускаем новый
            resp = _call("create_key", ANTI_TRAFFIC_GB, months)
            return key_url(str(resp["id"]))
        if info.get("trafficLimitBytes") == EDIT_MARK_BYTES:
            _call("edit_key", key_id, ANTI_TRAFFIC_GB, months)
            return current_url
        _call("renew_key", key_id, months)
        _call("expand_limit", key_id, ANTI_TRAFFIC_GB)
        return current_url
    resp = _call("create_key", ANTI_TRAFFIC_GB, months)
    return key_url(str(resp["id"]))


def traffic(current_url: str) -> dict[str, Any]:
    """трафик анти-ключа для мини-приложения; пусто, если не узнали."""
    try:
        info = info_key(key_id_from_url(current_url))
    except Exception:  # noqa: BLE001
        return {}
    if not info or info.get("error"):
        return {}
    ut = info.get("userTraffic") if isinstance(info.get("userTraffic"), dict) else {}

    def _n(*vals: Any) -> Optional[int]:
        for v in vals:
            try:
                if v is not None:
                    return int(float(v))
            except (TypeError, ValueError):
                continue
        return None

    return {
        "used_bytes": _n(ut.get("usedTrafficBytes"), info.get("usedTrafficBytes"), info.get("used_traffic_bytes")),
        "limit_bytes": _n(info.get("trafficLimitBytes"), info.get("traffic_limit_bytes")) or 0,
    }
