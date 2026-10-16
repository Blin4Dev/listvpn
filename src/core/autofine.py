# автоштрафы поддержки: клиент ждёт ответа N рабочих минут → штраф за X рабочих часов.
# Настройка (панель → Сотрудники → Автоштрафы) хранится в settings["support_autofine"].
#  - считаются только минуты смены сотрудника по графику (вне смены часы не тикают);
#  - ожидание начинается с первого сообщения клиента после последнего ответа сотрудника
#    или кнопки «Ожидание» в панели (юзеру ничего не уходит),
#    но не раньше, чем обращение взято в работу этим сотрудником и чем включены автоштрафы;
#  - один штраф на одно ожидание (повторно — только после нового ответа и нового ожидания);
#  - сумма = оплата дня / часы смены этого дня × часы штрафа; день без оплаты — без штрафа;
#  - обращения у владельца и переданные владельцу (эскалация) не штрафуются;
#  - общая очередь (никто не взял) — штраф операторам на смене, только если включено.
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

try:
    from . import database as db
    from . import staffpay
    from . import support
except ImportError:  # pragma: no cover
    import database as db  # type: ignore
    import staffpay  # type: ignore
    import support  # type: ignore

KEY = "support_autofine"
DEFAULTS: dict[str, Any] = {"enabled": False, "minutes": 15, "hours": 1.0, "pool": False, "warn": True, "since": None}
WARN_BEFORE = 5  # минут до штрафа — предупреждение


class AutofineError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(v: Any) -> Optional[datetime]:
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def get_config() -> dict[str, Any]:
    cfg = dict(DEFAULTS)
    try:
        raw = json.loads(db.get_setting(KEY, "") or "{}")
        if isinstance(raw, dict):
            cfg.update({k: raw[k] for k in DEFAULTS if k in raw})
    except ValueError:
        pass
    return cfg


def save_config(data: dict[str, Any]) -> dict[str, Any]:
    cur = get_config()
    new = dict(cur)
    if data.get("enabled") is not None:
        new["enabled"] = bool(data["enabled"])
    if data.get("minutes") is not None:
        try:
            m = int(data["minutes"])
        except (TypeError, ValueError):
            raise AutofineError("Минуты — целое число")
        if not 5 <= m <= 240:
            raise AutofineError("Время без ответа: от 5 до 240 минут")
        new["minutes"] = m
    if data.get("hours") is not None:
        try:
            h = round(float(data["hours"]), 2)
        except (TypeError, ValueError):
            raise AutofineError("Часы штрафа — число")
        if not 0.25 <= h <= 8:
            raise AutofineError("Штраф: от 0,25 до 8 рабочих часов")
        new["hours"] = h
    for k in ("pool", "warn"):
        if data.get(k) is not None:
            new[k] = bool(data[k])
    if new["enabled"] and not cur["enabled"]:
        # включили — старые ожидания не штрафуем, отсчёт с этого момента
        new["since"] = _now().isoformat()
    db.set_setting(KEY, json.dumps(new))
    return new


def _waiting(ticket_id: int) -> Optional[dict[str, Any]]:
    """первое сообщение клиента после последнего ответа сотрудника или «Ожидание» (заметки — не ответ)."""
    return support.waiting_since(int(ticket_id))


def _marked(ticket_id: int, msg_id: int, staff_id: int, kind: str) -> bool:
    return db.fetchone("SELECT 1 AS x FROM support_autofines WHERE ticket_id = ? AND msg_id = ? AND staff_id = ? AND kind = ?",
                       (ticket_id, msg_id, staff_id, kind)) is not None


def _fmt_min(m: float) -> str:
    return f"{int(m)} мин"


def run(notify: Optional[Callable[[dict[str, Any], str], None]] = None, now: Optional[datetime] = None) -> dict[str, int]:
    """один проход проверки; вызывается раз в минуту. notify(staff_row, text) — сообщение сотруднику."""
    cfg = get_config()
    res = {"fines": 0, "warns": 0}
    if not cfg["enabled"]:
        return res
    now = now or _now()
    need = float(cfg["minutes"])
    warn_at = need - WARN_BEFORE if cfg["warn"] and need > WARN_BEFORE else None
    since = _parse(cfg.get("since")) or now
    staff_rows = {int(s["id"]): s for s in db.fetchall("SELECT * FROM panel_staff WHERE is_active = 1")}
    if not staff_rows:
        return res
    tickets = db.fetchall(
        "SELECT t.id, t.number, t.chat_id, t.assigned_admin, COALESCE(t.escalated, 0) AS escalated, "
        "c.user_id, c.started_at FROM support_tickets t JOIN support_chats c ON c.id = t.chat_id "
        "WHERE t.status = 'open' LIMIT 2000")
    for t in tickets:
        if t["escalated"]:
            continue
        assigned = str(t.get("assigned_admin") or "")
        if assigned.startswith("staff:"):
            try:
                sid = int(assigned.split(":", 1)[1])
            except ValueError:
                continue
            cands = [sid] if sid in staff_rows else []
            pool = False
        elif not assigned and cfg["pool"]:
            cands = [i for i, s in staff_rows.items() if str(s.get("role") or "operator") == "operator"]
            pool = True
        else:
            continue  # у владельца или в общей очереди без штрафов
        if not cands:
            continue
        w = _waiting(int(t["id"]))
        if not w:
            continue
        msg_at = _parse(w["created_at"])
        if not msg_at:
            continue
        start = max(msg_at, since)
        if not pool:
            took = _parse(t.get("started_at"))
            if took:
                start = max(start, took)
        if start >= now:
            continue
        for sid in cands:
            try:
                _check_one(cfg, t, w, sid, staff_rows[sid], start, now, need, warn_at, pool, notify, res)
            except Exception as exc:  # noqa: BLE001
                print(f"[autofine] ticket {t['id']} staff {sid}: {exc}", flush=True)
    return res


def _check_one(cfg, t, w, sid, st, start, now, need, warn_at, pool, notify, res) -> None:
    tid, mid = int(t["id"]), int(w["id"])
    if _marked(tid, mid, sid, "fine"):
        return
    worked, hit = staffpay.work_minutes(sid, start, now, need)
    where = "в общей очереди" if pool else ""
    label = f"обращение №{t['number']} (клиент #{t['user_id']}){' ' + where if where else ''}"
    if hit is None:
        if warn_at is not None and worked >= warn_at and not _marked(tid, mid, sid, "warn"):
            with db.transaction() as tx:
                cur = tx.execute("INSERT OR IGNORE INTO support_autofines (ticket_id, msg_id, staff_id, kind, created_at) "
                                 "VALUES (?, ?, ?, 'warn', ?)", (tid, mid, sid, now.isoformat()))
                fresh = cur.rowcount == 1
            if fresh:
                res["warns"] += 1
                if notify:
                    notify(st, f"⏰ <b>Клиент ждёт ответа {_fmt_min(worked)}</b>\n{label.capitalize()}.\n"
                               f"Через {_fmt_min(need - worked)} — автоштраф.")
        return
    amount = round(staffpay.hour_rate(hit) * float(cfg["hours"]), 2)
    hours_txt = f"{cfg['hours']:g} раб. ч"
    reason = f"Автоштраф: {label} без ответа {int(need)} мин ({hours_txt})"
    with db.transaction() as tx:
        cur = tx.execute("INSERT OR IGNORE INTO support_autofines (ticket_id, msg_id, staff_id, kind, amount, created_at) "
                         "VALUES (?, ?, ?, 'fine', ?, ?)", (tid, mid, sid, amount, now.isoformat()))
        if cur.rowcount != 1:
            return  # уже оштрафован другим процессом
        fine_id = None
        if amount > 0:
            fine_id = staffpay.add_auto_fine_tx(tx, sid, amount, reason)
            tx.execute("UPDATE support_autofines SET fine_id = ? WHERE id = ?", (fine_id, cur.lastrowid))
    if fine_id is None:
        print(f"[autofine] {label}: у сотрудника {sid} нет оплаты за день — штраф 0, пропущен", flush=True)
        return
    res["fines"] += 1
    if notify:
        notify(st, f"⚠️ <b>Автоштраф {amount:g} ₽</b>\n{label.capitalize()} — без ответа {int(need)} мин "
                   f"рабочего времени ({hours_txt}).")


def recent(limit: int = 100) -> list[dict[str, Any]]:
    rows = db.fetchall("SELECT a.*, f.cancelled_at, f.reason, s.name, s.username FROM support_autofines a "
                       "LEFT JOIN staff_fines f ON f.id = a.fine_id LEFT JOIN panel_staff s ON s.id = a.staff_id "
                       "WHERE a.kind = 'fine' ORDER BY a.id DESC LIMIT ?", (int(limit),))
    return [{"id": r["id"], "ticket_id": r["ticket_id"], "staff_id": r["staff_id"],
             "staff_name": (r.get("name") or r.get("username") or f"#{r['staff_id']}"),
             "amount": float(r.get("amount") or 0), "fine_id": r.get("fine_id"), "reason": r.get("reason") or "",
             "cancelled": bool(r.get("cancelled_at")), "created_at": r["created_at"]} for r in rows]
