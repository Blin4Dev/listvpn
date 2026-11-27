"""Конкурс: с выбранного момента каждая оплаченная подписка (покупка или продление) пишется в отдельную
таблицу. В панели: включить/выключить, время старта, таблица, выгрузка, очистка. Свой у каждого проекта."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

try:
    from . import database as db  # type: ignore
except ImportError:
    import database as db  # type: ignore

PURPOSES = ("subscription", "extend")  # что считается «купил подписку»
_KEYS = ("contest_enabled", "contest_start_at", "contest_title")


def _parse(v: Optional[str]) -> Optional[datetime]:
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def config() -> dict[str, Any]:
    s = db.get_settings(list(_KEYS))
    start = _parse(s.get("contest_start_at"))
    return {
        "enabled": s.get("contest_enabled") == "1",
        "start_at": start.isoformat() if start else None,
        "title": s.get("contest_title") or "",
    }


def set_config(*, enabled: Optional[bool] = None, start_at: Optional[str] = None,
               title: Optional[str] = None) -> dict[str, Any]:
    if start_at is not None:
        d = _parse(start_at)
        if start_at and d is None:
            raise ValueError("bad start_at")
        db.set_setting("contest_start_at", d.astimezone(timezone.utc).isoformat() if d else "")
    if title is not None:
        db.set_setting("contest_title", title.strip()[:120])
    if enabled is not None:
        db.set_setting("contest_enabled", "1" if enabled else "0")
    return config()


def is_running(now: Optional[datetime] = None) -> bool:
    c = config()
    if not c["enabled"]:
        return False
    start = _parse(c["start_at"])
    now = now or datetime.now(timezone.utc)
    return start is None or now >= start


def record_purchase(user: dict[str, Any], payment: dict[str, Any]) -> bool:
    """вызывается после успешной оплаты; True — записали участника."""
    purpose = payment.get("purpose") or "subscription"
    if purpose not in PURPOSES or not is_running():
        return False
    devices = int(payment.get("plan_devices") or 0) + int(payment.get("extra_devices") or 0)
    db.execute(
        "INSERT OR IGNORE INTO contest_entries (project_id, payment_id, user_id, telegram_id, username, first_name, "
        "purpose, months, devices, amount, currency, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (db.pid(), str(payment.get("payment_id")), int(user["id"]), user.get("telegram_id"), user.get("username"),
         user.get("first_name"), purpose, int(payment.get("months") or 1), devices or None,
         float(payment.get("amount") or 0), payment.get("currency") or "RUB", payment.get("provider"),
         db.utcnow_iso()),
    )
    return db.changes() > 0


def entries(limit: int = 5000) -> list[dict[str, Any]]:
    return db.fetchall(
        "SELECT * FROM contest_entries WHERE project_id = ? ORDER BY id DESC LIMIT ?", (db.pid(), int(limit)))


def stats() -> dict[str, Any]:
    r = db.fetchone(
        "SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS u, COALESCE(SUM(amount), 0) AS s "
        "FROM contest_entries WHERE project_id = ?", (db.pid(),)) or {}
    return {"purchases": int(r.get("n") or 0), "users": int(r.get("u") or 0), "amount": float(r.get("s") or 0)}


def clear() -> int:
    db.execute("DELETE FROM contest_entries WHERE project_id = ?", (db.pid(),))
    return db.changes()
