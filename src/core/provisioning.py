# создание/продление в remnawave; локальная подписка создаётся и при недоступной панели
from __future__ import annotations

import os
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


def _as_user(data: Any) -> Optional[dict[str, Any]]:
    if isinstance(data, dict) and "response" in data:
        data = data["response"]
    if isinstance(data, dict) and (data.get("id") is not None or data.get("username")):
        return data
    return None


def _as_list(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, dict) and "response" in data:
        data = data["response"]
    if isinstance(data, dict):
        for key in ("users", "items", "data"):
            if isinstance(data.get(key), list):
                return [u for u in data[key] if isinstance(u, dict)]
        return []
    if isinstance(data, list):
        return [u for u in data if isinstance(u, dict)]
    return []


def _tg_of(u: dict[str, Any]) -> str:
    v = u.get("telegramId")
    if v is None:
        v = u.get("telegram_id")
    return str(v) if v is not None and str(v) != "" else ""


def _email_of(u: dict[str, Any]) -> str:
    return str(u.get("email") or "").strip().lower()


def _num_id(u: dict[str, Any]) -> Optional[int]:
    val = u.get("id")
    if val is None:
        val = u.get("userId")
    try:
        return int(val) if val is not None and str(val).isdigit() else None
    except (TypeError, ValueError):
        return None


def _by_username(client: Any, username: str) -> Optional[dict[str, Any]]:
    try:
        return _as_user(client.get_user_by_username(username))
    except Exception:  # noqa: BLE001
        return None


def _stream_users(client: Any, **params: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    cursor: Any = None
    for _ in range(40):
        q = {k: v for k, v in params.items() if v is not None}
        q["size"] = int(q.get("size") or 250)
        if cursor is not None:
            q["cursor"] = cursor
        try:
            page = client.get("/api/users/stream", params=q)
        except Exception:  # noqa: BLE001
            break
        if isinstance(page, dict) and "response" in page:
            page = page["response"]
        users = _as_list(page)
        if not users:
            break
        out.extend(users)
        if not (isinstance(page, dict) and page.get("hasMore")):
            break
        cursor = page.get("nextCursor")
        if cursor is None:
            break
    return out


def _users_by_telegram(client: Any, telegram_id: int) -> list[dict[str, Any]]:
    """пользователи панели с этим telegramId (их может быть несколько — из разных проектов)."""
    tg = int(telegram_id)
    found = [u for u in _stream_users(client, telegramId=str(tg)) if _tg_of(u) == str(tg)]
    if found:
        return found
    out: list[dict[str, Any]] = []
    try:
        start, size = 0, 250
        while True:
            page = client.get_users(start=start, size=size)
            users = _as_list(page)
            if not users:
                break
            out += [u for u in users if _tg_of(u) == str(tg)]
            start += size
            total = (page.get("response") or page).get("total") if isinstance(page, dict) else None
            if (total is not None and start >= int(total)) or len(users) < size:
                break
    except Exception:  # noqa: BLE001
        pass
    return out


def _users_by_email(client: Any, email: str) -> list[dict[str, Any]]:
    want = email.strip().lower()
    if not want:
        return []
    found = [u for u in _stream_users(client, email=want) if _email_of(u) == want]
    return found


def _owned(u: dict[str, Any], *, user_id: Optional[int], telegram_id: Optional[int],
           email: Optional[str]) -> bool:
    """только batman_<наш id> или legacy user_… с тем же telegram/email."""
    if not isinstance(u, dict) or _num_id(u) is None:
        return False
    name = str(u.get("username") or "")
    if user_id and name == rw_username(int(user_id)):
        return True
    if not name.startswith(LEGACY_PREFIX):
        return False
    desc = str(u.get("description") or "").strip()
    if user_id and desc.isdigit() and int(desc) != int(user_id):
        return False
    if telegram_id and _tg_of(u) == str(int(telegram_id)):
        return True
    if email and _email_of(u) == str(email).strip().lower():
        return True
    return False


def lookup(client: Any, *, user_id: Optional[int] = None, telegram_id: Optional[int] = None,
           email: Optional[str] = None) -> Optional[dict[str, Any]]:
    """пользователь Remnawave этого бота:
    1) по имени batman_<id> (так создаются все новые);
    2) старые из прошлого бота — только с именем user_…, по telegram_id / email (без переименования).
    Пользователей с другими именами не берём и не меняем."""
    if user_id is None:
        user_id = _local_user_id(telegram_id, email)
    if user_id:
        rw = _by_username(client, rw_username(int(user_id)))
        if rw and _owned(rw, user_id=user_id, telegram_id=telegram_id, email=email):
            return rw
    candidates: list[dict[str, Any]] = []
    if telegram_id:
        candidates += _users_by_telegram(client, int(telegram_id))
    if email:
        candidates += _users_by_email(client, str(email))
    seen: set[int] = set()
    for u in candidates:
        nid = _num_id(u)
        if nid is None or nid in seen:
            continue
        seen.add(nid)
        if _owned(u, user_id=user_id, telegram_id=telegram_id, email=email):
            return u
    return None


def _extract(user: dict[str, Any]) -> dict[str, Any]:
    rw_id = user.get("id") or user.get("userId") or user.get("uuid")
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
            uid = _num_id(existing)
            if uid is None:
                result["error"] = "user_id_missing"
                return result
            patch: dict[str, Any] = {
                "id": uid,
                "status": "ACTIVE",
                "expire_at": expire_at,
                "hwid_device_limit": int(max(1, devices)),
                "traffic_limit_strategy": traffic_reset_strategy,
            }
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
            if reset_traffic:
                try:
                    client.reset_user_traffic(uid)
                except Exception:  # noqa: BLE001
                    pass
        else:
            if not user_id:
                result["error"] = "user_id_unknown"
                return result
            try:
                user = client.create_user(
                    username=rw_username(int(user_id)),
                    expire_at=expire_at,
                    status="ACTIVE",
                    telegram_id=int(telegram_id) if telegram_id else None,
                    email=email or None,
                    description=str(int(user_id)),
                    hwid_device_limit=int(max(1, devices)),
                    traffic_limit_bytes=traffic_limit_bytes or None,
                    traffic_limit_strategy=traffic_reset_strategy,
                    active_internal_squads=squad_list or None,
                    external_squad_uuid=ext_squad,
                )
            except Exception as created:  # noqa: BLE001
                # username уже есть → обновляем своего batman_<id>, а не чужого
                raced = _by_username(client, rw_username(int(user_id)))
                if not raced or not _owned(raced, user_id=user_id, telegram_id=telegram_id, email=email):
                    raise created
                uid = _num_id(raced)
                if uid is None:
                    raise created
                extra: dict[str, Any] = {"description": str(int(user_id))}
                if squad_list:
                    extra["active_internal_squads"] = squad_list
                if ext_squad:
                    extra["external_squad_uuid"] = ext_squad
                if traffic_limit_bytes:
                    extra["traffic_limit_bytes"] = traffic_limit_bytes
                if email:
                    extra["email"] = email
                user = client.update_user(
                    id=uid,
                    status="ACTIVE",
                    expire_at=expire_at,
                    hwid_device_limit=int(max(1, devices)),
                    traffic_limit_strategy=traffic_reset_strategy,
                    **extra,
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
    uid = _num_id(rw)
    if uid is None:
        raise ValueError("remnawave user id missing")
    return {"id": uid}


def _resolve_quiet(client: Any, **kw: Any) -> Optional[dict[str, Any]]:
    username = kw.get("username")
    if username:
        return _by_username(client, str(username))
    try:
        rw = client.resolve_user(**{k: v for k, v in kw.items() if k in ("id", "short_uuid", "username") and v is not None})
    except Exception:  # noqa: BLE001
        return None
    return _as_user(rw)


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
        rw = lookup(client, telegram_id=telegram_id or None, email=email)
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


def delete_user(telegram_id: Optional[int], email: Optional[str] = None,
                user_id: Optional[int] = None) -> dict[str, Any]:
    if not is_configured():
        return {"ok": False, "error": "remnawave_not_configured"}
    try:
        client = remnawave.get_client()  # type: ignore[union-attr]
        rw = lookup(client, user_id=user_id, telegram_id=telegram_id, email=email)
        if not isinstance(rw, dict):
            return {"ok": True, "already_absent": True}
        uid = _num_id(rw)
        if uid is None:
            return {"ok": False, "error": "user_id_missing"}
        client.delete_user(uid)
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def local_fallback_config(short_uuid: str) -> str:
    return ""
