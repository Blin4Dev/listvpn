# создание/продление в remnawave; локальная подписка создаётся и при недоступной панели
from __future__ import annotations

import os
import urllib.parse
import uuid as _uuid
from datetime import datetime, timezone
from typing import Any, Optional

try:  # remnawave lives on PYTHONPATH (src/api)
    import remnawave  # type: ignore
except Exception:  # noqa: BLE001
    remnawave = None  # type: ignore


def _env(*keys: str, default: str = "") -> str:
    for key in keys:
        val = (os.getenv(key) or "").strip()
        if val:
            return val
    return default


def is_configured() -> bool:
    if remnawave is None:
        return False
    return bool(_env("REMWAVE_API_KEY", "REMNAWAVE_TOKEN", "REMNAWAVE_API_TOKEN"))


USERNAME_PREFIX = "batman_"


def rw_username(user_id: int) -> str:
    """имя пользователя в Remnawave: batman_<id пользователя в боте>."""
    return f"{USERNAME_PREFIX}{int(user_id)}"


EXTERNAL_SQUAD_KEY = "squad_external"


def external_squad() -> Optional[str]:
    """внешний сквад Remnawave для всех пользователей (панель → Сквады); None — не трогать."""
    try:
        try:
            from . import database as db  # type: ignore
        except ImportError:
            import database as db  # type: ignore
        v = (db.get_setting(EXTERNAL_SQUAD_KEY, "") or "").strip()
    except Exception:  # noqa: BLE001
        return None
    return v or None


def _local_user_id(telegram_id: Optional[int], email: Optional[str]) -> Optional[int]:
    """id пользователя бота по telegram_id / email (для вызовов, где id не передали)."""
    try:
        try:
            from . import database as db  # type: ignore
        except ImportError:
            import database as db  # type: ignore
        row = None
        if telegram_id:
            row = db.fetchone("SELECT id FROM users WHERE telegram_id = ? ORDER BY id LIMIT 1", (int(telegram_id),))
        if not row and email:
            row = db.fetchone("SELECT id FROM users WHERE lower(email) = lower(?) ORDER BY id LIMIT 1", (str(email),))
        return int(row["id"]) if row else None
    except Exception:  # noqa: BLE001
        return None


# пользователи старого бота в Remnawave: user_<12 символов>. Других (чужие проекты на той же панели) не трогаем.
LEGACY_PREFIX = "user_"


def _as_list(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, dict) and "response" in data:
        data = data["response"]
    if isinstance(data, dict):
        for key in ("users", "items", "data"):
            if isinstance(data.get(key), list):
                return [u for u in data[key] if isinstance(u, dict)]
        return [data] if (data.get("uuid") or data.get("id")) else []
    if isinstance(data, list):
        return [u for u in data if isinstance(u, dict)]
    return []


def _users_by_telegram(client: Any, telegram_id: int) -> list[dict[str, Any]]:
    """ВСЕ пользователи панели с этим telegramId (их может быть несколько — из разных проектов)."""
    tg = int(telegram_id)
    for path, params in (("/api/users/stream", {"telegramId": tg, "size": 250}),
                         (f"/api/users/by-telegram-id/{tg}", None)):
        try:
            found = _as_list(client.get(path, params=params) if params else client.get(path))
        except Exception:  # noqa: BLE001
            continue
        found = [u for u in found if str(u.get("telegramId") or u.get("telegram_id") or "") == str(tg)]
        if found:
            return found
    # запасной вариант: просмотр страницами
    out: list[dict[str, Any]] = []
    try:
        start, size = 0, 250
        while True:
            page = client.get_users(start=start, size=size)
            users = _as_list(page)
            if not users:
                break
            out += [u for u in users if str(u.get("telegramId") or u.get("telegram_id") or "") == str(tg)]
            start += size
            total = (page.get("response") or page).get("total") if isinstance(page, dict) else None
            if (total is not None and start >= int(total)) or len(users) < size:
                break
    except Exception:  # noqa: BLE001
        pass
    return out


def _users_by_email(client: Any, email: str) -> list[dict[str, Any]]:
    for call in (lambda: client.get("/api/users/stream", params={"email": email, "size": 250}),
                 lambda: client.get("/api/users/by-email/" + urllib.parse.quote(email, safe="")),
                 lambda: client.resolve_user(email=email)):
        try:
            found = [u for u in _as_list(call()) if str(u.get("email") or "").lower() == email.lower()]
        except Exception:  # noqa: BLE001
            continue
        if found:
            return found
    return []


def lookup(client: Any, *, user_id: Optional[int] = None, telegram_id: Optional[int] = None,
           email: Optional[str] = None) -> Optional[dict[str, Any]]:
    """пользователь Remnawave этого бота:
    1) по имени batman_<id> (так создаются все новые);
    2) старые из прошлого бота — только с именем user_…, по telegram_id / email (без переименования).
    Пользователей с другими именами не берём и не меняем."""
    if user_id is None:
        user_id = _local_user_id(telegram_id, email)
    if user_id:
        rw = _resolve_quiet(client, username=rw_username(int(user_id)))
        if rw:
            return rw
    candidates: list[dict[str, Any]] = []
    if telegram_id:
        candidates += _users_by_telegram(client, int(telegram_id))
    if email:
        candidates += _users_by_email(client, str(email))
    for u in candidates:
        if str(u.get("username") or "").startswith(LEGACY_PREFIX) and (u.get("uuid") or u.get("id")):
            return u
    return None


def _extract(user: dict[str, Any]) -> dict[str, Any]:
    rw_id = user.get("uuid") or user.get("id") or user.get("userId")
    short = user.get("shortUuid") or user.get("short_uuid")
    return {
        "rw_id": str(rw_id) if rw_id is not None else None,
        "short_uuid": str(short) if short else None,
        "vless_uuid": user.get("vlessUuid") or user.get("vless_uuid"),
    }


def provision(
    *,
    telegram_id: Optional[int],
    username: Optional[str],
    expire_at: datetime,
    devices: int = 1,
    squads: Optional[list[str]] = None,
    email: Optional[str] = None,
    traffic_limit_bytes: int = 0,
    traffic_reset_strategy: str = "MONTH",
    reset_traffic: bool = False,
    user_id: Optional[int] = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ok": False,
        "rw_id": None,
        "short_uuid": None,
        "subscription_url": None,
        "error": None,
    }

    if not is_configured():
        result["error"] = "remnawave_not_configured"
        return result

    if expire_at.tzinfo is None:
        expire_at = expire_at.replace(tzinfo=timezone.utc)

    try:
        client = remnawave.get_client()  # type: ignore[union-attr]
        # поиск: batman_<id> → (старые) telegram → email → web_<id>
        if not user_id:
            user_id = _local_user_id(telegram_id, email)
        existing = lookup(client, user_id=user_id, telegram_id=telegram_id, email=email)
        squad_list = list(squads or [])
        ext_squad = external_squad()

        if existing:
            uid = existing.get("id") or existing.get("userId") or existing.get("uuid")
            patch: dict[str, Any] = {
                "status": "ACTIVE",
                "expire_at": expire_at,
                "hwid_device_limit": int(max(1, devices)),
                "traffic_limit_strategy": traffic_reset_strategy,
            }
            if isinstance(uid, int) or (isinstance(uid, str) and uid.isdigit()):
                patch["id"] = int(uid)
            else:
                patch["uuid"] = uid
            if squad_list:
                patch["active_internal_squads"] = squad_list
            if ext_squad:
                patch["external_squad_uuid"] = ext_squad
            if traffic_limit_bytes:
                patch["traffic_limit_bytes"] = traffic_limit_bytes
            if email:
                patch["email"] = email
            if user_id:
                patch["description"] = str(int(user_id))
            user = client.update_user(**patch)
            # опциональный сброс трафика (напр. trial→paid)
            if reset_traffic and uid is not None:
                try:
                    client.reset_user_traffic(uid)
                except Exception:  # noqa: BLE001
                    pass
        else:
            if not user_id:
                result["error"] = "user_id_unknown"
                return result
            user = client.create_user(
                username=rw_username(int(user_id)),
                expire_at=expire_at,
                status="ACTIVE",
                telegram_id=int(telegram_id) if telegram_id else None,
                email=email or None,
                description=str(int(user_id)) if user_id else None,
                hwid_device_limit=int(max(1, devices)),
                traffic_limit_bytes=traffic_limit_bytes or None,
                traffic_limit_strategy=traffic_reset_strategy,
                active_internal_squads=squad_list or None,
                external_squad_uuid=ext_squad,
            )

        if not isinstance(user, dict):
            result["error"] = "unexpected_remnawave_response"
            return result

        fields = _extract(user)
        result.update(fields)
        result["subscription_url"] = client.subscription_url_for(
            user, public_base=_env("REMWAVE_SUB_PUBLIC_URL") or None
        )
        result["ok"] = True
        return result
    except Exception as exc:  # noqa: BLE001
        result["error"] = f"{type(exc).__name__}: {exc}"
        return result


def find_user(client: Any, telegram_id: Optional[int], email: Optional[str] = None,
              user_id: Optional[int] = None) -> Optional[dict[str, Any]]:
    return lookup(client, user_id=user_id, telegram_id=telegram_id, email=email)


def rw_ref(rw: dict[str, Any]) -> dict[str, Any]:
    uid = rw.get("id") or rw.get("userId") or rw.get("uuid")
    if isinstance(uid, int) or (isinstance(uid, str) and uid.isdigit()):
        return {"id": int(uid)}
    return {"uuid": uid}


def _resolve_quiet(client: Any, **kw: Any) -> Optional[dict[str, Any]]:
    try:
        rw = client.resolve_user(**kw)
    except Exception:  # noqa: BLE001
        return None
    if isinstance(rw, dict) and "response" in rw:
        rw = rw["response"]
    return rw if isinstance(rw, dict) and (rw.get("uuid") or rw.get("id")) else None


def backfill_descriptions(tg_to_user_id: dict[int, int]) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "updated": 0, "error": None}
    if not is_configured():
        out["error"] = "remnawave_not_configured"
        return out
    try:
        client = remnawave.get_client()  # type: ignore[union-attr]
        start, size = 0, 250
        while True:
            page = client.get_users(start=start, size=size)
            if isinstance(page, dict) and "response" in page:
                page = page["response"]
            users = page.get("users") if isinstance(page, dict) else page
            if not users:
                break
            for u in users:
                try:
                    tg = int(u.get("telegramId") or 0)
                except (TypeError, ValueError):
                    continue
                uid = tg_to_user_id.get(tg) if tg else None
                if not uid or str(u.get("description") or "") == str(uid) or u.get("id") is None:
                    continue
                try:
                    client.update_user(id=int(u["id"]), description=str(uid))
                    out["updated"] += 1
                except Exception:  # noqa: BLE001
                    pass
            start += size
            total = page.get("total") if isinstance(page, dict) else None
            if (total is not None and start >= int(total)) or len(users) < size:
                break
        out["ok"] = True
        return out
    except Exception as exc:  # noqa: BLE001
        out["error"] = f"{type(exc).__name__}: {exc}"
        return out


def reset_traffic(telegram_id: int, email: Optional[str] = None) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "error": None}
    if not is_configured():
        out["error"] = "remnawave_not_configured"
        return out
    try:
        client = remnawave.get_client()  # type: ignore[union-attr]
        rw = lookup(client, telegram_id=telegram_id, email=email)
        if not isinstance(rw, dict):
            out["error"] = "user_not_found"
            return out
        # remnawave 3.x ждёт числовой id для reset-traffic
        uid = rw.get("id")
        if uid is None:
            out["error"] = "user_id_missing"
            return out
        client.reset_user_traffic(int(uid))
        out["ok"] = True
        return out
    except Exception as exc:  # noqa: BLE001
        out["error"] = f"{type(exc).__name__}: {exc}"
        return out


def user_ever_connected(telegram_id: int, email: Optional[str] = None) -> Optional[bool]:
    if not is_configured():
        return None
    try:
        client = remnawave.get_client()  # type: ignore[union-attr]
        rw = lookup(client, telegram_id=telegram_id, email=email)
        if not isinstance(rw, dict):
            return None
        # online/traffic могут быть в userTraffic или на верхнем уровне
        ut = rw.get("userTraffic") if isinstance(rw.get("userTraffic"), dict) else {}
        if rw.get("onlineAt") or ut.get("onlineAt") or rw.get("lastConnectedAt"):
            return True
        used = (rw.get("usedTrafficBytes") or rw.get("lifetimeUsedTrafficBytes")
                or ut.get("usedTrafficBytes") or ut.get("lifetimeUsedTrafficBytes")
                or rw.get("trafficUsedBytes") or 0)
        try:
            if float(used) > 0:
                return True
        except (TypeError, ValueError):
            pass
        num_id = rw.get("id")  # hwid endpoints use numeric id
        try:
            if num_id is not None:
                data = client.get_user_hwid_devices(int(num_id))
                if isinstance(data, dict) and "response" in data:
                    data = data["response"]
                devs = data.get("devices") if isinstance(data, dict) else data
                if devs and len(devs) > 0:
                    return True
        except Exception:  # noqa: BLE001
            pass
        return False
    except Exception:  # noqa: BLE001
        return None


def user_first_connected_at(telegram_id: int, email: Optional[str] = None) -> Optional[str]:
    if not is_configured():
        return None
    try:
        client = remnawave.get_client()  # type: ignore[union-attr]
        rw = lookup(client, telegram_id=telegram_id, email=email)
        if not isinstance(rw, dict):
            return None
        ut = rw.get("userTraffic") if isinstance(rw.get("userTraffic"), dict) else {}
        val = (rw.get("firstConnectedAt") or rw.get("first_connected_at")
               or ut.get("firstConnectedAt") or rw.get("onlineAt") or ut.get("onlineAt")
               or rw.get("lastConnectedAt"))
        return str(val) if val else None
    except Exception:  # noqa: BLE001
        return None


def set_enabled(telegram_id: Optional[int], enabled: bool, email: Optional[str] = None) -> dict[str, Any]:
    if not is_configured():
        return {"ok": False, "error": "remnawave_not_configured"}
    try:
        client = remnawave.get_client()  # type: ignore[union-attr]
        rw = lookup(client, telegram_id=telegram_id, email=email)
        if not isinstance(rw, dict) or rw.get("id") is None:
            return {"ok": True, "already_absent": True}
        uid = int(rw["id"])
        if enabled:
            client.enable_user(uid)
        else:
            client.disable_user(uid)
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def delete_user(telegram_id: Optional[int], email: Optional[str] = None) -> dict[str, Any]:
    if not is_configured():
        return {"ok": False, "error": "remnawave_not_configured"}
    try:
        client = remnawave.get_client()  # type: ignore[union-attr]
        rw = lookup(client, telegram_id=telegram_id, email=email)
        if not isinstance(rw, dict):
            return {"ok": True, "already_absent": True}
        uid = rw.get("id")
        if uid is None:
            uid = rw.get("userId") or rw.get("uuid")
        client.delete_user(int(uid) if str(uid).isdigit() else uid)
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def local_fallback_config(short_uuid: str) -> str:
    return ""
