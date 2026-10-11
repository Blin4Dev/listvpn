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
    row = db.fetchone(
        "SELECT COUNT(DISTINCT u.id) AS c FROM users u JOIN subscriptions s ON s.user_id = u.id "
        "WHERE u.referred_by = ? AND s.status = 'Active' AND s.type != 'trial' "
        "AND s.expires_at IS NOT NULL AND s.expires_at > ?",
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
    total = db.fetchone(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE user_id = ? AND status = 'completed' "
        "AND payment_method IN ('referral', 'referral_reversal')",
        (int(user_id),),
    )
    month = db.fetchone(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE user_id = ? AND status = 'completed' "
        "AND payment_method IN ('referral', 'referral_reversal') AND created_at >= ?",
        (int(user_id), _iso(month_start)),
    )
    return {"total": round(max(0.0, float(total["s"] or 0)), 2), "month": round(float(month["s"] or 0), 2)}


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


def rewards_state(user: dict[str, Any]) -> dict[str, Any]:
    _ensure_schema()
    uid = int(user["id"])
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
    row = db.fetchone("SELECT * FROM referral_rewards WHERE code = ? AND kind IN ('gift', 'bought')", (code,))
    if not row:
        raise RewardError("Подарок не найден", 404)
    if row["status"] == "revoked":
        raise RewardError("Подарок отменён")
    if int(row["user_id"]) == int(user["id"]):
        raise RewardError("Свой подарок активировать нельзя — отправьте код другу")
    claim = db.execute(
        "UPDATE referral_rewards SET status = 'redeemed', redeemed_by = ?, redeemed_at = ? "
        "WHERE id = ? AND status = 'issued'",
        (int(user["id"]), _iso(_now()), row["id"]),
    )
    if claim.rowcount == 0:
        raise RewardError("Этот подарок уже активирован")
    months = int(row.get("months") or REWARD_MONTHS)
    whitelist = bool(row.get("whitelist") if row.get("whitelist") is not None else 1)
    try:
        grant = _grant_month(user, months=months, whitelist=whitelist)
    except Exception as exc:  # noqa: BLE001
        db.execute("UPDATE referral_rewards SET status = 'issued', redeemed_by = NULL, redeemed_at = NULL WHERE id = ?",
                   (row["id"],))
        raise RewardError(f"Не удалось активировать подарок: {exc}", 502)
    return {"expires_at": grant.get("expires_at"), "months": months, "whitelist": whitelist}


def levels_public() -> list[dict[str, Any]]:
    return [
        {"key": lv["key"], "name": lv["name"], "min": lv["min"], "rate": lv["rate"],
         "gifts": lv["gifts"], "self_free_from": lv["self_free_from"]}
        for lv in LEVELS
    ]
