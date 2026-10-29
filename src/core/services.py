# промокоды, трекинг-ссылки, выводы (только бд)
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import database as db  # type: ignore

PROMO_DISCOUNT_DAYS = 90

# системные промо (только бот; is_active=0, пользователи не вводят)
SYSTEM_PROMO_CODES = {"DRIP10"}
MIN_WITHDRAW_RUB = 100.0
_TON_ADDR_RE = re.compile(r"^(?:UQ|EQ|0Q|kQ)[A-Za-z0-9_-]{46}$")


class ServiceError(Exception):

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def activate_promocode(user_id: int, code: str) -> dict[str, Any]:
    code = (code or "").upper().strip()
    if not code:
        raise ServiceError("Пустой промокод", 400)
    # промокод действует только в своём проекте (у BatmanVPN и FGN разные промокоды)
    promo = db.fetchone("SELECT * FROM promocodes WHERE code = ? AND project_id = "
                        "COALESCE((SELECT project_id FROM users WHERE id = ?), ?)", (code, user_id, db.pid()))
    if not promo or not promo.get("is_active") or code in SYSTEM_PROMO_CODES:
        raise ServiceError("Промокод не найден", 404)
    if promo.get("expires_at"):
        exp = _parse_iso(str(promo["expires_at"]))
        if exp and exp < _utcnow():
            raise ServiceError("Срок действия промокода истёк", 400)
    is_days = str(promo.get("type") or "discount") == "days"
    if is_days and not db.projects.get(db.projects.of(promo)).feature("promo_days"):
        raise ServiceError("Промокод не найден", 404)
    already = db.fetchone(
        "SELECT id FROM promocode_activations WHERE promocode_id = ? AND user_id = ?",
        (promo["id"], user_id),
    )
    if already:
        raise ServiceError("Промокод уже активирован", 400)

    percent = 0.0 if is_days else float(promo.get("value") or 0)
    expires_at = (_utcnow() + timedelta(days=PROMO_DISCOUNT_DAYS)).isoformat()

    # атомарный uses_count с проверкой uses_limit
    if promo.get("uses_limit") is not None:
        cur = db.execute(
            "UPDATE promocodes SET uses_count = uses_count + 1 "
            "WHERE id = ? AND uses_count < uses_limit",
            (promo["id"],),
        )
        if cur.rowcount == 0:
            raise ServiceError("Лимит использований исчерпан", 400)
    else:
        db.execute("UPDATE promocodes SET uses_count = uses_count + 1 WHERE id = ?", (promo["id"],))

    try:
        db.execute(
            "INSERT INTO promocode_activations (promocode_id, user_id, discount_percent, expires_at, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (promo["id"], user_id, percent, expires_at, db.utcnow_iso()),
        )
    except Exception:  # noqa: BLE001
        # откатить uses_count при гонке unique-index
        db.execute("UPDATE promocodes SET uses_count = uses_count - 1 WHERE id = ?", (promo["id"],))
        raise ServiceError("Промокод уже активирован", 400)
    if is_days:
        # дни к подписке: подарок ждёт кнопку «Забрать» (в мини-приложении или из сообщения бота)
        days = max(1, int(float(promo.get("value") or 0)))
        gift = create_day_gift(user_id, days, "promo", promocode_id=int(promo["id"]))
        return {"type": "days", "days": days, "gift_id": gift["id"], "code": code, "name": promo.get("name"),
                "percent": 0, "expires_at": gift.get("expires_at")}
    return {"type": "discount", "percent": percent, "expires_at": expires_at, "code": code, "name": promo.get("name")}


DAY_GIFT_VALID_DAYS = 14  # сколько дней подарок ждёт кнопку «Забрать»


def create_day_gift(user_id: int, days: int, source: str, *, promocode_id: Optional[int] = None,
                    valid_days: int = DAY_GIFT_VALID_DAYS) -> dict[str, Any]:
    now = _utcnow()
    db.execute(
        "INSERT INTO day_gifts (user_id, days, source, promocode_id, status, created_at, expires_at) "
        "VALUES (?, ?, ?, ?, 'pending', ?, ?)",
        (int(user_id), int(days), source, promocode_id, now.isoformat(), (now + timedelta(days=valid_days)).isoformat()),
    )
    return db.fetchone("SELECT * FROM day_gifts WHERE id = ?", (db.last_id(),)) or {}


def pending_day_gifts(user_id: int) -> list[dict[str, Any]]:
    return db.fetchall(
        "SELECT id, days, source, created_at, expires_at FROM day_gifts WHERE user_id = ? AND status = 'pending' "
        "AND (expires_at IS NULL OR expires_at > ?) ORDER BY id", (int(user_id), _utcnow().isoformat()))


def take_day_gift(user_id: int, gift_id: int) -> dict[str, Any]:
    """захват подарка (один раз); начисление дней — вызывающий. Откат — release_day_gift."""
    g = db.fetchone("SELECT * FROM day_gifts WHERE id = ? AND user_id = ?", (int(gift_id), int(user_id)))
    if not g:
        raise ServiceError("Подарок не найден", 404)
    if g["status"] != "pending":
        raise ServiceError("Подарок уже получен", 400)
    exp = _parse_iso(g.get("expires_at"))
    if exp and exp < _utcnow():
        raise ServiceError("Срок подарка истёк", 400)
    cur = db.execute("UPDATE day_gifts SET status = 'claimed', claimed_at = ? WHERE id = ? AND status = 'pending'",
                     (_utcnow().isoformat(), int(gift_id)))
    if not cur.rowcount:
        raise ServiceError("Подарок уже получен", 400)
    return g


def release_day_gift(gift_id: int) -> None:
    db.execute("UPDATE day_gifts SET status = 'pending', claimed_at = NULL WHERE id = ?", (int(gift_id),))


# ── компенсация (панель): +1 день к подписке и разовая скидка на следующую покупку ──
COMPENSATION_DAYS = 1
COMPENSATION_PERCENT = 7.0


def record_compensation(user_id: int, *, days: int, days_applied: bool, percent: float, mass: bool = False,
                        actor: Optional[str] = None, actor_name: Optional[str] = None) -> int:
    db.execute(
        "INSERT INTO compensations (user_id, days, days_applied, discount_percent, mass, actor, actor_name, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (int(user_id), int(days), 1 if days_applied else 0, float(percent), 1 if mass else 0,
         actor, (actor_name or "")[:60] or None, db.utcnow_iso()),
    )
    return int(db.last_id())


def recent_compensation(user_id: int, seconds: int) -> Optional[dict[str, Any]]:
    """компенсация этому пользователю за последние seconds (защита от двойного нажатия)."""
    since = (_utcnow() - timedelta(seconds=seconds)).isoformat()
    return db.fetchone("SELECT * FROM compensations WHERE user_id = ? AND created_at > ? ORDER BY id DESC LIMIT 1",
                       (int(user_id), since))


def active_compensation(user_id: int) -> Optional[dict[str, Any]]:
    """неиспользованная скидка компенсации (самая ранняя); скидки компенсаций не суммируются."""
    return db.fetchone(
        "SELECT * FROM compensations WHERE user_id = ? AND used_at IS NULL AND discount_percent > 0 "
        "ORDER BY id LIMIT 1", (int(user_id),))


def use_compensation(compensation_id: int, payment_id: str) -> bool:
    """скидка компенсации использована: оплачен платёж с ней (один раз)."""
    cur = db.execute("UPDATE compensations SET used_at = ?, used_payment_id = ? WHERE id = ? AND used_at IS NULL",
                     (db.utcnow_iso(), str(payment_id), int(compensation_id)))
    return bool(cur.rowcount)


def compensations_for_user(user_id: int, limit: int = 20) -> list[dict[str, Any]]:
    return db.fetchall("SELECT id, days, days_applied, discount_percent, mass, actor_name, created_at, used_at, "
                       "used_payment_id FROM compensations WHERE user_id = ? ORDER BY id DESC LIMIT ?",
                       (int(user_id), int(limit)))


def grant_personal_discount(user_id: int, percent: float, hours: int, code: str = "DRIP10") -> bool:
    promo = db.fetchone("SELECT * FROM promocodes WHERE code = ?", (code,))
    if not promo:
        db.execute(
            "INSERT INTO promocodes (code, name, type, value, uses_limit, uses_count, expires_at, is_active, created_at) "
            "VALUES (?, ?, 'discount', ?, NULL, 0, NULL, 0, ?)",
            (code, "Персональная скидка", float(percent), db.utcnow_iso()),
        )
        promo = db.fetchone("SELECT * FROM promocodes WHERE code = ?", (code,))
    if not promo:
        return False
    # уже активирован
    if db.fetchone(
        "SELECT id FROM promocode_activations WHERE promocode_id = ? AND user_id = ?",
        (promo["id"], user_id),
    ):
        return True
    expires_at = (_utcnow() + timedelta(hours=hours)).isoformat()
    try:
        db.execute(
            "INSERT INTO promocode_activations (promocode_id, user_id, discount_percent, expires_at, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (promo["id"], user_id, float(percent), expires_at, db.utcnow_iso()),
        )
    except Exception:  # noqa: BLE001
        return True
    db.execute("UPDATE promocodes SET uses_count = uses_count + 1 WHERE id = ?", (promo["id"],))
    return True


def register_tracking_click(
    code: str,
    *,
    user_id: Optional[int],
    telegram_id: Optional[int],
    username: Optional[str] = None,
    full_name: Optional[str] = None,
    is_new_user: bool = False,
) -> Optional[dict[str, Any]]:
    code = (code or "").strip()
    if not code:
        return None
    link = db.fetchone("SELECT * FROM tracking_links WHERE code = ? AND project_id = ?", (code, db.pid()))
    if not link or not link.get("is_active"):
        return None

    link_id = int(link["id"])
    now = db.utcnow_iso()
    db.execute("UPDATE tracking_links SET clicks = clicks + 1 WHERE id = ?", (link_id,))

    seen = None
    if user_id is not None:
        seen = db.fetchone(
            "SELECT id FROM tracking_link_users WHERE link_id = ? AND user_id = ?",
            (link_id, user_id),
        )
    if not seen:
        db.execute(
            "INSERT INTO tracking_link_users (link_id, user_id, telegram_id, username, full_name, "
            "is_new_user, visited_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (link_id, user_id, telegram_id, username, None, 1 if is_new_user else 0, now),
        )
        db.execute("UPDATE tracking_links SET unique_users = unique_users + 1 WHERE id = ?", (link_id,))
        if is_new_user:
            db.execute("UPDATE tracking_links SET new_users = new_users + 1 WHERE id = ?", (link_id,))

    # зафиксировать tracking_code один раз
    if user_id is not None:
        row = db.fetchone("SELECT tracking_code FROM users WHERE id = ?", (user_id,))
        if row is not None and not row.get("tracking_code"):
            db.execute("UPDATE users SET tracking_code = ? WHERE id = ?", (code, user_id))

    # авто-активация промокода со ссылки
    if user_id is not None and link.get("promocode"):
        try:
            activate_promocode(user_id, str(link["promocode"]))
        except ServiceError:
            pass  # already used / expired

    _recalc_conversion(link_id)
    return link


def reverse_tracking_payment(user_id: int, amount: float) -> None:
    if amount is None or float(amount) <= 0:
        return
    row = db.fetchone("SELECT tracking_code FROM users WHERE id = ?", (user_id,))
    code = (row or {}).get("tracking_code")
    if not code:
        return
    link = db.fetchone("SELECT id FROM tracking_links WHERE code = ?", (code,))
    if not link:
        return
    link_id = int(link["id"])
    db.execute("UPDATE tracking_links SET total_revenue = MAX(0, total_revenue - ?) WHERE id = ?",
               (float(amount), link_id))
    lu = db.fetchone("SELECT id, total_spent FROM tracking_link_users WHERE link_id = ? AND user_id = ?",
                     (link_id, user_id))
    if lu:
        left = max(0.0, float(lu.get("total_spent") or 0) - float(amount))
        db.execute("UPDATE tracking_link_users SET total_spent = ?, has_paid = ? WHERE id = ?",
                   (left, 1 if left > 0 else 0, lu["id"]))
        if left <= 0:
            db.execute("UPDATE tracking_links SET paid_users = MAX(0, paid_users - 1) WHERE id = ?", (link_id,))
    _recalc_conversion(link_id)


def credit_tracking_payment(user_id: int, amount: float) -> None:
    if amount is None or float(amount) <= 0:
        return
    row = db.fetchone("SELECT tracking_code FROM users WHERE id = ?", (user_id,))
    code = (row or {}).get("tracking_code")
    if not code:
        return
    link = db.fetchone("SELECT id FROM tracking_links WHERE code = ?", (code,))
    if not link:
        return
    link_id = int(link["id"])

    lu = db.fetchone(
        "SELECT id, has_paid FROM tracking_link_users WHERE link_id = ? AND user_id = ?",
        (link_id, user_id),
    )
    first_payment = not (lu and lu.get("has_paid"))
    db.execute(
        "UPDATE tracking_links SET total_revenue = total_revenue + ? WHERE id = ?",
        (float(amount), link_id),
    )
    if first_payment:
        db.execute("UPDATE tracking_links SET paid_users = paid_users + 1 WHERE id = ?", (link_id,))
    if lu:
        db.execute(
            "UPDATE tracking_link_users SET total_spent = total_spent + ?, has_paid = 1 WHERE id = ?",
            (float(amount), lu["id"]),
        )
    _recalc_conversion(link_id)


def _recalc_conversion(link_id: int) -> None:
    link = db.fetchone("SELECT unique_users, paid_users FROM tracking_links WHERE id = ?", (link_id,))
    if not link:
        return
    uniq = int(link.get("unique_users") or 0)
    paid = int(link.get("paid_users") or 0)
    rate = round((paid / uniq * 100.0), 2) if uniq else 0.0
    db.execute("UPDATE tracking_links SET conversion_rate = ? WHERE id = ?", (rate, link_id))


def valid_ton_address(address: str) -> bool:
    a = (address or "").strip()
    if not a:
        return False
    low = a.lower()
    if low.endswith(".ton") or low.endswith(".t.me"):
        return len(a) >= 5
    return bool(_TON_ADDR_RE.match(a))


WITHDRAWAL_STATUSES = ("pending", "approved", "completed", "rejected")


def serialize_withdrawal(w: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": w.get("id"),
        "user_id": w.get("user_id"),
        "amount": float(w.get("amount") or 0),
        "address": w.get("address"),
        "method": w.get("method") or "usdt_ton",
        "status": w.get("status") or "pending",
        # хеш транзакции (колонка всё ещё tx_link)
        "tx_hash": w.get("tx_link"),
        "tx_link": w.get("tx_link"),
        "reject_reason": w.get("reject_reason"),
        "refunded": bool(w.get("refunded")),
        "created_at": w.get("created_at"),
        "approved_at": w.get("approved_at"),
        "processed_at": w.get("processed_at"),
    }


def request_withdrawal(user_id: int, amount: float, address: str) -> dict[str, Any]:
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        raise ServiceError("Некорректная сумма", 400)
    amount = round(amount, 2)
    if amount < MIN_WITHDRAW_RUB:
        raise ServiceError(f"Минимальная сумма вывода — {int(MIN_WITHDRAW_RUB)}₽", 400)
    if not valid_ton_address(address):
        raise ServiceError("Неверный адрес. Нужен адрес USDT TON (UQ…/EQ…) или домен .ton / .t.me", 400)

    if not db.fetchone("SELECT id FROM users WHERE id = ?", (user_id,)):
        raise ServiceError("Пользователь не найден", 404)

    # списание + insert в одной tx; WHERE balance >= amount против double-spend
    with db.transaction() as tx:
        cur = tx.execute(
            "UPDATE users SET partner_balance = partner_balance - ? WHERE id = ? AND partner_balance >= ?",
            (amount, user_id, amount),
        )
        if cur.rowcount == 0:
            raise ServiceError("Недостаточно средств на реферальном балансе", 400)
        ins = tx.execute(
            "INSERT INTO withdrawals (user_id, amount, address, method, status, created_at) "
            "VALUES (?, ?, ?, 'usdt_ton', 'pending', ?)",
            (user_id, amount, address.strip(), db.utcnow_iso()),
        )
        wid = ins.lastrowid
        # реферальный леджер (API v1)
        tx.execute(
            "INSERT INTO referral_ledger (user_id, kind, amount, withdrawal_id, created_at) "
            "VALUES (?, 'withdrawal', ?, ?, ?)",
            (user_id, -amount, wid, db.utcnow_iso()),
        )
    return db.fetchone("SELECT * FROM withdrawals WHERE id = ?", (wid,))  # type: ignore[return-value]


def set_withdrawal_forum_ref(withdrawal_id: int, chat_id: Any, message_id: int) -> None:
    db.execute(
        "UPDATE withdrawals SET forum_chat_id = ?, forum_message_id = ? WHERE id = ?",
        (str(chat_id), int(message_id), withdrawal_id),
    )


def _get_withdrawal(withdrawal_id: int) -> dict[str, Any]:
    w = db.fetchone("SELECT * FROM withdrawals WHERE id = ?", (withdrawal_id,))
    if not w:
        raise ServiceError("Заявка не найдена", 404)
    return w


def approve_withdrawal(withdrawal_id: int) -> dict[str, Any]:
    _get_withdrawal(withdrawal_id)
    cur = db.execute(
        "UPDATE withdrawals SET status = 'approved', approved_at = ? WHERE id = ? AND status = 'pending'",
        (db.utcnow_iso(), withdrawal_id),
    )
    if cur.rowcount == 0:
        raise ServiceError("Заявку можно одобрить только в статусе «Ожидает»", 400)
    return _get_withdrawal(withdrawal_id)


def complete_withdrawal(withdrawal_id: int, tx_hash: str) -> dict[str, Any]:
    _get_withdrawal(withdrawal_id)
    tx_hash = (tx_hash or "").strip()
    if not tx_hash:
        raise ServiceError("Укажите hash транзакции", 400)
    if len(tx_hash) > 300:
        raise ServiceError("Слишком длинный hash", 400)
    cur = db.execute(
        "UPDATE withdrawals SET status = 'completed', tx_link = ?, processed_at = ? "
        "WHERE id = ? AND status = 'approved'",
        (tx_hash, db.utcnow_iso(), withdrawal_id),
    )
    if cur.rowcount == 0:
        raise ServiceError("Завершить можно только одобренную заявку", 400)
    return _get_withdrawal(withdrawal_id)


def reject_withdrawal(withdrawal_id: int, reason: str = "", refund: bool = True) -> dict[str, Any]:
    w = _get_withdrawal(withdrawal_id)
    reason = (reason or "").strip()[:500]
    # смена статуса + опциональный возврат в одной tx
    with db.transaction() as tx:
        cur = tx.execute(
            "UPDATE withdrawals SET status = 'rejected', reject_reason = ?, refunded = ?, processed_at = ? "
            "WHERE id = ? AND status IN ('pending', 'approved')",
            (reason or None, 1 if refund else 0, db.utcnow_iso(), withdrawal_id),
        )
        if cur.rowcount == 0:
            raise ServiceError("Заявка уже обработана", 400)
        if refund:
            tx.execute(
                "UPDATE users SET partner_balance = partner_balance + ? WHERE id = ?",
                (float(w["amount"]), w["user_id"]),
            )
            tx.execute(
                "INSERT INTO referral_ledger (user_id, kind, amount, withdrawal_id, created_at) "
                "VALUES (?, 'withdrawal_refund', ?, ?, ?)",
                (w["user_id"], float(w["amount"]), withdrawal_id, db.utcnow_iso()),
            )
    return _get_withdrawal(withdrawal_id)


def reject_open_withdrawals_for_user(user_id: int, reason: str) -> list[dict[str, Any]]:
    rows = db.fetchall(
        "SELECT id FROM withdrawals WHERE user_id = ? AND status IN ('pending', 'approved')",
        (int(user_id),),
    )
    done: list[dict[str, Any]] = []
    for r in rows:
        try:
            done.append(reject_withdrawal(int(r["id"]), reason, refund=True))
        except ServiceError:
            pass
    return done
