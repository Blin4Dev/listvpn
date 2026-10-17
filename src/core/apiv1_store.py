# API v1: данные и фоновые задачи (тарифы, покупки, очередь выдачи ссылок,
# реферальный леджер, задания, телеметрия сессий). Роуты — в apiv1.py.
from __future__ import annotations

import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

try:
    from . import database as db  # type: ignore
    from . import fulfillment  # type: ignore
    from . import provisioning  # type: ignore
except ImportError:  # pragma: no cover
    import database as db  # type: ignore
    import fulfillment  # type: ignore
    import provisioning  # type: ignore

try:
    import subdomain  # type: ignore  # src/api — домены ссылок подписки
except Exception:  # noqa: BLE001
    subdomain = None  # type: ignore


def _log(msg: str) -> None:
    print(f"[api-v1] {msg}", flush=True)


def _report(title: str, detail: str) -> None:
    try:
        try:
            from . import forum  # type: ignore
        except ImportError:
            import forum  # type: ignore
        forum.report_error(title, detail)
    except Exception:  # noqa: BLE001
        pass


# ── время ──

def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def parse_iso(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def iso_z(value: Any) -> Optional[str]:
    """«2030-01-01T00:00:00Z» — формат дат в ответах API v1."""
    dt = parse_iso(value)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def _num(v: Any) -> Any:
    f = round(float(v or 0), 2)
    return int(f) if f.is_integer() else f


# ── инициализация (один раз на процесс) ──

_ensured = False
_ensure_lock = threading.Lock()


def ensure() -> None:
    global _ensured
    if _ensured:
        return
    with _ensure_lock:
        if _ensured:
            return
        db.init_db()
        for step in (sync_tariffs, seed_tasks, backfill_purchases, backfill_ledger):
            try:
                step()
            except Exception as exc:  # noqa: BLE001
                _log(f"init {step.__name__}: {type(exc).__name__}: {exc}")
        _ensured = True


# ═════════════════════════ тарифы ═════════════════════════

_TITLES = {1: "1 месяц", 3: "3 месяца", 6: "6 месяцев", 12: "12 месяцев"}


def tariff_code(months: int) -> str:
    return f"m{int(months)}"


def sync_tariffs() -> None:
    """tariffs ← цены периодов из панели (настройки period_price_N).
    Название и is_active, изменённые вручную в БД, не перетираются."""
    ts = db.utcnow_iso()
    for i, m in enumerate(fulfillment.SUB_PERIODS):
        db.execute(
            "INSERT INTO tariffs (code, title, price, currency, period_days, months, is_active, sort_order, updated_at) "
            "VALUES (?, ?, ?, 'RUB', ?, ?, 1, ?, ?) "
            "ON CONFLICT(code) DO UPDATE SET price = excluded.price, period_days = excluded.period_days, "
            "months = excluded.months, updated_at = excluded.updated_at",
            (tariff_code(m), _TITLES.get(m, f"{m} мес."), float(fulfillment.period_price(m)),
             int(fulfillment.period_days(m)), int(m), i, ts),
        )


def list_tariffs() -> list[dict[str, Any]]:
    rows = db.fetchall(
        "SELECT code, title, price, currency, period_days FROM tariffs WHERE is_active = 1 "
        "ORDER BY sort_order, period_days, code"
    )
    return [{"code": r["code"], "title": r["title"], "price": _num(r["price"]),
             "currency": r["currency"] or "RUB", "period_days": int(r["period_days"])} for r in rows]


# ═════════════════════════ покупки ═════════════════════════

def _purchase_code(p: dict[str, Any]) -> str:
    purpose = p.get("purpose") or "subscription"
    months = int(p.get("months") or 1)
    if purpose in ("subscription", "extend"):
        return f"wl{months}" if p.get("whitelist") else tariff_code(months)
    return str(purpose)


def record_purchase(payment_id: str, grant: Optional[dict[str, Any]] = None) -> None:
    p = db.fetchone("SELECT * FROM payments WHERE payment_id = ?", (payment_id,))
    if not p or p.get("status") != "paid":
        return
    db.execute(
        "INSERT OR IGNORE INTO purchases (payment_id, user_id, tariff_code, purpose, amount, currency, provider, "
        "provider_payment_id, subscription_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (p["payment_id"], int(p["user_id"]), _purchase_code(p), p.get("purpose") or "subscription",
         float(p.get("amount") or 0), p.get("currency") or "RUB", p.get("provider"), p.get("provider_payment_id"),
         (grant or {}).get("subscription_id") or p.get("subscription_id"), (grant or {}).get("expires_at"),
         p.get("paid_at") or db.utcnow_iso()),
    )


def on_payment_fulfilled(payment_id: str, grant: dict[str, Any]) -> None:
    """хук из fulfillment.fulfill_payment после успешной оплаты (любой провайдер):
    запись в purchases + задача на выдачу ключа, если Remnawave сейчас не ответил."""
    try:
        record_purchase(payment_id, grant)
    except Exception as exc:  # noqa: BLE001
        _log(f"purchase {payment_id}: {exc}")
    rw = grant.get("remnawave") or {}
    sub_id = grant.get("subscription_id")
    if sub_id and not rw.get("ok") and provisioning.is_configured():
        sub = db.fetchone("SELECT user_id FROM subscriptions WHERE id = ?", (int(sub_id),))
        if sub:
            enqueue_provisioning(int(sub["user_id"]), int(sub_id), "payment", payment_id=payment_id, delay=5)


def backfill_purchases() -> None:
    if db.get_setting("apiv1_purchases_backfill") == "1":
        return
    db.execute(
        "INSERT OR IGNORE INTO purchases (payment_id, user_id, tariff_code, purpose, amount, currency, provider, "
        "provider_payment_id, subscription_id, expires_at, created_at) "
        "SELECT payment_id, user_id, "
        "  CASE WHEN COALESCE(purpose, 'subscription') IN ('subscription', 'extend') "
        "       THEN (CASE WHEN COALESCE(whitelist, 0) = 1 THEN 'wl' ELSE 'm' END) || COALESCE(months, 1) "
        "       ELSE purpose END, "
        "  COALESCE(purpose, 'subscription'), COALESCE(amount, 0), COALESCE(currency, 'RUB'), provider, "
        "  provider_payment_id, subscription_id, NULL, COALESCE(paid_at, created_at) "
        "FROM payments WHERE status = 'paid'"
    )
    db.set_setting("apiv1_purchases_backfill", "1")


# ═════════════════════════ подписка: текущее состояние ═════════════════════════

RETRY_AFTER_SECONDS = 3


def current_subscription(user_id: int) -> Optional[dict[str, Any]]:
    """подписка, которую показываем в API: заблокированная → живая с самым дальним сроком → последняя истёкшая."""
    rows = db.fetchall(
        "SELECT * FROM subscriptions WHERE user_id = ? AND status != 'Deleted' ORDER BY id DESC", (int(user_id),)
    )
    if not rows:
        return None
    banned = next((r for r in rows if r.get("status") == "Banned"), None)
    if banned:
        return banned
    far = datetime.max.replace(tzinfo=timezone.utc)
    t = now()

    def _exp(r: dict[str, Any]) -> datetime:
        return parse_iso(r.get("expires_at")) or (far if not r.get("expires_at") else t)

    live = [r for r in rows if r.get("status") == "Active" and _exp(r) > t]
    if live:
        return max(live, key=_exp)
    return max(rows, key=_exp)


def pending_job(user_id: int) -> Optional[dict[str, Any]]:
    return db.fetchone(
        "SELECT * FROM provisioning_jobs WHERE user_id = ? AND status IN ('queued', 'running') "
        "ORDER BY run_after LIMIT 1", (int(user_id),),
    )


def subscription_url(sub: dict[str, Any]) -> Optional[str]:
    cfg = str(sub.get("key_config") or "").strip()
    url = cfg if cfg.startswith(("http://", "https://")) else None
    if not url:
        base = (os.getenv("REMWAVE_SUB_PUBLIC_URL") or "").strip()
        if base and sub.get("short_uuid"):
            url = f"{base.rstrip('/')}/api/sub/{sub['short_uuid']}"
    if url and subdomain is not None:
        try:
            url = subdomain.vpn(url)
        except Exception:  # noqa: BLE001
            pass
    return url or None


def state_of(user: dict[str, Any], sub: dict[str, Any]) -> str:
    if user.get("is_banned") or sub.get("status") == "Banned" or sub.get("frozen_at"):
        return "disabled"
    if pending_job(int(user["id"])):
        return "provisioning"
    exp = parse_iso(sub.get("expires_at"))
    if sub.get("status") == "Active" and (not sub.get("expires_at") or (exp and exp > now())):
        return "active"
    return "expired"


def subscription_payload(user: dict[str, Any], sub: Optional[dict[str, Any]] = None) -> Optional[dict[str, Any]]:
    """объект подписки в формате GET /subscription (None — подписок нет)."""
    sub = sub or current_subscription(int(user["id"]))
    if not sub:
        return None
    st = state_of(user, sub)
    retry = None
    if st == "provisioning":
        job = pending_job(int(user["id"])) or {}
        due = parse_iso(job.get("run_after"))
        wait = int((due - now()).total_seconds()) + 1 if due else 0
        retry = max(RETRY_AFTER_SECONDS, wait)
    return {
        "state": st,
        "expires_at": iso_z(sub.get("expires_at")),
        "subscription_url": subscription_url(sub) if st in ("active", "expired") else None,
        "retry_after_seconds": retry,
    }


def extend_subscription(sub: dict[str, Any], days: int) -> None:
    """+days к сроку в БД (от текущего срока или от сейчас, если истекла). Remnawave — через очередь."""
    if not sub.get("expires_at"):
        return  # бессрочная
    base = parse_iso(sub.get("expires_at")) or now()
    base = max(base, now())
    db.execute(
        "UPDATE subscriptions SET expires_at = ?, status = 'Active' WHERE id = ? AND status IN ('Active', 'Expired')",
        (iso(base + timedelta(days=int(days))), int(sub["id"])),
    )
    fulfillment._sync_user_status(int(sub["user_id"]))


# ═════════════════════════ очередь выдачи (provisioning_jobs) ═════════════════════════

MAX_ATTEMPTS = 6
BACKOFF_SEC = (5, 15, 30, 60, 120)
STUCK_RUNNING_SEC = 300
POLL_SEC = 2.0

_wake = threading.Event()
_worker_started = False
_worker_lock = threading.Lock()


def enqueue_provisioning(user_id: int, subscription_id: Optional[int], reason: str,
                         payment_id: Optional[str] = None, delay: int = 0) -> int:
    """одна активная задача на пользователя (в Remnawave у пользователя одна учётка)."""
    run_after = iso(now() + timedelta(seconds=max(0, int(delay))))
    with db.transaction() as conn:
        row = conn.execute(
            "SELECT id FROM provisioning_jobs WHERE user_id = ? AND status = 'queued' ORDER BY id LIMIT 1",
            (int(user_id),),
        ).fetchone()
        if row:
            jid = int(row["id"])
            conn.execute("UPDATE provisioning_jobs SET run_after = MIN(run_after, ?), "
                         "subscription_id = COALESCE(?, subscription_id) WHERE id = ?",
                         (run_after, subscription_id, jid))
        else:
            cur = conn.execute(
                "INSERT INTO provisioning_jobs (user_id, subscription_id, reason, status, attempts, run_after, "
                "payment_id, created_at) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)",
                (int(user_id), subscription_id, reason, run_after, payment_id, db.utcnow_iso()),
            )
            jid = int(cur.lastrowid)
        conn.execute("UPDATE subscriptions SET sync_state = 'provisioning' "
                     "WHERE user_id = ? AND status != 'Deleted'", (int(user_id),))
    _wake.set()
    return jid


def sync_user_to_panel(user_id: int) -> dict[str, Any]:
    """записать в Remnawave текущее состояние подписки из БД и забрать свежую ссылку."""
    user = fulfillment.get_user(int(user_id))
    if not user:
        return {"ok": True, "skipped": "user_deleted"}
    sub = current_subscription(int(user_id))
    if not sub:
        return {"ok": True, "skipped": "no_subscription"}
    if user.get("is_banned") or sub.get("status") == "Banned" or sub.get("frozen_at"):
        return {"ok": True, "skipped": "disabled"}
    if sub.get("grace_until"):
        return {"ok": True, "skipped": "grace"}  # grace.py сам ведёт пользователя в панели
    if not provisioning.is_configured():
        return {"ok": True, "skipped": "remnawave_not_configured"}
    expire = parse_iso(sub.get("expires_at")) or (now() + timedelta(days=36500))
    trial = sub.get("type") == "trial"
    prov = provisioning.provision(
        user_id=int(user["id"]),
        telegram_id=int(user["telegram_id"]) if user.get("telegram_id") else None,
        username=user.get("username"), email=user.get("email"),
        expire_at=expire, devices=max(1, int(sub.get("devices_limit") or 1)),
        squads=fulfillment.trial_squads() if trial else fulfillment.squads_for_sub(sub),
        traffic_limit_bytes=int(sub.get("traffic_limit") or 0) * fulfillment.GB,
        traffic_reset_strategy=fulfillment.RESET_STRATEGY,
    )
    if not prov.get("ok"):
        return {"ok": False, "error": prov.get("error") or "remnawave_failed"}
    fulfillment._apply_provision_to_sub(sub, prov)
    return {"ok": True, "subscription_url": prov.get("subscription_url")}


def _finish(job: dict[str, Any], status: str, error: Optional[str] = None) -> None:
    uid = int(job["user_id"])
    with db.transaction() as conn:
        conn.execute("UPDATE provisioning_jobs SET status = ?, last_error = ?, finished_at = ? WHERE id = ?",
                     (status, error, db.utcnow_iso(), int(job["id"])))
        still = conn.execute("SELECT 1 FROM provisioning_jobs WHERE user_id = ? AND status IN ('queued', 'running') "
                             "LIMIT 1", (uid,)).fetchone()
        if not still:
            conn.execute("UPDATE subscriptions SET sync_state = ? WHERE user_id = ? AND sync_state = 'provisioning'",
                         (None if status == "done" else "failed", uid))


def _run_job(job: dict[str, Any]) -> None:
    try:
        res = sync_user_to_panel(int(job["user_id"]))
    except Exception as exc:  # noqa: BLE001
        res = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    if res.get("ok"):
        _finish(job, "done")
        return
    err = str(res.get("error") or "unknown")[:500]
    attempts = int(job.get("attempts") or 1)
    if attempts >= MAX_ATTEMPTS:
        _finish(job, "failed", err)
        _report("API v1: ссылка в Remnawave не выдана",
                f"user id{job['user_id']}, задача #{job['id']} ({job.get('reason')}), {attempts} попыток: {err}")
        return
    delay = BACKOFF_SEC[min(attempts - 1, len(BACKOFF_SEC) - 1)]
    db.execute("UPDATE provisioning_jobs SET status = 'queued', last_error = ?, run_after = ? WHERE id = ?",
               (err, iso(now() + timedelta(seconds=delay)), int(job["id"])))


def run_due_jobs(limit: int = 10) -> int:
    stuck = iso(now() - timedelta(seconds=STUCK_RUNNING_SEC))
    db.execute("UPDATE provisioning_jobs SET status = 'queued' WHERE status = 'running' AND started_at < ?", (stuck,))
    rows = db.fetchall("SELECT id FROM provisioning_jobs WHERE status = 'queued' AND run_after <= ? "
                       "ORDER BY run_after, id LIMIT ?", (iso(now()), int(limit)))
    done = 0
    for r in rows:
        claim = db.execute("UPDATE provisioning_jobs SET status = 'running', attempts = attempts + 1, started_at = ? "
                           "WHERE id = ? AND status = 'queued'", (db.utcnow_iso(), int(r["id"])))
        if claim.rowcount != 1:
            continue  # забрал другой процесс
        job = db.fetchone("SELECT * FROM provisioning_jobs WHERE id = ?", (int(r["id"]),))
        if job:
            _run_job(job)
            done += 1
    return done


def _worker_loop() -> None:
    _log("воркер очереди выдачи запущен")
    while True:
        n = 0
        try:
            n = run_due_jobs()
        except Exception as exc:  # noqa: BLE001
            _log(f"воркер: {type(exc).__name__}: {exc}")
        if n:
            continue
        _wake.wait(POLL_SEC)
        _wake.clear()


def start_worker() -> None:
    global _worker_started
    with _worker_lock:
        if _worker_started:
            return
        _worker_started = True
    threading.Thread(target=_worker_loop, name="apiv1-provisioning", daemon=True).start()


# ═════════════════════════ реферальный леджер ═════════════════════════

def ledger_add(conn: Any, user_id: int, kind: str, amount: float, *, ref_user_id: Optional[int] = None,
               payment_id: Optional[str] = None, withdrawal_id: Optional[int] = None,
               note: Optional[str] = None) -> None:
    """запись в леджер в уже открытой транзакции (conn из db.transaction())."""
    conn.execute(
        "INSERT INTO referral_ledger (user_id, kind, amount, ref_user_id, payment_id, withdrawal_id, note, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (int(user_id), kind, round(float(amount), 2), ref_user_id, payment_id, withdrawal_id, note, db.utcnow_iso()),
    )


def reconcile_ledger(conn: Any, user_id: int, kind: str = "adjustment") -> float:
    """леджер ↔ users.partner_balance. Баланс меняют и старые места (панель, возвраты, оплата
    реф. балансом) — расхождение фиксируем строкой adjustment. Возвращает баланс по леджеру."""
    u = conn.execute("SELECT partner_balance FROM users WHERE id = ?", (int(user_id),)).fetchone()
    if not u:
        return 0.0
    bal = round(float(u["partner_balance"] or 0), 2)
    s = conn.execute("SELECT COALESCE(SUM(amount), 0) AS s FROM referral_ledger WHERE user_id = ?",
                     (int(user_id),)).fetchone()
    led = round(float(s["s"] or 0), 2)
    diff = round(bal - led, 2)
    if abs(diff) >= 0.01:
        ledger_add(conn, user_id, kind, diff, note="сверка с users.partner_balance")
    return bal


def ledger_balance(user_id: int) -> float:
    with db.transaction() as conn:
        return reconcile_ledger(conn, user_id)


def backfill_ledger() -> None:
    """один раз: история из transactions / withdrawals + опорный остаток до текущего partner_balance."""
    if db.get_setting("apiv1_ledger_backfill") == "1":
        return
    with db.transaction() as conn:
        if conn.execute("SELECT 1 FROM referral_ledger LIMIT 1").fetchone() is None:
            conn.execute(
                "INSERT INTO referral_ledger (user_id, kind, amount, payment_id, note, created_at) "
                "SELECT user_id, CASE payment_method WHEN 'referral' THEN 'accrual' ELSE 'reversal' END, amount, "
                "  CASE WHEN payment_method = 'referral' AND hash LIKE 'pay:%' THEN substr(hash, 5) "
                "       WHEN payment_method = 'referral_reversal' THEN payment_id END, description, created_at "
                "FROM transactions WHERE user_id IS NOT NULL AND status = 'completed' "
                "AND payment_method IN ('referral', 'referral_reversal') ORDER BY id"
            )
            conn.execute(
                "INSERT INTO referral_ledger (user_id, kind, amount, withdrawal_id, created_at) "
                "SELECT user_id, 'withdrawal', -amount, id, created_at FROM withdrawals ORDER BY id"
            )
            conn.execute(
                "INSERT INTO referral_ledger (user_id, kind, amount, withdrawal_id, created_at) "
                "SELECT user_id, 'withdrawal_refund', amount, id, COALESCE(processed_at, created_at) "
                "FROM withdrawals WHERE status = 'rejected' AND COALESCE(refunded, 0) = 1 ORDER BY id"
            )
            ts = db.utcnow_iso()
            conn.execute(
                "INSERT INTO referral_ledger (user_id, kind, amount, note, created_at) "
                "SELECT u.id, 'opening_balance', ROUND(COALESCE(u.partner_balance, 0) - COALESCE(l.s, 0), 2), "
                "  'остаток при переходе на леджер', ? "
                "FROM users u LEFT JOIN (SELECT user_id, SUM(amount) AS s FROM referral_ledger GROUP BY user_id) l "
                "  ON l.user_id = u.id "
                "WHERE ABS(COALESCE(u.partner_balance, 0) - COALESCE(l.s, 0)) >= 0.01",
                (ts,),
            )
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('apiv1_ledger_backfill', '1')")


# ═════════════════════════ задания ═════════════════════════

TASK_KINDS = ("channel", "vpn_minutes", "referrals", "manual")
CHANNEL_RECHECK_SEC = 60
_MEMBER = {"creator", "administrator", "member", "restricted"}


def seed_tasks() -> None:
    if db.get_setting("apiv1_tasks_seeded") == "1":
        return
    ts = db.utcnow_iso()
    if not db.fetchone("SELECT 1 FROM tasks LIMIT 1"):
        db.executemany(
            "INSERT OR IGNORE INTO tasks (code, title, description, kind, target, channel_id, url, reward_days, "
            "is_active, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
            [
                ("channel", "Подпишись на канал", "Подпишитесь на наш Telegram-канал", "channel", 1,
                 (os.getenv("REQUIRED_CHANNEL_ID") or "").strip() or None,
                 (os.getenv("REQUIRED_CHANNEL_URL") or "").strip() or None, 3, 1, ts),
                ("vpn_15m", "Проведи 15 минут в VPN", "Будьте подключены к VPN 15 минут", "vpn_minutes", 15,
                 None, None, 1, 2, ts),
            ],
        )
    db.set_setting("apiv1_tasks_seeded", "1")


def get_task(task_id: int) -> Optional[dict[str, Any]]:
    return db.fetchone("SELECT * FROM tasks WHERE id = ? AND is_active = 1", (int(task_id),))


def vpn_seconds(user_id: int) -> int:
    row = db.fetchone("SELECT COALESCE(SUM(active_seconds), 0) AS s FROM vpn_sessions WHERE user_id = ?",
                      (int(user_id),))
    return int((row or {}).get("s") or 0)


def _progress(user: dict[str, Any], task: dict[str, Any], ut: Optional[dict[str, Any]]) -> tuple[bool, int]:
    """(выполнено?, текущее значение) — по фактическим данным."""
    kind, target = task.get("kind"), max(1, int(task.get("target") or 1))
    uid = int(user["id"])
    if kind == "vpn_minutes":
        cur = vpn_seconds(uid) // 60
        return cur >= target, min(cur, target)
    if kind == "referrals":
        row = db.fetchone("SELECT COUNT(*) AS c FROM users WHERE referred_by = ?", (uid,))
        cur = int((row or {}).get("c") or 0)
        return cur >= target, min(cur, target)
    if kind == "channel":
        tg = user.get("telegram_id")
        chan = (task.get("channel_id") or os.getenv("REQUIRED_CHANNEL_ID") or "").strip()
        if not tg or not chan:
            return False, 0
        checked = parse_iso((ut or {}).get("checked_at"))
        if checked and (now() - checked).total_seconds() < CHANNEL_RECHECK_SEC:
            return False, 0
        db.execute("INSERT INTO user_tasks (user_id, task_id, status, checked_at) VALUES (?, ?, 'active', ?) "
                   "ON CONFLICT(user_id, task_id) DO UPDATE SET checked_at = excluded.checked_at",
                   (uid, int(task["id"]), db.utcnow_iso()))
        try:
            try:
                from . import notifier  # type: ignore
            except ImportError:
                import notifier  # type: ignore
            st = notifier.get_chat_member_status(chan, int(tg))
        except Exception:  # noqa: BLE001
            st = None
        ok = st in _MEMBER  # не смогли проверить → не засчитываем (награда — fail-closed)
        return ok, 1 if ok else 0
    return False, 0  # manual: отмечает админ (user_tasks.status = 'completed')


def evaluate_task(user: dict[str, Any], task: dict[str, Any]) -> dict[str, Any]:
    uid, tid = int(user["id"]), int(task["id"])
    target = max(1, int(task.get("target") or 1))
    ut = db.fetchone("SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?", (uid, tid))
    st = (ut or {}).get("status") or "active"
    if st in ("claimed", "completed"):
        return {"status": st, "progress": target}
    done, cur = _progress(user, task, ut)
    if done:
        db.execute("INSERT INTO user_tasks (user_id, task_id, status, completed_at) VALUES (?, ?, 'completed', ?) "
                   "ON CONFLICT(user_id, task_id) DO UPDATE SET status = 'completed', "
                   "completed_at = excluded.completed_at WHERE user_tasks.status = 'active'",
                   (uid, tid, db.utcnow_iso()))
        return {"status": "completed", "progress": target}
    return {"status": "active", "progress": cur}


def list_tasks(user: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for t in db.fetchall("SELECT * FROM tasks WHERE is_active = 1 ORDER BY sort_order, id"):
        ev = evaluate_task(user, t)
        out.append({
            "id": int(t["id"]), "title": t["title"], "reward_days": int(t["reward_days"] or 0),
            "status": ev["status"],
            # дополнительно к спецификации: для отрисовки прогресса и кнопки
            "progress": ev["progress"], "target": max(1, int(t.get("target") or 1)), "url": t.get("url"),
        })
    return out


def mark_claimed(user_id: int, task_id: int) -> bool:
    cur = db.execute("UPDATE user_tasks SET status = 'claimed', claimed_at = ? "
                     "WHERE user_id = ? AND task_id = ? AND status = 'completed'",
                     (db.utcnow_iso(), int(user_id), int(task_id)))
    return cur.rowcount == 1


def unmark_claimed(user_id: int, task_id: int) -> None:
    db.execute("UPDATE user_tasks SET status = 'completed', claimed_at = NULL "
               "WHERE user_id = ? AND task_id = ? AND status = 'claimed'", (int(user_id), int(task_id)))


# ═════════════════════════ телеметрия сессий ═════════════════════════

# клиент шлёт запрос при подключении, затем раз в 1–5 мин и при отключении.
# промежуток между соседними запросами засчитывается, если он не больше часа
# (больше — считаем, что VPN был выключен, и отсчёт начинается заново)
HEARTBEAT_MAX_GAP_SEC = 3600


def session_heartbeat(user_id: int, session_id: str, node_name: str) -> None:
    """засчитанное время = промежуток от последнего heartbeat пользователя (по ЛЮБОЙ его сессии),
    не больше HEARTBEAT_MAX_GAP_SEC — параллельные сессии не умножают время."""
    t = now()
    ts = iso(t)
    with db.transaction() as conn:
        last = conn.execute("SELECT MAX(last_seen_at) AS m FROM vpn_sessions WHERE user_id = ?",
                            (int(user_id),)).fetchone()
        prev = parse_iso(last["m"]) if last else None
        credit = 0
        if prev:
            gap = (t - prev).total_seconds()
            # засчитываем только непрерывное подключение: после долгого разрыва отсчёт заново
            credit = int(gap) if 0 < gap <= HEARTBEAT_MAX_GAP_SEC else 0
        conn.execute(
            "INSERT INTO vpn_sessions (user_id, session_id, node_name, started_at, last_seen_at, active_seconds, "
            "heartbeats) VALUES (?, ?, ?, ?, ?, ?, 1) "
            "ON CONFLICT(user_id, session_id) DO UPDATE SET node_name = excluded.node_name, "
            "last_seen_at = excluded.last_seen_at, active_seconds = vpn_sessions.active_seconds + ?, "
            "heartbeats = vpn_sessions.heartbeats + 1",
            (int(user_id), session_id, node_name, ts, ts, credit, credit),
        )
