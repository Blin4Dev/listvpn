"""Реферальные уровни, бесплатная подписка и подарки друзьям.

Уровень считается по числу АКТИВНЫХ рефералов — приглашённых,
у которых сейчас есть действующая платная подписка (не пробная).
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

try:
    from . import database as db  # type: ignore
except ImportError:
    import database as db  # type: ignore


# ключ, название, от скольки активных, % с платежей, подарков в месяц, бесплатная подписка себе
LEVELS: list[dict[str, Any]] = [
    {"key": "starter", "name": "Starter", "min": 0, "rate": 20, "gifts": 0, "self_free_from": 5},
    {"key": "spreader", "name": "Spreader", "min": 30, "rate": 25, "gifts": 1, "self_free_from": 0},
    {"key": "special", "name": "Special", "min": 50, "rate": 30, "gifts": 2, "self_free_from": 0},
    {"key": "greater", "name": "Greater", "min": 100, "rate": 35, "gifts": 3, "self_free_from": 0},
    {"key": "gen_s", "name": "Gen S", "min": 1000, "rate": 50, "gifts": 10, "self_free_from": 0},
]

# награды раз в 30 дней (скользящее окно)
REWARD_WINDOW_DAYS = 30
# срок подписки в награде / подарке (месяцев тарифа)
REWARD_MONTHS = 1
GIFT_PREFIX = "GIFT-"

SCHEMA = """
CREATE TABLE IF NOT EXISTS referral_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,              -- self | gift | bought (куплен за деньги)
    code TEXT UNIQUE,                -- код подарка
    status TEXT NOT NULL DEFAULT 'issued',  -- issued | redeemed | failed
    created_at TEXT NOT NULL,
    redeemed_by INTEGER,
    redeemed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ref_rewards_user ON referral_rewards(user_id, kind, created_at);
"""

_schema_ready = False


def _ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    conn = db.connect()
    conn.executescript(SCHEMA)
    rcols = {r[1] for r in conn.execute("PRAGMA table_info(referral_rewards)").fetchall()}
    if "months" not in rcols:
        conn.execute("ALTER TABLE referral_rewards ADD COLUMN months INTEGER NOT NULL DEFAULT 1")
    if "whitelist" not in rcols:
        conn.execute("ALTER TABLE referral_rewards ADD COLUMN whitelist INTEGER NOT NULL DEFAULT 1")
    if "payment_id" not in rcols:
        conn.execute("ALTER TABLE referral_rewards ADD COLUMN payment_id TEXT")
    # подарки из панели (kind = 'admin'): пачка, заметка, срок действия кода, один код на человека
    for col, ddl in (("batch", "TEXT"), ("note", "TEXT"), ("expires_at", "TEXT"), ("one_per_user", "INTEGER NOT NULL DEFAULT 0")):
        if col not in rcols:
            conn.execute(f"ALTER TABLE referral_rewards ADD COLUMN {col} {ddl}")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ref_rewards_batch ON referral_rewards(batch)")
    conn.commit()
    cols = {r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "partner_rate_custom" not in cols:
        # индивидуальная ставка из панели важнее уровня; старые ручные ставки (≠25) считаем индивидуальными
        conn.execute("ALTER TABLE users ADD COLUMN partner_rate_custom INTEGER NOT NULL DEFAULT 0")
        conn.execute("UPDATE users SET partner_rate_custom = 1 WHERE partner_rate IS NOT NULL AND partner_rate != 25")
        conn.commit()
    _schema_ready = True


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _parse(v: Optional[str]) -> Optional[datetime]:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# ── счёт рефералов и уровень ──

def active_referrals(user_id: int) -> int:
    # от приглашённых (индекс по referred_by) к их подпискам (индекс по user_id), а не перебор всех
    # активных подписок сервиса; «+» у status/expires_at не даёт sqlite взять индекс (status, expires_at)
    row = db.fetchone(
        "SELECT COUNT(*) AS c FROM users u WHERE u.referred_by = ? AND EXISTS ("
        "SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND +s.status = 'Active' "
        "AND s.type != 'trial' AND +s.expires_at IS NOT NULL AND +s.expires_at > ?)",
        (int(user_id), _iso(_now())),
    )
    return int((row or {}).get("c") or 0)


def invited_referrals(user_id: int) -> int:
    row = db.fetchone("SELECT COUNT(*) AS c FROM users WHERE referred_by = ?", (int(user_id),))
    return int((row or {}).get("c") or 0)


def level_for(active: int) -> dict[str, Any]:
    cur = LEVELS[0]
    for lv in LEVELS:
        if active >= lv["min"]:
            cur = lv
    return cur


def next_level(active: int) -> Optional[dict[str, Any]]:
    return next((lv for lv in LEVELS if lv["min"] > active), None)


def self_free_eligible(level: dict[str, Any], active: int) -> bool:
    need = int(level.get("self_free_from") or 0)
    return active >= need if need else True


def effective_rate(user: dict[str, Any], active: Optional[int] = None) -> float:
    """% с платежей рефералов: индивидуальная ставка из панели или ставка уровня."""
    _ensure_schema()
    if user.get("partner_rate_custom"):
        try:
            return float(user.get("partner_rate") or 0)
        except (TypeError, ValueError):
            pass
    if active is None:
        active = active_referrals(int(user["id"]))
    return float(level_for(active)["rate"])


# ── заработок ──

def earnings(user_id: int) -> dict[str, float]:
    """заработано всего и за текущий месяц (бонусы минус возвраты)."""
    month_start = _now().astimezone(timezone(timedelta(hours=3))).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    row = db.fetchone(
        "SELECT COALESCE(SUM(amount), 0) AS t, COALESCE(SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END), 0) AS m "
        "FROM transactions WHERE user_id = ? AND payment_method IN ('referral', 'referral_reversal') "
        "AND status = 'completed'",
        (_iso(month_start), int(user_id)),
    ) or {}
    return {"total": round(max(0.0, float(row.get("t") or 0)), 2), "month": round(float(row.get("m") or 0), 2)}


# ── награды ──

def _recent(user_id: int, kind: str) -> list[dict[str, Any]]:
    since = _iso(_now() - timedelta(days=REWARD_WINDOW_DAYS))
    return db.fetchall(
        "SELECT * FROM referral_rewards WHERE user_id = ? AND kind = ? AND status != 'failed' AND created_at >= ? "
        "ORDER BY created_at ASC",
        (int(user_id), kind, since),
    )


def _next_at(rows: list[dict[str, Any]]) -> Optional[str]:
    if not rows:
        return None
    first = _parse(rows[0]["created_at"])
    return _iso(first + timedelta(days=REWARD_WINDOW_DAYS)) if first else None


def rewards_state(user: dict[str, Any], active: Optional[int] = None) -> dict[str, Any]:
    _ensure_schema()
    uid = int(user["id"])
    if active is None:
        active = active_referrals(uid)
    lv = level_for(active)
    self_rows = _recent(uid, "self")
    gift_rows = _recent(uid, "gift")
    eligible = self_free_eligible(lv, active)
    gifts_limit = int(lv["gifts"])
    gifts = db.fetchall(
        "SELECT code, status, created_at, redeemed_at FROM referral_rewards WHERE user_id = ? AND kind = 'gift' "
        "AND status != 'failed' ORDER BY id DESC LIMIT 20",
        (uid,),
    )
    return {
        "self": {
            "eligible": eligible,
            "available": eligible and not self_rows,
            "need_active": int(lv.get("self_free_from") or 0),
            "next_at": _next_at(self_rows) if self_rows else None,
        },
        "gifts": {
            "per_month": gifts_limit,
            "left": max(0, gifts_limit - len(gift_rows)),
            "next_at": _next_at(gift_rows) if gift_rows and len(gift_rows) >= gifts_limit else None,
            "items": [dict(g) for g in gifts],
        },
    }


class RewardError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _grant_month(user: dict[str, Any], months: int = REWARD_MONTHS, whitelist: bool = True) -> dict[str, Any]:
    """тариф на months (+ белые списки, если настроены и положены)."""
    try:
        from . import fulfillment  # type: ignore
    except ImportError:
        import fulfillment  # type: ignore
    return fulfillment.grant_subscription(
        user=user,
        purpose="subscription",
        plan_devices=fulfillment.tariff_devices(),
        months=int(months or 1),
        extra_devices=0,
        subscription_id=None,
        whitelist=bool(whitelist) and fulfillment.whitelist_available(),
    )


def create_bought_gift(user_id: int, months: int, payment_id: Optional[str], whitelist: bool = False) -> str:
    """подарок, купленный за деньги: код на тариф months (с белыми списками — если купили анти-тариф)."""
    _ensure_schema()
    if payment_id:
        old = db.fetchone("SELECT code FROM referral_rewards WHERE payment_id = ? AND kind = 'bought'", (payment_id,))
        if old:
            return str(old["code"])
    code = GIFT_PREFIX + secrets.token_hex(4).upper()
    db.execute(
        "INSERT INTO referral_rewards (user_id, kind, code, status, created_at, months, whitelist, payment_id) "
        "VALUES (?, 'bought', ?, 'issued', ?, ?, ?, ?)",
        (int(user_id), code, _iso(_now()), int(months or 1), 1 if whitelist else 0, payment_id),
    )
    return code


def bought_gifts(user_id: int) -> list[dict[str, Any]]:
    _ensure_schema()
    return [dict(r) for r in db.fetchall(
        "SELECT code, status, months, created_at, redeemed_at FROM referral_rewards "
        "WHERE user_id = ? AND kind = 'bought' AND status != 'revoked' ORDER BY id DESC LIMIT 30",
        (int(user_id),),
    )]


def my_gifts(user_id: int) -> list[dict[str, Any]]:
    """все подарки пользователя: купленные и полученные за уровень."""
    _ensure_schema()
    return [dict(r) for r in db.fetchall(
        "SELECT code, kind, status, months, whitelist, created_at, redeemed_at FROM referral_rewards "
        "WHERE user_id = ? AND kind IN ('bought', 'gift') AND status IN ('issued', 'redeemed') "
        "ORDER BY CASE status WHEN 'issued' THEN 0 ELSE 1 END, id DESC LIMIT 50",
        (int(user_id),),
    )]


def revoke_bought_gift(payment_id: str) -> Optional[str]:
    """возврат денег за подарок: неактивированный код гасим; вернуть статус."""
    _ensure_schema()
    row = db.fetchone("SELECT id, status FROM referral_rewards WHERE payment_id = ? AND kind = 'bought'", (payment_id,))
    if not row:
        return None
    if row["status"] == "issued":
        db.execute("UPDATE referral_rewards SET status = 'revoked' WHERE id = ?", (row["id"],))
        return "revoked"
    return str(row["status"])


def claim_self(user: dict[str, Any]) -> dict[str, Any]:
    """бесплатная личная подписка на месяц (ВПН + обход), раз в 30 дней."""
    _ensure_schema()
    uid = int(user["id"])
    st = rewards_state(user)["self"]
    if not st["eligible"]:
        raise RewardError(f"Нужно {st['need_active']} активных друзей")
    if not st["available"]:
        raise RewardError("Бесплатную подписку уже получали в этом месяце")
    cur = db.execute(
        "INSERT INTO referral_rewards (user_id, kind, status, created_at) VALUES (?, 'self', 'issued', ?)",
        (uid, _iso(_now())),
    )
    rid = cur.lastrowid
    # гонка двух нажатий: оставляем первую запись
    if len(_recent(uid, "self")) > 1:
        db.execute("DELETE FROM referral_rewards WHERE id = ?", (rid,))
        raise RewardError("Бесплатную подписку уже получали в этом месяце")
    try:
        grant = _grant_month(user)
    except Exception as exc:  # noqa: BLE001
        db.execute("UPDATE referral_rewards SET status = 'failed' WHERE id = ?", (rid,))
        raise RewardError(f"Не удалось выдать подписку: {exc}", 502)
    db.execute("UPDATE referral_rewards SET status = 'redeemed', redeemed_by = ?, redeemed_at = ? WHERE id = ?",
               (uid, _iso(_now()), rid))
    return {"expires_at": grant.get("expires_at")}


def create_gift(user: dict[str, Any]) -> dict[str, Any]:
    """код подарка на месяц для друга; лимит в месяц — по уровню."""
    _ensure_schema()
    uid = int(user["id"])
    st = rewards_state(user)["gifts"]
    if st["per_month"] <= 0:
        raise RewardError("Подарки доступны с уровня Spreader (30 активных друзей)")
    if st["left"] <= 0:
        raise RewardError("Лимит подарков на этот месяц исчерпан")
    code = GIFT_PREFIX + secrets.token_hex(4).upper()
    cur = db.execute(
        "INSERT INTO referral_rewards (user_id, kind, code, status, created_at) VALUES (?, 'gift', ?, 'issued', ?)",
        (uid, code, _iso(_now())),
    )
    if len(_recent(uid, "gift")) > st["per_month"]:
        db.execute("DELETE FROM referral_rewards WHERE id = ?", (cur.lastrowid,))
        raise RewardError("Лимит подарков на этот месяц исчерпан")
    return {"code": code}


def is_gift_code(code: str) -> bool:
    return str(code or "").strip().upper().startswith(GIFT_PREFIX)


def redeem_gift(code: str, user: dict[str, Any]) -> dict[str, Any]:
    """активировать подарок: месяц тарифа + белые списки получателю."""
    _ensure_schema()
    code = str(code or "").strip().upper()
    row = db.fetchone("SELECT * FROM referral_rewards WHERE code = ? AND kind IN ('gift', 'bought', 'admin')", (code,))
    if not row:
        raise RewardError("Подарок не найден", 404)
    if row["status"] == "revoked":
        raise RewardError("Подарок отменён")
    if row["kind"] != "admin" and int(row["user_id"]) == int(user["id"]):
        raise RewardError("Свой подарок активировать нельзя — отправьте код другу")
    exp = _parse_dt(row.get("expires_at"))
    if exp and exp < _now() and row["status"] == "issued":
        raise RewardError("Срок действия подарка истёк")
    uid = int(user["id"])
    with db.transaction() as tx:
        # пачка «один код на человека»: проверка и захват в одной транзакции (без гонок)
        if row["kind"] == "admin" and row.get("one_per_user") and row.get("batch"):
            dup = tx.execute("SELECT 1 FROM referral_rewards WHERE batch = ? AND redeemed_by = ? AND id != ? "
                             "AND status = 'redeemed' LIMIT 1", (row["batch"], uid, row["id"])).fetchone()
            if dup:
                raise RewardError("Вы уже активировали подарок из этой раздачи")
        claim = tx.execute(
            "UPDATE referral_rewards SET status = 'redeemed', redeemed_by = ?, redeemed_at = ? "
            "WHERE id = ? AND status = 'issued'",
            (uid, _iso(_now()), row["id"]),
        )
        if claim.rowcount == 0:
            raise RewardError("Этот подарок уже активирован")
    months = int(row.get("months") or REWARD_MONTHS)
    # единый тариф: любой подарок — ВПН + белые списки (если FURK настроен), даже выпущенный раньше без них
    whitelist = True
    try:
        grant = _grant_month(user, months=months, whitelist=whitelist)
    except Exception as exc:  # noqa: BLE001
        db.execute("UPDATE referral_rewards SET status = 'issued', redeemed_by = NULL, redeemed_at = NULL WHERE id = ?",
                   (row["id"],))
        raise RewardError(f"Не удалось активировать подарок: {exc}", 502)
    return {"expires_at": grant.get("expires_at"), "months": months, "whitelist": whitelist}


def _parse_dt(v: Any) -> Optional[datetime]:
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


# ── подарочные подписки из панели (kind = 'admin') ──
ADMIN_MAX_BATCH = 500


def create_admin_gifts(count: int, months: int, whitelist: bool, note: str = "", valid_days: Optional[int] = None,
                       one_per_user: bool = True) -> dict[str, Any]:
    """пачка одноразовых кодов GIFT-… на тариф months; активируются как обычный подарок."""
    _ensure_schema()
    try:
        from . import fulfillment  # type: ignore
    except ImportError:
        import fulfillment  # type: ignore
    count, months = int(count), int(months)
    if not 1 <= count <= ADMIN_MAX_BATCH:
        raise RewardError(f"Количество: от 1 до {ADMIN_MAX_BATCH}")
    if months not in fulfillment.SUB_PERIODS:
        raise RewardError("Срок: " + ", ".join(str(m) for m in fulfillment.SUB_PERIODS) + " мес.")
    if valid_days is not None and not 1 <= int(valid_days) <= 3650:
        raise RewardError("Срок действия кода: от 1 до 3650 дней")
    note = " ".join(str(note or "").split())[:200]
    now = _now()
    expires = _iso(now + timedelta(days=int(valid_days))) if valid_days else None
    batch = secrets.token_hex(6)
    codes: list[str] = []
    with db.transaction() as tx:
        while len(codes) < count:
            code = GIFT_PREFIX + secrets.token_hex(5).upper()  # 10 символов — перебором не подобрать
            cur = tx.execute(
                "INSERT OR IGNORE INTO referral_rewards (user_id, kind, code, status, created_at, months, whitelist, "
                "batch, note, expires_at, one_per_user) VALUES (0, 'admin', ?, 'issued', ?, ?, ?, ?, ?, ?, ?)",
                (code, _iso(now), months, 1 if whitelist else 0, batch, note or None, expires, 1 if one_per_user else 0))
            if cur.rowcount == 1:
                codes.append(code)
    return {"batch": batch, "codes": codes, "months": months, "whitelist": bool(whitelist), "expires_at": expires}


def _admin_status(r: dict[str, Any]) -> str:
    st = str(r.get("status") or "issued")
    if st == "issued":
        exp = _parse_dt(r.get("expires_at"))
        if exp and exp < _now():
            return "expired"
    return st


def list_admin_gifts(status: str = "", q: str = "", limit: int = 100, offset: int = 0) -> dict[str, Any]:
    _ensure_schema()
    where, args = ["r.kind = 'admin'"], []
    now = _iso(_now())
    if status == "issued":
        where.append("r.status = 'issued' AND (r.expires_at IS NULL OR r.expires_at >= ?)")
        args.append(now)
    elif status == "expired":
        where.append("r.status = 'issued' AND r.expires_at IS NOT NULL AND r.expires_at < ?")
        args.append(now)
    elif status in ("redeemed", "revoked"):
        where.append("r.status = ?")
        args.append(status)
    q = str(q or "").strip()[:64]
    if q:
        where.append("(r.code LIKE ? OR r.note LIKE ? OR r.batch = ? OR CAST(r.redeemed_by AS TEXT) = ? OR u.username LIKE ?)")
        like = f"%{q.upper() if q.upper().startswith(GIFT_PREFIX) else q}%"
        args += [like, f"%{q}%", q, q.lstrip("#"), f"%{q.lstrip('@')}%"]
    w = " AND ".join(where)
    total = db.fetchone(f"SELECT COUNT(*) AS c FROM referral_rewards r LEFT JOIN users u ON u.id = r.redeemed_by WHERE {w}",
                        tuple(args))
    rows = db.fetchall(
        f"SELECT r.*, u.username AS r_username, u.telegram_id AS r_tg FROM referral_rewards r "
        f"LEFT JOIN users u ON u.id = r.redeemed_by WHERE {w} ORDER BY r.id DESC LIMIT ? OFFSET ?",
        tuple(args) + (max(1, min(500, int(limit))), max(0, int(offset))))
    stats = {k: 0 for k in ("issued", "redeemed", "expired", "revoked")}
    for r in db.fetchall("SELECT status, expires_at FROM referral_rewards WHERE kind = 'admin'"):
        stats[_admin_status(r)] = stats.get(_admin_status(r), 0) + 1
    return {
        "total": int(total["c"]) if total else 0, "stats": stats,
        "items": [{"id": r["id"], "code": r["code"], "status": _admin_status(r), "months": int(r.get("months") or 1),
                   "whitelist": bool(r.get("whitelist")), "note": r.get("note") or "", "batch": r.get("batch") or "",
                   "one_per_user": bool(r.get("one_per_user")), "created_at": r["created_at"],
                   "expires_at": r.get("expires_at"), "redeemed_at": r.get("redeemed_at"),
                   "redeemed_by": r.get("redeemed_by"), "redeemed_username": r.get("r_username"),
                   "redeemed_tg": r.get("r_tg")} for r in rows],
    }


def revoke_admin_gifts(ids: list[int]) -> int:
    """отменить неактивированные коды из панели; активированные не трогаем."""
    _ensure_schema()
    ids = [int(i) for i in ids][:ADMIN_MAX_BATCH]
    if not ids:
        return 0
    ph = ",".join("?" * len(ids))
    cur = db.execute(f"UPDATE referral_rewards SET status = 'revoked' WHERE kind = 'admin' AND status = 'issued' "
                     f"AND id IN ({ph})", tuple(ids))
    return int(cur.rowcount or 0)


def gift_preview(code: str) -> Optional[dict[str, Any]]:
    """для бота: что за подарок по коду (без активации)."""
    _ensure_schema()
    row = db.fetchone("SELECT kind, status, months, whitelist, expires_at FROM referral_rewards "
                      "WHERE code = ? AND kind IN ('gift', 'bought', 'admin')", (str(code or "").strip().upper(),))
    if not row:
        return None
    return {"status": _admin_status(row), "months": int(row.get("months") or 1), "whitelist": bool(row.get("whitelist"))}


def levels_public() -> list[dict[str, Any]]:
    return [
        {"key": lv["key"], "name": lv["name"], "min": lv["min"], "rate": lv["rate"],
         "gifts": lv["gifts"], "self_free_from": lv["self_free_from"]}
        for lv in LEVELS
    ]
