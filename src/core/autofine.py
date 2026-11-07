# автоштрафы поддержки: клиент ждёт ответа N рабочих минут → штраф за X рабочих часов.
# Настройка (панель → Сотрудники → Автоштрафы) хранится в settings["support_autofine"].
#  - считаются только минуты смены сотрудника по графику (вне смены часы не тикают);
#  - ожидание начинается с первого сообщения клиента после последнего ответа сотрудника
#    или кнопки «Ожидание» в панели (юзеру ничего не уходит),
#    но не раньше, чем обращение взято в работу этим сотрудником и чем включены автоштрафы;
#  - взятое в работу: не штрафуем каждый тикет. Один штраф сотруднику за всю его пачку
#    ожидающих, и только если он сам давно ничего не ответил (разгрёб 30 тикетов — не 30 штрафов);
#  - кнопка «Ожидание» выводит тикет из расчёта, пока клиент снова не напишет;
#  - общая очередь (никто не взял) — один штраф операторам на смене, не за каждого клиента;
#  - сумма = оплата дня / часы смены этого дня × часы штрафа; день без оплаты — без штрафа;
#  - обращения у владельца и переданные владельцу (эскалация) не штрафуются.
from __future__ import annotations

import json
from datetime import datetime, timezone
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
POOL_TICKET = 0   # sentinel: необработанная общая очередь
INBOX_TICKET = -1  # sentinel: пачка взятых тикетов сотрудника (не каждый по отдельности)


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
        "SELECT t.id, t.number, t.chat_id, t.assigned_admin, t.opened_at, COALESCE(t.escalated, 0) AS escalated, "
        "c.user_id, c.started_at FROM support_tickets t JOIN support_chats c ON c.id = t.chat_id "
        "WHERE t.status = 'open' LIMIT 2000")
    pool_waits: list[tuple[Any, dict[str, Any], datetime]] = []
    inbox: dict[int, list[tuple[Any, dict[str, Any], datetime]]] = {}
    for t in tickets:
        if t["escalated"]:
            continue
        w = _waiting(int(t["id"]))
        if not w:
            continue
        msg_at = _parse(w["created_at"])
        if not msg_at:
            continue
        assigned = str(t.get("assigned_admin") or "")
        if assigned.startswith("staff:"):
            try:
                sid = int(assigned.split(":", 1)[1])
            except ValueError:
                continue
            if sid not in staff_rows:
                continue
            opened = _parse(t.get("opened_at"))
            took = _parse(t.get("started_at"))
            if took and opened and took < opened:
                took = None
            if not took:
                continue
            start = max(msg_at, since, took)
            if start < now:
                inbox.setdefault(sid, []).append((t, w, start))
        elif not assigned and cfg["pool"]:
            start = max(msg_at, since)
            if start < now:
                pool_waits.append((t, w, start))
    for sid, waits in inbox.items():
        try:
            _check_inbox(cfg, sid, staff_rows[sid], waits, now, need, warn_at, notify, res)
        except Exception as exc:  # noqa: BLE001
            print(f"[autofine] inbox staff {sid}: {exc}", flush=True)
    if cfg["pool"] and pool_waits:
        try:
            _check_pool(cfg, pool_waits, staff_rows, now, need, warn_at, notify, res)
        except Exception as exc:  # noqa: BLE001
            print(f"[autofine] pool: {exc}", flush=True)
    return res


def _last_sentinel(ticket_id: int, sid: int, kind: str) -> Optional[dict[str, Any]]:
    return db.fetchone(
        "SELECT msg_id, created_at FROM support_autofines WHERE ticket_id = ? AND staff_id = ? AND kind = ? "
        "ORDER BY id DESC LIMIT 1",
        (int(ticket_id), int(sid), kind),
    )


def _sentinel_same_wave(ticket_id: int, sid: int, kind: str, oldest_start: datetime) -> bool:
    """уже штрафовали/предупреждали за текущую пачку (пока кто-то всё ещё ждёт)."""
    prev = _last_sentinel(ticket_id, sid, kind)
    if not prev:
        return False
    at = _parse(prev.get("created_at"))
    return bool(at and at >= oldest_start)


def _staff_last_reply(sid: int) -> Optional[datetime]:
    """последний ответ клиенту (не заметка, не «Ожидание») — сотрудник разгребает пачку."""
    row = db.fetchone(
        "SELECT MAX(created_at) AS t FROM support_messages WHERE author_actor = ? AND sender = 'admin' "
        "AND COALESCE(internal, 0) = 0 AND deleted_at IS NULL",
        (f"staff:{int(sid)}",),
    )
    return _parse((row or {}).get("t"))


def _check_inbox(cfg, sid, st, waits, now, need, warn_at, notify, res) -> None:
    """один штраф за все взятые тикеты сотрудника, не за каждый; «Ожидание» уже выкинуто из waits."""
    # сотрудник разгребает пачку: отсчёт — от его последнего ответа клиенту.
    # раньше тут был ранний выход «ответил меньше need минут назад — не проверяем», из-за него
    # проверка пропускала окно предупреждения (need-5…need) и сразу выписывала штраф без «скоро штраф».
    # для штрафа он лишний: от last_reply ниже и так считаются рабочие минуты.
    last_reply = _staff_last_reply(int(sid))
    oldest_start = min(start for _, _, start in waits)
    if last_reply and last_reply > oldest_start:
        oldest_start = last_reply
    if _sentinel_same_wave(INBOX_TICKET, sid, "fine", oldest_start):
        return
    wave_msg = min(int(w["id"]) for _, w, _ in waits)
    n = len(waits)
    fake_t = {"id": INBOX_TICKET, "number": 0, "user_id": 0}
    fake_w = {"id": wave_msg, "created_at": oldest_start.isoformat()}
    _check_one(cfg, fake_t, fake_w, sid, st, oldest_start, now, need, warn_at, "inbox", notify, res, queue_n=n)


def _check_pool(cfg, waits, staff_rows, now, need, warn_at, notify, res) -> None:
    """один штраф оператору за всю необработанную очередь, не за каждого клиента."""
    operators = [i for i, s in staff_rows.items() if str(s.get("role") or "operator") == "operator"]
    if not operators:
        return
    oldest_start = min(start for _, _, start in waits)
    wave_msg = min(int(w["id"]) for _, w, _ in waits)
    n = len(waits)
    fake_t = {"id": POOL_TICKET, "number": 0, "user_id": 0}
    fake_w = {"id": wave_msg, "created_at": oldest_start.isoformat()}
    for sid in operators:
        if _sentinel_same_wave(POOL_TICKET, sid, "fine", oldest_start):
            continue
        st = staff_rows[sid]
        try:
            _check_one(cfg, fake_t, fake_w, sid, st, oldest_start, now, need, warn_at, "pool", notify, res, queue_n=n)
        except Exception as exc:  # noqa: BLE001
            print(f"[autofine] pool staff {sid}: {exc}", flush=True)


def _check_one(cfg, t, w, sid, st, start, now, need, warn_at, mode, notify, res, queue_n: int = 0) -> None:
    tid, mid = int(t["id"]), int(w["id"])
    if _marked(tid, mid, sid, "fine"):
        return
    if mode in ("pool", "inbox") and _sentinel_same_wave(tid, sid, "fine", start):
        return
    worked, hit = staffpay.work_minutes(sid, start, now, need)
    extra = f", {queue_n} без ответа" if queue_n > 1 else ""
    if mode == "pool":
        label = f"общая очередь{extra}"
    elif mode == "inbox":
        label = f"взятые обращения{extra}"
    else:
        label = f"обращение №{t['number']} (клиент #{t['user_id']})"
    if hit is None:
        if warn_at is not None and worked >= warn_at and not _marked(tid, mid, sid, "warn"):
            if mode in ("pool", "inbox") and _sentinel_same_wave(tid, sid, "warn", start):
                return
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
