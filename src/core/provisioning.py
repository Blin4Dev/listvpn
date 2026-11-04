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


USERNAME_PREFIX = "batman_"   # исторический префикс (BatmanVPN и все, кто создан до префиксов проектов)


def _projects():
    try:
        from . import projects as p  # type: ignore
    except ImportError:
        import projects as p  # type: ignore
    return p


def project_prefix(pid: Optional[str]) -> str:
    """префикс имён проекта в Remnawave: project.json → rw_username_prefix (у FGN — fgn_), иначе batman_."""
    try:
        raw = str((_projects().get(pid).cfg or {}).get("rw_username_prefix") or "").strip()
    except Exception:  # noqa: BLE001
        raw = ""
    if raw and not raw.endswith("_"):
        raw += "_"
    return raw if raw and raw[:-1].isalnum() and raw[:-1].islower() else USERNAME_PREFIX


def own_prefixes() -> set[str]:
    out = {USERNAME_PREFIX}
    try:
        for p in _projects().all_projects():
            out.add(project_prefix(p.id))
    except Exception:  # noqa: BLE001
        pass
    return out


def rw_username(user_id: int) -> str:
    """имя пользователя в Remnawave для НОВЫХ: <префикс проекта пользователя><id> (fgn_123, batman_45)."""
    try:
        pid = _projects().of_user(int(user_id))
    except Exception:  # noqa: BLE001
        pid = None
    return f"{project_prefix(pid)}{int(user_id)}"


def own_names(user_id: int) -> list[str]:
    """под какими именами может быть свой пользователь: префикс проекта и прежний batman_<id>."""
    names = [rw_username(int(user_id))]
    old = f"{USERNAME_PREFIX}{int(user_id)}"
    if old not in names:
        names.append(old)
    return names


EXTERNAL_SQUAD_KEY = "squad_external"


def external_squad(user_id: Optional[int] = None) -> Optional[str]:
    """внешний сквад Remnawave проекта (панель → Сквады, у каждого проекта свой); None — не трогать.
    user_id — берём проект пользователя (а не текущего запроса/задачи), иначе — текущий проект."""
    try:
        try:
            from . import database as db  # type: ignore
        except ImportError:
            import database as db  # type: ignore
        pid = None
        if user_id:
            try:
                pid = db.projects.of_user(int(user_id))
            except Exception:  # noqa: BLE001
                pid = None
        v = (db.get_setting(EXTERNAL_SQUAD_KEY, "", project=pid) or "").strip()
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
        # в рамках текущего проекта: у одного telegram_id в разных проектах разные аккаунты
        if telegram_id:
            row = db.fetchone("SELECT id FROM users WHERE telegram_id = ? AND project_id = ? ORDER BY id LIMIT 1",
                              (int(telegram_id), db.pid()))
        if not row and email:
            row = db.fetchone("SELECT id FROM users WHERE lower(email) = lower(?) AND project_id = ? ORDER BY id LIMIT 1",
                              (str(email), db.pid()))
        return int(row["id"]) if row else None
    except Exception:  # noqa: BLE001
        return None


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


def _db():
    try:
        from . import database as db  # type: ignore
    except ImportError:
        import database as db  # type: ignore
    return db


# ── перенесённые из старых ботов (rw_legacy_users): имя в панели прежнее, привязка — по id и имени ──

def legacy_for_user(user_id: Optional[int]) -> Optional[dict[str, Any]]:
    if not user_id:
        return None
    try:
        return _db().fetchone("SELECT * FROM rw_legacy_users WHERE user_id = ?", (int(user_id),))
    except Exception:  # noqa: BLE001
        return None


def _legacy_names() -> list[str]:
    return [str(r["username"]) for r in _db().fetchall("SELECT username FROM rw_legacy_users")]


def own_user_id(username: Any) -> Optional[int]:
    """id пользователя бота по имени в панели: batman_<id> или перенесённый (rw_legacy_users)."""
    name = str(username or "")
    for p in own_prefixes():
        if name.startswith(p) and name[len(p):].isdigit():
            return int(name[len(p):])
    if not name:
        return None
    try:
        r = _db().fetchone("SELECT user_id FROM rw_legacy_users WHERE username = ?", (name,))
    except Exception:  # noqa: BLE001
        return None
    return int(r["user_id"]) if r else None


def _legacy_map() -> dict[str, int]:
    try:
        return {str(r["username"]): int(r["user_id"]) for r in _db().fetchall("SELECT username, user_id FROM rw_legacy_users")}
    except Exception:  # noqa: BLE001
        return {}


if remnawave is not None:
    remnawave.set_own_alias_loader(_legacy_names)
    try:
        remnawave.set_own_prefixes(own_prefixes())
    except Exception:  # noqa: BLE001
        pass


def _owned(u: dict[str, Any], *, user_id: Optional[int], telegram_id: Optional[int] = None,
           email: Optional[str] = None) -> bool:
    """свой пользователь панели — ТОЛЬКО с именем ровно batman_<id пользователя бота>
    или перенесённый из старого бота строго по привязке rw_legacy_users (id в панели + имя).
    Никаких поисков по telegramId / email: на панели могут быть чужие проекты."""
    if not isinstance(u, dict) or _num_id(u) is None or not user_id:
        return False
    name = str(u.get("username") or "")
    if name in own_names(int(user_id)):
        return True
    leg = legacy_for_user(user_id)
    return bool(leg) and name == str(leg["username"]) and _num_id(u) == int(leg["rw_id"])


def lookup(client: Any, *, user_id: Optional[int] = None, telegram_id: Optional[int] = None,
           email: Optional[str] = None) -> Optional[dict[str, Any]]:
    """пользователь Remnawave этого бота: только по имени batman_<id>.
    telegram_id / email используются лишь чтобы найти id пользователя в НАШЕЙ базе."""
    if user_id is None:
        user_id = _local_user_id(telegram_id, email)
    if not user_id:
        return None
    # привязка к старому пользователю (перенос FGN) — выбрана намеренно, поэтому важнее batman_<id>,
    # который мог остаться от прошлого прогона
    leg = legacy_for_user(user_id)
    if leg:
        rw = _by_username(client, str(leg["username"]))
        if rw and _owned(rw, user_id=user_id):
            return rw
    # fgn_<id> (префикс проекта), затем прежний batman_<id> — у кого ключ выдан до префиксов
    for name in own_names(int(user_id)):
        rw = _by_username(client, name)
        if rw and _owned(rw, user_id=user_id):
            return rw
    return None


def own_panel_users(client: Any, project: Optional[str] = None) -> list[dict[str, Any]]:
    """все наши пользователи панели (batman_<id>, где id есть в нашей базе) — для массовых действий.
    project — только пользователи этого проекта сети (Remnawave общий на все проекты)."""
    try:
        try:
            from . import database as db  # type: ignore
        except ImportError:
            import database as db  # type: ignore
        if project:
            local = {int(r["id"]) for r in db.fetchall("SELECT id FROM users WHERE project_id = ?", (project,))}
        else:
            local = {int(r["id"]) for r in db.fetchall("SELECT id FROM users")}
    except Exception:  # noqa: BLE001
        return []
    out: list[dict[str, Any]] = []
    legacy = _legacy_map()
    prefixes = own_prefixes()
    start, size = 0, 250
    while True:
        page = client.get_users(start=start, size=size)
        users = _as_list(page)
        if not users:
            break
        for u in users:
            name = str(u.get("username") or "")
            if _num_id(u) is None:
                continue
            oid = next((int(name[len(p):]) for p in prefixes if name.startswith(p) and name[len(p):].isdigit()), None)
            if oid is not None and oid in local:
                out.append(u)
            elif name in legacy and legacy[name] in local:
                out.append(u)
        start += size
        total = (page.get("response") or page).get("total") if isinstance(page, dict) else None
        if (total is not None and start >= int(total)) or len(users) < size:
            break
    return out


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
    traffic_limit_bytes: Optional[int] = None,  # None — не трогать; 0 — безлимит
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
        ext_squad = external_squad(user_id)

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
            if traffic_limit_bytes is not None:  # 0 тоже шлём: иначе после пробной оставался её лимит
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
                if traffic_limit_bytes is not None:
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
    """description = id пользователя бота — только у своих batman_<id> (чужих не трогаем)."""
    out: dict[str, Any] = {"ok": False, "updated": 0, "error": None}
    if not is_configured():
        out["error"] = "remnawave_not_configured"
        return out
    try:
        client = remnawave.get_client()  # type: ignore[union-attr]
        for u in own_panel_users(client):
            uid = str(own_user_id(u.get("username")) or "")
            if not uid:
                continue
            if str(u.get("description") or "") == uid:
                continue
            try:
                client.update_user(id=int(u["id"]), description=uid)
                out["updated"] += 1
            except Exception:  # noqa: BLE001
                pass
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
