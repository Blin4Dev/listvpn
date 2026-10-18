# платежи, выдача, fulfill (общее для core/webhook/bot)
from __future__ import annotations

import os
import secrets
import uuid as _uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

try:
    from . import database as db  # type: ignore
except ImportError:
    import database as db  # type: ignore

try:
    from . import provisioning
except ImportError:
    import provisioning  # type: ignore

try:
    from . import services
except ImportError:
    import services  # type: ignore

try:
    from . import forum
except ImportError:
    import forum  # type: ignore

try:
    from . import notifier
except ImportError:
    import notifier  # type: ignore


DAYS_PER_MONTH = 30

GB = 1024 ** 3
# дефолты; актуальные значения из настроек панели
REGULAR_TRAFFIC_GB = 100  # обычная подписка, ГБ/мес
TRIAL_TRAFFIC_GB = 5  # пробная
TRIAL_DAYS = 3
TRIAL_DEVICES = 1


def _int_setting(key: str, default: int, lo: int, hi: int) -> int:
    try:
        v = int(float(db.get_setting(key, str(default)) or default))
    except (TypeError, ValueError):
        v = default
    return max(lo, min(hi, v))


def trial_days() -> int:
    return _int_setting("trial_days", TRIAL_DAYS, 1, 365)


def trial_traffic_gb() -> int:
    return _int_setting("trial_traffic_gb", TRIAL_TRAFFIC_GB, 0, 100000)


def trial_devices() -> int:
    return _int_setting("trial_devices", TRIAL_DEVICES, 1, 20)


def trial_bypass_enabled() -> bool:
    """вместе с пробным VPN выдавать бесплатный пробный ключ обхода FURK (настройка trial_bypass, по умолчанию вкл.)."""
    return _int_setting("trial_bypass", 1, 0, 1) == 1


def paid_traffic_gb() -> int:
    return _int_setting("paid_traffic_gb", REGULAR_TRAFFIC_GB, 0, 100000)
DELETE_AFTER_DAYS = 7  # unpaid sub deleted after this many days
RESET_STRATEGY = "MONTH"  # remnawave traffic reset


def _env(*keys: str, default: str = "") -> str:
    for key in keys:
        val = (os.getenv(key) or "").strip()
        if val:
            return val
    return default


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def get_user(user_id: int) -> Optional[dict[str, Any]]:
    return db.fetchone("SELECT * FROM users WHERE id = ?", (user_id,))


def vpn_squads() -> list[str]:
    return db.loads(db.get_setting("squad_mapping_vpn", "[]"), []) or []


# ── тарифы по периодам ──
SUB_PERIODS = (1, 3, 6, 12)
PERIOD_DAYS = {1: 30, 3: 90, 6: 180, 12: 365}
# цены по умолчанию — из старого бота (vpn_1 180, vpn_2 340, vpn_4 600, vpn_6 900, vpn_12 1600);
# 3 месяца в старом не было — середина между 2 и 4 мес.
PERIOD_DEFAULT_PRICE = {1: 180, 3: 470, 6: 900, 12: 1600}
PERIOD_DEFAULT_STARS = {1: 200, 3: 540, 6: 1000, 12: 2000}


def _float_setting(key: str, default: float) -> float:
    try:
        return float(db.get_setting(key, str(default)))
    except (TypeError, ValueError):
        return float(default)


def period_price(months: int) -> float:
    m = int(months)
    return _float_setting(f"period_price_{m}", PERIOD_DEFAULT_PRICE.get(m, 180 * m))


def period_stars(months: int) -> int:
    """цена тарифа в звёздах (отдельная, как в старом боте)."""
    m = int(months)
    return int(round(_float_setting(f"period_stars_{m}", PERIOD_DEFAULT_STARS.get(m, 200 * m))))


def tariff_devices() -> int:
    return _int_setting("tariff_devices", 3, 1, 20)


# ── белые списки: отдельный анти-ключ FURK, как в старом боте ──
# Отдельные тарифы anti_1/anti_3/anti_6: цена — полная (ВПН + белые списки),
# покупка продлевает основную подписку на тот же срок и выпускает/продлевает анти-ключ (500 ГБ).
# Цена 0 = период для белых списков недоступен.
WHITELIST_DEFAULT_PRICE = {1: 399, 3: 1488, 6: 2222, 12: 0}
WHITELIST_DEFAULT_STARS = {1: 600, 3: 1800, 6: 2500, 12: 0}
WHITELIST_DEFAULT_DEVICES = {1: 2, 3: 5, 6: 5, 12: 5}

try:
    import furk  # type: ignore  # src/api на PYTHONPATH
except Exception:  # noqa: BLE001
    furk = None  # type: ignore

try:
    import subdomain  # type: ignore
except Exception:  # noqa: BLE001
    subdomain = None  # type: ignore


def whitelist_price(months: int = 1) -> float:
    """полная цена тарифа «ВПН + белые списки» на months (0 = нет такого периода)."""
    m = int(months or 1)
    return _float_setting(f"whitelist_price_{m}", WHITELIST_DEFAULT_PRICE.get(m, 0))


def whitelist_stars(months: int = 1) -> int:
    m = int(months or 1)
    return int(round(_float_setting(f"whitelist_stars_{m}", WHITELIST_DEFAULT_STARS.get(m, 0))))


def whitelist_devices(months: int = 1) -> int:
    """сколько устройств в анти-ключе (подпись тарифа, как «(2 устройства) 1 месяц»)."""
    m = int(months or 1)
    return _int_setting(f"whitelist_devices_{m}", WHITELIST_DEFAULT_DEVICES.get(m, 5), 1, 50)


def whitelist_period_available(months: int) -> bool:
    return whitelist_available() and whitelist_price(months) > 0


def period_days(months: int) -> int:
    return int(PERIOD_DAYS.get(int(months or 1), DAYS_PER_MONTH * int(months or 1)))


def whitelist_available() -> bool:
    return bool(furk is not None and furk.is_configured())


def user_whitelist(user: Optional[dict[str, Any]]) -> dict[str, Any]:
    """анти-ключ пользователя: ссылка, срок, активен ли."""
    if not user:
        return {"key": None, "until": None, "active": False}
    row = db.fetchone("SELECT anti_key, anti_key_id, anti_expires_at FROM users WHERE id = ?", (int(user["id"]),)) or {}
    until = parse_iso(row.get("anti_expires_at"))
    key_id = row.get("anti_key_id") or (furk.key_id_from_url(row["anti_key"]) if (furk and row.get("anti_key")) else None)
    key_url = row.get("anti_key")
    if key_url and subdomain is not None:
        key_url = subdomain.whitelist(key_url)  # домен белых списков из .env
    return {"key": key_url, "key_id": key_id, "until": row.get("anti_expires_at"),
            "active": bool(row.get("anti_key") and until and until > utcnow())}


def grant_whitelist(user: dict[str, Any], months: int = 1, idem: Optional[str] = None,
                    *, days: Optional[int] = None) -> dict[str, Any]:
    """выпустить/продлить анти-ключ FURK на months или days (логика старого process_payment для anti_*).
    idem — ключ идемпотентности (id платежа): повторная обработка не спишет деньги у FURK дважды."""
    add_days = int(days) if days is not None else DAYS_PER_MONTH * max(1, int(months or 1))
    cur = user_whitelist(user)
    out: dict[str, Any] = {"ok": False, "key": cur["key"], "key_id": cur["key_id"], "until": cur["until"],
                           "prev_key": cur["key"], "prev_key_id": cur["key_id"], "prev_until": cur["until"],
                           "error": None, "error_code": None}
    if idem:
        done = db.fetchone("SELECT anti_last_idem FROM users WHERE id = ?", (int(user["id"]),)) or {}
        if done.get("anti_last_idem") == str(idem):
            out.update(ok=True, already=True)
            return out
    if furk is None or not furk.is_configured():
        out["error"] = "furk_not_configured"
        return out
    try:
        if days is not None:
            res = furk.issue_or_renew(cur["key_id"], idem=f"blin-{idem}" if idem else None, days=int(days))
        else:
            res = furk.issue_or_renew(cur["key_id"], max(1, int(months or 1)),
                                      idem=f"blin-{idem}" if idem else None)
    except Exception as exc:  # noqa: BLE001
        out["error"] = f"{type(exc).__name__}: {exc}"
        out["error_code"] = getattr(exc, "code", None)
        return out
    # срок — как у провайдера; если не пришёл, считаем сами: от текущего (или сейчас) + срок
    until = None
    try:
        if res.get("expires_at"):
            until = iso(datetime.fromtimestamp(int(res["expires_at"]), tz=timezone.utc))
    except (TypeError, ValueError, OSError):
        until = None
    if not until:
        prev = parse_iso(cur["until"])
        base = prev if (prev and prev > utcnow()) else utcnow()
        until = iso(base + timedelta(days=max(1, add_days)))
    key_url = res.get("subscription_url") or cur["key"]
    db.execute("UPDATE users SET anti_key = ?, anti_key_id = ?, anti_expires_at = ?, anti_last_idem = ? WHERE id = ?",
               (key_url, res["id"], until, str(idem) if idem else None, int(user["id"])))
    out.update(ok=True, key=key_url, key_id=res["id"], until=until)
    return out


def whitelist_active(sub: Optional[dict[str, Any]]) -> bool:
    """совместимость: белые списки активны у владельца подписки."""
    if not sub or not sub.get("user_id"):
        return False
    return bool(user_whitelist({"id": sub["user_id"]})["active"])


def squads_for(whitelist: bool = False) -> list[str]:
    # белые списки — отдельный ключ FURK, в remnawave только обычные сквады
    return list(vpn_squads())


def squads_for_sub(sub: Optional[dict[str, Any]]) -> list[str]:
    return squads_for()


def trial_squads() -> list[str]:
    return db.loads(db.get_setting("squad_mapping_trial", "[]"), []) or vpn_squads()


def compute_user_state(user_id: int) -> str:
    u = db.fetchone("SELECT is_banned FROM users WHERE id = ?", (user_id,))
    if not u:
        return "None"
    if u.get("is_banned"):
        return "Banned"
    now = db.utcnow_iso()
    row = db.fetchone(
        "SELECT COUNT(*) AS total, "
        "MAX(CASE WHEN status = 'Active' AND type != 'trial' AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END) AS paid_now, "
        "MAX(CASE WHEN status = 'Active' AND type = 'trial' AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END) AS trial_now "
        "FROM subscriptions WHERE user_id = ?",
        (now, now, user_id),
    ) or {}
    if not int(row.get("total") or 0):
        return "None"
    if int(row.get("paid_now") or 0):
        return "Active"
    if int(row.get("trial_now") or 0):
        return "Trial"
    return "Expired"


def _sync_user_status(user_id: int) -> None:
    state = compute_user_state(user_id)
    if state == "Banned":
        return
    db.execute("UPDATE users SET status = ? WHERE id = ?", (state, user_id))


def create_payment_intent(
    *,
    user_id: int,
    provider: str,
    method: str,
    amount: float,
    currency: str = "RUB",
    stars: Optional[int] = None,
    purpose: str = "subscription",
    plan_devices: Optional[int] = None,
    months: int = 1,
    extra_devices: int = 0,
    subscription_id: Optional[int] = None,
    payment_id: Optional[str] = None,
    referral_applied: float = 0.0,
    whitelist: bool = False,
) -> dict[str, Any]:
    pid = payment_id or secrets.token_hex(12)
    now = db.utcnow_iso()
    db.execute(
        "INSERT INTO payments (payment_id, user_id, provider, method, amount, currency, stars, "
        "status, purpose, plan_devices, months, extra_devices, subscription_id, referral_applied, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)",
        (
            pid, int(user_id), provider, method, float(amount), currency,
            int(stars) if stars is not None else None,
            purpose, plan_devices, int(months or 1), int(extra_devices or 0),
            subscription_id, round(float(referral_applied or 0), 2), now,
        ),
    )
    if whitelist:
        db.execute("UPDATE payments SET whitelist = 1 WHERE payment_id = ?", (pid,))
    # pending-строка в ленте транзакций
    db.execute(
        "INSERT INTO transactions (user_id, amount, status, payment_method, hash, payment_id, description, created_at) "
        "VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)",
        (int(user_id), float(amount), method, pid, pid, f"{purpose} · {provider}", now),
    )
    return get_payment(pid)  # type: ignore[return-value]


def get_payment(payment_id: str) -> Optional[dict[str, Any]]:
    return db.fetchone("SELECT * FROM payments WHERE payment_id = ?", (payment_id,))


def get_payment_by_provider_id(provider_payment_id: str) -> Optional[dict[str, Any]]:
    return db.fetchone(
        "SELECT * FROM payments WHERE provider_payment_id = ?", (provider_payment_id,)
    )


def set_provider_data(
    payment_id: str,
    *,
    provider_payment_id: Optional[str] = None,
    pay_url: Optional[str] = None,
    invoice_link: Optional[str] = None,
) -> None:
    sets, params = [], []
    if provider_payment_id is not None:
        sets.append("provider_payment_id = ?")
        params.append(provider_payment_id)
    if pay_url is not None:
        sets.append("pay_url = ?")
        params.append(pay_url)
    if invoice_link is not None:
        sets.append("invoice_link = ?")
        params.append(invoice_link)
    if not sets:
        return
    params.append(payment_id)
    db.execute(f"UPDATE payments SET {', '.join(sets)} WHERE payment_id = ?", params)


def _release_referral_hold(payment: dict[str, Any]) -> None:
    try:
        applied = float(payment.get("referral_applied") or 0)
    except (TypeError, ValueError):
        applied = 0
    if applied <= 0:
        return
    try:
        db.execute(
            "UPDATE users SET partner_balance = partner_balance + ? WHERE id = ?",
            (round(applied, 2), int(payment["user_id"])),
        )
        # снять холд, чтобы повторная отмена не зачислила дважды
        db.execute("UPDATE payments SET referral_applied = 0 WHERE payment_id = ?", (payment["payment_id"],))
    except Exception:  # noqa: BLE001
        pass


def mark_failed(payment_id: str, reason: str = "") -> None:
    payment = get_payment(payment_id)
    cur = db.execute(
        "UPDATE payments SET status = 'failed', error = ? WHERE payment_id = ? AND status IN ('pending', 'processing')",
        (reason[:500], payment_id),
    )
    db.execute(
        "UPDATE transactions SET status = 'failed' WHERE payment_id = ? AND status = 'pending'",
        (payment_id,),
    )
    # снять реф. холд только если статус стал failed
    if payment and cur.rowcount:
        _release_referral_hold(payment)


def _expected_provider_amount(payment: dict[str, Any]) -> float:
    if payment.get("provider") == "tg_stars":
        return float(payment.get("stars") or 0)
    return float(payment.get("amount") or 0)


def _grant_traffic_reset(user: dict[str, Any]) -> dict[str, Any]:
    res = provisioning.reset_traffic(int(user.get("telegram_id") or 0), user.get("email"))
    try:
        db.execute(
            "UPDATE subscriptions SET traffic_used = 0 WHERE user_id = ? AND status != 'Banned'",
            (int(user["id"]),),
        )
    except Exception:  # noqa: BLE001
        pass
    # завершить grace, если причина была трафик
    try:
        try:
            from . import grace  # type: ignore
        except ImportError:
            import grace  # type: ignore
        grace.end_for_user(int(user["id"]), traffic=True)
    except Exception:  # noqa: BLE001
        pass
    sub = db.fetchone(
        "SELECT id FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1", (int(user["id"]),))
    return {
        "subscription_id": sub["id"] if sub else None,
        "traffic_reset": bool(res.get("ok")),
        "remnawave": {"ok": bool(res.get("ok")), "error": res.get("error")},
    }


def _create_subscription_row(
    *,
    user: dict[str, Any],
    devices: int,
    expire_at: datetime,
    provision: dict[str, Any],
    traffic_gb: int = REGULAR_TRAFFIC_GB,
    sub_type: str = "vpn",
    squads: Optional[list[str]] = None,
) -> dict[str, Any]:
    key_uuid = str(_uuid.uuid4())
    short = provision.get("short_uuid") or key_uuid.split("-")[0]
    rw_id = provision.get("rw_id") or str(_uuid.uuid4())
    key_config = provision.get("subscription_url") or provisioning.local_fallback_config(short)
    now = db.utcnow_iso()
    db.execute(
        "INSERT INTO subscriptions (user_id, rw_id, key_uuid, short_uuid, key_config, status, expires_at, "
        "devices_limit, devices_used, traffic_used, traffic_limit, custom_name, type, squads_json, created_at) "
        "VALUES (?, ?, ?, ?, ?, 'Active', ?, ?, 0, 0, ?, NULL, ?, ?, ?)",
        (
            int(user["id"]), rw_id, key_uuid, short, key_config, iso(expire_at),
            int(max(1, devices)), int(traffic_gb), sub_type,
            db.dumps(squads if squads is not None else vpn_squads()), now,
        ),
    )
    sub = db.fetchone("SELECT * FROM subscriptions WHERE id = ?", (db.last_id(),))
    _sync_user_status(int(user["id"]))
    assert sub is not None
    return sub


def grant_trial(user: dict[str, Any]) -> dict[str, Any]:
    telegram_id = int(user["telegram_id"]) if user.get("telegram_id") else None
    t_days, t_gb, t_dev = trial_days(), trial_traffic_gb(), trial_devices()
    new_exp = utcnow() + timedelta(days=t_days)
    prov = provisioning.provision(
        user_id=int(user["id"]), telegram_id=telegram_id, username=user.get("username"), expire_at=new_exp,
        devices=t_dev, squads=trial_squads(), email=user.get("email"),
        traffic_limit_bytes=t_gb * GB, traffic_reset_strategy=RESET_STRATEGY,
    )
    if provisioning.is_configured() and not prov.get("ok"):
        raise RuntimeError(prov.get("error") or "remnawave_failed")
    sub = _create_subscription_row(
        user=user, devices=t_dev, expire_at=new_exp, provision=prov,
        traffic_gb=t_gb, sub_type="trial", squads=trial_squads(),
    )
    # метка проверки подключения пробной (~15 мин)
    try:
        db.execute(
            "INSERT INTO trial_checks (subscription_id, user_id, telegram_id, granted_at, checked) "
            "VALUES (?, ?, ?, ?, 0)",
            (sub["id"], int(user["id"]), telegram_id, db.utcnow_iso()),
        )
    except Exception:  # noqa: BLE001
        pass
    bypass = _grant_trial_bypass(user)
    return {
        "subscription_id": sub["id"],
        "expires_at": sub.get("expires_at"),
        "devices": t_dev,
        "traffic_gb": t_gb,
        "remnawave": prov,
        "bypass": bypass,
    }


def _grant_trial_bypass(user: dict[str, Any]) -> dict[str, Any]:
    """бесплатный пробный ключ обхода (FURK POST /keys/trial) вместе с пробным VPN.
    Срок и трафик задаются в настройках приложения FURK. Best-effort: сбой FURK не ломает
    выдачу пробного VPN, ошибка уходит в лог."""
    if not trial_bypass_enabled():
        return {"ok": False, "skipped": "disabled"}
    if not whitelist_available():
        return {"ok": False, "skipped": "furk_not_configured"}
    uid = int(user["id"])
    idem = f"trial-{uid}"
    try:
        cur = user_whitelist(user)
        if cur["active"] or cur["key_id"]:
            return {"ok": True, "skipped": "has_key"}  # ключ уже был — второй бесплатный не выдаём
        key = furk.create_trial_key(idem=f"blin-{idem}")
        if not key.get("id"):
            raise RuntimeError("в ответе FURK нет id ключа")
        until = None
        try:
            if key.get("expires_at"):
                until = iso(datetime.fromtimestamp(int(key["expires_at"]), tz=timezone.utc))
        except (TypeError, ValueError, OSError):
            until = None
        if not until:
            until = iso(utcnow() + timedelta(days=trial_days()))
        db.execute("UPDATE users SET anti_key = ?, anti_key_id = ?, anti_expires_at = ?, anti_last_idem = ? "
                   "WHERE id = ?", (key.get("subscription_url"), str(key["id"]), until, idem, uid))
        return {"ok": True, "until": until}
    except Exception as exc:  # noqa: BLE001
        code = getattr(exc, "code", None)
        print(f"[trial] ключ обхода не выдан user {uid}: {type(exc).__name__} {code or ''}: {exc}", flush=True)
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "error_code": code}


def _apply_provision_to_sub(sub: dict[str, Any], provision: dict[str, Any]) -> None:
    if not provision.get("ok"):
        return
    sets, params = [], []
    if provision.get("rw_id"):
        sets.append("rw_id = ?")
        params.append(provision["rw_id"])
    if provision.get("short_uuid"):
        sets.append("short_uuid = ?")
        params.append(provision["short_uuid"])
    if provision.get("subscription_url"):
        sets.append("key_config = ?")
        params.append(provision["subscription_url"])
    if not sets:
        return
    params.append(sub["id"])
    db.execute(f"UPDATE subscriptions SET {', '.join(sets)} WHERE id = ?", params)


def find_extend_target(
    user_id: int, purpose: str, subscription_id: Optional[int]
) -> tuple[Optional[dict[str, Any]], bool]:
    target: Optional[dict[str, Any]] = None
    if purpose == "extend" and subscription_id:
        target = db.fetchone(
            "SELECT * FROM subscriptions WHERE id = ? AND user_id = ? AND status != 'Deleted'",
            (subscription_id, user_id),
        )
    if target is None:
        target = db.fetchone(
            "SELECT * FROM subscriptions WHERE user_id = ? AND status != 'Deleted' AND type != 'trial' "
            "ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at DESC, id DESC LIMIT 1",
            (user_id,),
        )
    if target is None:
        target = db.fetchone(
            "SELECT * FROM subscriptions WHERE user_id = ? AND status != 'Deleted' AND type = 'trial' "
            "ORDER BY id DESC LIMIT 1",
            (user_id,),
        )
        return target, target is not None
    return target, False


# ── доп. устройства со своим сроком ──
DEVICE_ADDON_MONTHS = (1, 3, 6, 12)


def active_addon_devices(subscription_id: Optional[int]) -> int:
    """сколько устройств подписки куплено отдельно и ещё действует."""
    if not subscription_id:
        return 0
    row = db.fetchone(
        "SELECT COALESCE(SUM(count), 0) AS n FROM device_addons WHERE subscription_id = ? AND status = 'active'",
        (int(subscription_id),),
    )
    return int((row or {}).get("n") or 0)


def device_addons_for(subscription_id: Optional[int]) -> list[dict[str, Any]]:
    if not subscription_id:
        return []
    return db.fetchall(
        "SELECT count, months, expires_at FROM device_addons WHERE subscription_id = ? AND status = 'active' "
        "ORDER BY expires_at ASC",
        (int(subscription_id),),
    )


def record_device_addon(*, user_id: int, subscription_id: int, count: int, months: int,
                        payment_id: Optional[str]) -> None:
    now = utcnow()
    months = int(months) if int(months or 1) in DEVICE_ADDON_MONTHS else 1
    db.execute(
        "INSERT INTO device_addons (user_id, subscription_id, payment_id, count, months, status, created_at, expires_at) "
        "VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
        (int(user_id), int(subscription_id), payment_id, max(1, int(count or 1)), months,
         iso(now), iso(now + timedelta(days=DAYS_PER_MONTH * months))),
    )


def expire_device_addons(log=print) -> int:
    """истёкшие доп. устройства: уменьшить лимит подписки и в remnawave."""
    now = utcnow()
    rows = db.fetchall(
        "SELECT * FROM device_addons WHERE status = 'active' AND expires_at <= ? ORDER BY expires_at ASC",
        (iso(now),),
    )
    done = 0
    for a in rows:
        # claim: один победитель
        claim = db.execute(
            "UPDATE device_addons SET status = 'expired', ended_at = ? WHERE id = ? AND status = 'active'",
            (iso(now), a["id"]),
        )
        if claim.rowcount == 0:
            continue
        sub = db.fetchone("SELECT * FROM subscriptions WHERE id = ?", (a["subscription_id"],))
        if not sub or sub.get("status") in ("Deleted", "Refunded"):
            done += 1
            continue
        cur = int(sub.get("devices_limit") or 1)
        new_dev = max(1, cur - int(a.get("count") or 1))
        db.execute("UPDATE subscriptions SET devices_limit = ? WHERE id = ?", (new_dev, sub["id"]))
        user = get_user(int(sub["user_id"]))
        if user and provisioning.is_configured():
            try:
                expire_dt = parse_iso(sub.get("expires_at")) or now
                provisioning.provision(
                    user_id=int(user["id"]),
                    telegram_id=int(user["telegram_id"]) if user.get("telegram_id") else None,
                    username=user.get("username"), email=user.get("email"),
                    expire_at=expire_dt, devices=new_dev, squads=squads_for_sub(sub),
                )
            except Exception as exc:  # noqa: BLE001
                try:
                    forum.report_error("Не удалось снять истёкшие доп. устройства в Remnawave",
                                       f"sub {sub['id']}: {type(exc).__name__}: {exc}")
                except Exception:  # noqa: BLE001
                    pass
        log(f"[devices] sub {sub['id']}: доп. устройства истекли, лимит {cur} → {new_dev}")
        done += 1
    return done


def expire_whitelists(log=print) -> int:
    """белые списки теперь — анти-ключ FURK: его срок истекает у провайдера, ключ остаётся
    у пользователя для продления (как в старом боте). Здесь только снимаем сквад белых списков
    с подписок, оформленных по старой схеме (whitelist_until в subscriptions)."""
    now = utcnow()
    rows = db.fetchall("SELECT * FROM subscriptions WHERE whitelist_until IS NOT NULL")
    done = 0
    for sub in rows:
        claim = db.execute(
            "UPDATE subscriptions SET whitelist_until = NULL, squads_json = ? WHERE id = ? AND whitelist_until = ?",
            (db.dumps(vpn_squads()), sub["id"], sub["whitelist_until"]),
        )
        if claim.rowcount == 0:
            continue
        done += 1
        exp = parse_iso(sub.get("expires_at"))
        # подписка ещё идёт → снять сквад в remnawave; истёкшую не трогаем
        if sub.get("status") != "Active" or not exp or exp <= now or not provisioning.is_configured():
            continue
        user = get_user(int(sub["user_id"]))
        if not user:
            continue
        try:
            provisioning.provision(
                user_id=int(user["id"]),
                telegram_id=int(user["telegram_id"]) if user.get("telegram_id") else None,
                username=user.get("username"), email=user.get("email"),
                expire_at=exp, devices=int(sub.get("devices_limit") or 1), squads=vpn_squads(),
            )
        except Exception as exc:  # noqa: BLE001
            try:
                forum.report_error("Не удалось снять белые списки в Remnawave", f"sub {sub['id']}: {exc}")
            except Exception:  # noqa: BLE001
                pass
        log(f"[whitelist] sub {sub['id']}: срок белых списков закончился")
    return done


def retained_devices(user_id: int, purpose: str, subscription_id: Optional[int],
                     total_devices: int) -> int:
    target, upgrading_trial = find_extend_target(user_id, purpose, subscription_id)
    if not target or upgrading_trial:
        return 0
    current = int(target.get("devices_limit") or 1) - active_addon_devices(target.get("id"))
    return max(0, current - int(total_devices))


def grant_subscription(
    *,
    user: dict[str, Any],
    purpose: str,
    plan_devices: Optional[int],
    months: int,
    extra_devices: int,
    subscription_id: Optional[int],
    whitelist: bool = False,
    idem_key: Optional[str] = None,
) -> dict[str, Any]:
    months = max(1, int(months or 1))
    added_days = PERIOD_DAYS.get(months, DAYS_PER_MONTH * months)
    # пользователи только с email: поиск в remnawave по email
    telegram_id = int(user["telegram_id"]) if user.get("telegram_id") else None
    username = user.get("username")
    email = user.get("email")

    if purpose == "devices" and subscription_id:
        # добавить устройства, срок не трогаем
        sub = db.fetchone(
            "SELECT * FROM subscriptions WHERE id = ? AND user_id = ? AND status = 'Active'",
            (subscription_id, user["id"]),
        )
        if not sub:
            raise ValueError("subscription_not_found")
        new_devices = int(sub.get("devices_limit") or 1) + max(1, int(extra_devices or 1))
        expire_dt = parse_iso(sub.get("expires_at")) or (utcnow() + timedelta(days=added_days))
        prov = provisioning.provision(
            user_id=int(user["id"]), telegram_id=telegram_id, username=username, expire_at=expire_dt,
            devices=new_devices, squads=squads_for_sub(sub), email=email,
        )
        db.execute(
            "UPDATE subscriptions SET devices_limit = ? WHERE id = ?",
            (new_devices, sub["id"]),
        )
        _apply_provision_to_sub(sub, prov)
        return {
            "subscription_id": sub["id"],
            "expires_at": sub.get("expires_at"),
            "devices": new_devices,
            "remnawave": prov,
            "undo": {"kind": "devices", "sub_id": sub["id"],
                     "added_devices": new_devices - int(sub.get("devices_limit") or 1),
                     "devices_before": int(sub.get("devices_limit") or 1), "devices_after": new_devices},
        }

    # тот же выбор цели, что при расчёте цены
    target, upgrading_trial = find_extend_target(int(user["id"]), purpose, subscription_id)

    total_devices = int(plan_devices or 1) + max(0, int(extra_devices or 0))

    if target:
        base = parse_iso(target.get("expires_at")) or utcnow()
        if base < utcnow():
            base = utcnow()
        new_exp = base + timedelta(days=added_days)
        prev_devices = int(target.get("devices_limit") or 1)
        # trial→paid: число устройств как у платной, не max(старое, платное).
        # Отдельно купленные доп. устройства (со своим сроком) идут сверху: иначе докупка
        # при продлении «растворялась» бы в них (5 = 3 + 2 доп., продлили на 4 → осталось бы 5)
        addons = 0 if upgrading_trial else active_addon_devices(target.get("id"))
        base_now = max(1, prev_devices - addons)
        new_devices = total_devices if upgrading_trial else max(base_now, total_devices) + addons
        new_devices = max(1, new_devices)
        squads = squads_for()
        prov = provisioning.provision(
            user_id=int(user["id"]), telegram_id=telegram_id, username=username, expire_at=new_exp,
            devices=new_devices, squads=squads, email=email,
            traffic_limit_bytes=paid_traffic_gb() * GB, traffic_reset_strategy=RESET_STRATEGY,
            reset_traffic=upgrading_trial,  # clear trial traffic on upgrade
        )
        db.execute(
            "UPDATE subscriptions SET expires_at = ?, status = 'Active', devices_limit = ?, "
            "traffic_limit = ?, traffic_used = CASE WHEN ? THEN 0 ELSE traffic_used END, "
            "type = 'vpn', squads_json = ? WHERE id = ?",
            (iso(new_exp), new_devices, paid_traffic_gb(), 1 if upgrading_trial else 0,
             db.dumps(squads), target["id"]),
        )
        wl = _grant_whitelist_safe(user, months, idem_key) if whitelist else None
        _apply_provision_to_sub(target, prov)
        _sync_user_status(int(user["id"]))
        if db.fetchone("SELECT id FROM subscriptions WHERE user_id = ? AND grace_until IS NOT NULL LIMIT 1", (int(user["id"]),)):
            # продление в grace → вернуть обычный доступ
            try:
                try:
                    from . import grace  # type: ignore
                except ImportError:
                    import grace  # type: ignore
                grace.end_for_user(int(user["id"]))
            except Exception:  # noqa: BLE001
                pass
        return {
            "subscription_id": target["id"],
            "expires_at": iso(new_exp),
            "devices": new_devices,
            "remnawave": prov,
            # payload отката для возвратов
            "undo": {"kind": "extend", "sub_id": target["id"],
                     "added_seconds": int((new_exp - base).total_seconds()),
                     "added_devices": new_devices - prev_devices,
                     "upgraded_trial": bool(upgrading_trial),
                     "prev_devices": prev_devices,
                     "prev_expires_at": target.get("expires_at"),
                     "end_at": iso(new_exp),
                     "prev_traffic_limit": target.get("traffic_limit"),
                     "prev_squads_json": target.get("squads_json"),
                     **_wl_undo(wl)},
            "whitelist": wl,
        }

    # новая подписка
    new_exp = utcnow() + timedelta(days=added_days)
    squads = squads_for()
    prov = provisioning.provision(
        user_id=int(user["id"]), telegram_id=telegram_id, username=username, expire_at=new_exp,
        devices=max(1, total_devices), squads=squads, email=email,
        traffic_limit_bytes=paid_traffic_gb() * GB, traffic_reset_strategy=RESET_STRATEGY,
    )
    sub = _create_subscription_row(
        user=user, devices=max(1, total_devices), expire_at=new_exp, provision=prov,
        traffic_gb=paid_traffic_gb(), sub_type="vpn", squads=squads,
    )
    wl = _grant_whitelist_safe(user, months, idem_key) if whitelist else None
    return {
        "subscription_id": sub["id"],
        "expires_at": sub.get("expires_at"),
        "devices": int(sub.get("devices_limit") or total_devices),
        "remnawave": prov,
        "undo": {"kind": "new", "sub_id": sub["id"], "added_seconds": int(added_days * 86400),
                 "devices": max(1, total_devices), "end_at": iso(new_exp), **_wl_undo(wl)},
        "whitelist": wl,
    }


def _grant_whitelist_safe(user: dict[str, Any], months: int, idem: Optional[str] = None) -> dict[str, Any]:
    """анти-ключ после продления ВПН; ошибка FURK не отменяет подписку — алерт админу (как в старом боте)."""
    res = grant_whitelist(user, months, idem=idem)
    if not res.get("ok"):
        title = ("FURK: недостаточно средств на балансе партнёра — белые списки НЕ выданы"
                 if res.get("error_code") == "INSUFFICIENT_FUNDS"
                 else "Ошибка при работе с FURK API — белые списки НЕ выданы")
        try:
            forum.report_error(
                title,
                f"user id{user.get('id')}, {months} мес., ключ {res.get('prev_key_id') or '—'}: {res.get('error')}. "
                f"Выдайте вручную после исправления.",
            )
        except Exception:  # noqa: BLE001
            pass
    return res


def _wl_undo(wl: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not wl:
        return {"whitelist": False}
    return {"whitelist": bool(wl.get("ok")), "anti_key": wl.get("key"), "anti_key_id": wl.get("key_id"),
            "prev_anti_key": wl.get("prev_key"), "prev_anti_key_id": wl.get("prev_key_id"),
            "prev_anti_until": wl.get("prev_until"), "anti_until": wl.get("until")}


def fulfill_payment(
    payment_id: str,
    *,
    provider_payment_id: Optional[str] = None,
    amount: Optional[float] = None,
    stars_charge_id: Optional[str] = None,
    stars_payer_id: Optional[int] = None,
) -> dict[str, Any]:
    payment = get_payment(payment_id)
    if not payment:
        return {"ok": False, "error": "payment_not_found", "payment_id": payment_id}

    # повторный charge stars по тому же invoice → авто-возврат
    if (stars_charge_id and payment.get("provider") == "tg_stars" and payment["status"] in ("paid", "processing")
            and payment.get("provider_payment_id") and str(payment.get("provider_payment_id")) != str(stars_charge_id)):
        _refund_duplicate_stars(payment, stars_charge_id, stars_payer_id)
        return {"ok": True, "already": True, "duplicate_refunded": True, "payment_id": payment_id,
                "subscription_id": payment.get("subscription_id")}

    if payment["status"] == "paid":
        return {"ok": True, "already": True, "payment_id": payment_id,
                "subscription_id": payment.get("subscription_id")}

    if payment["status"] in ("failed", "refunded"):
        return {"ok": False, "error": "payment_failed", "payment_id": payment_id}

    # отклонить недоплату
    expected = _expected_provider_amount(payment)
    if amount is not None and expected > 0:
        try:
            paid = float(amount)
        except (TypeError, ValueError):
            paid = 0.0
        if paid + 0.01 < expected:
            mark_failed(payment_id, f"amount_mismatch: paid {paid} < expected {expected}")
            try:
                forum.report_error(
                    "Недоплата по платежу — подписка НЕ выдана",
                    f"payment_id={payment_id}, оплачено {paid}, ожидалось {expected}",
                )
            except Exception:  # noqa: BLE001
                pass
            return {"ok": False, "error": "amount_mismatch", "payment_id": payment_id}

    # claim pending→processing (один победитель); сразу сохранить id charge stars
    claim = db.execute(
        "UPDATE payments SET status = 'processing', processing_at = ?, "
        "provider_payment_id = COALESCE(provider_payment_id, ?) WHERE payment_id = ? AND status = 'pending'",
        (db.utcnow_iso(), stars_charge_id if payment.get("provider") == "tg_stars" else None, payment_id),
    )
    if claim.rowcount == 0:
        fresh = get_payment(payment_id)
        st = (fresh or {}).get("status")
        if (stars_charge_id and fresh and fresh.get("provider") == "tg_stars" and st in ("paid", "processing")
                and fresh.get("provider_payment_id") and str(fresh["provider_payment_id"]) != str(stars_charge_id)):
            _refund_duplicate_stars(fresh, stars_charge_id, stars_payer_id)
            return {"ok": True, "already": True, "duplicate_refunded": True, "payment_id": payment_id}
        if st == "paid":
            return {"ok": True, "already": True, "payment_id": payment_id,
                    "subscription_id": (fresh or {}).get("subscription_id")}
        # уже processing или финальный статус
        return {"ok": False, "error": "already_processing", "payment_id": payment_id}

    user = get_user(int(payment["user_id"]))
    if not user:
        mark_failed(payment_id, "user_not_found")
        return {"ok": False, "error": "user_not_found", "payment_id": payment_id}

    _purpose = payment.get("purpose") or "subscription"
    try:
        if _purpose == "traffic_reset":
            grant = _grant_traffic_reset(user)
        elif _purpose == "gift":
            # подарок другу: создаём код, подписку получит тот, кто его активирует
            try:
                from . import reflevels  # type: ignore
            except ImportError:
                import reflevels  # type: ignore
            gift_code = reflevels.create_bought_gift(int(user["id"]), int(payment.get("months") or 1), payment_id,
                                                     whitelist=bool(payment.get("whitelist")))
            grant = {"subscription_id": None, "remnawave": {"ok": True},
                     "undo": {"kind": "gift", "code": gift_code, "months": int(payment.get("months") or 1)}}
        else:
            grant = grant_subscription(
                user=user,
                purpose=_purpose,
                plan_devices=payment.get("plan_devices"),
                months=int(payment.get("months") or 1),
                extra_devices=int(payment.get("extra_devices") or 0),
                subscription_id=payment.get("subscription_id"),
                whitelist=bool(payment.get("whitelist")),
                idem_key=payment_id,
            )
    except Exception as exc:  # noqa: BLE001
        # выдача не удалась → снова pending для повтора
        db.execute(
            "UPDATE payments SET status = 'pending' WHERE payment_id = ? AND status = 'processing'",
            (payment_id,),
        )
        try:
            forum.report_error("Ошибка выдачи подписки после оплаты",
                               f"payment_id={payment_id}: {type(exc).__name__}: {exc}")
        except Exception:  # noqa: BLE001
            pass
        return {"ok": False, "error": "grant_failed", "payment_id": payment_id}

    if _purpose == "devices" and grant.get("subscription_id"):
        try:
            record_device_addon(
                user_id=int(user["id"]), subscription_id=int(grant["subscription_id"]),
                count=int((grant.get("undo") or {}).get("added_devices") or payment.get("extra_devices") or 1),
                months=int(payment.get("months") or 1), payment_id=payment_id,
            )
        except Exception as exc:  # noqa: BLE001
            try:
                forum.report_error("Не удалось записать срок доп. устройств", f"payment_id={payment_id}: {exc}")
            except Exception:  # noqa: BLE001
                pass

    now = db.utcnow_iso()
    db.execute(
        "UPDATE payments SET status = 'paid', paid_at = ?, subscription_id = ?, "
        "provider_payment_id = COALESCE(?, provider_payment_id), grant_info = ? "
        "WHERE payment_id = ? AND status = 'processing'",
        (now, grant.get("subscription_id"), provider_payment_id or stars_charge_id,
         db.dumps(grant.get("undo") or {"kind": _purpose}), payment_id),
    )
    db.execute(
        "UPDATE transactions SET status = 'completed' WHERE payment_id = ?",
        (payment_id,),
    )

    _credit_referral(user, float(payment.get("amount") or 0), payment.get("currency") or "RUB", payment.get("payment_id"))
    # атрибуция выручки по трекинг-ссылке
    try:
        services.credit_tracking_payment(int(user["id"]), float(payment.get("amount") or 0))
    except Exception:  # noqa: BLE001
        pass

    # оплачено, но выдача в remnawave упала → алерт админу (кроме traffic_reset)
    rw = grant.get("remnawave") or {}
    if _purpose != "traffic_reset" and not rw.get("ok"):
        try:
            forum.report_error(
                "Оплата прошла, но подписка в Remnawave НЕ выдана",
                f"payment_id={payment_id}, user id{user.get('id')}, ошибка: {rw.get('error')}",
            )
        except Exception:  # noqa: BLE001
            pass

    _notify_admin(user, payment, grant)

    # API v1: запись в purchases; если Remnawave не ответил — задача в очередь выдачи
    try:
        try:
            from . import apiv1_store  # type: ignore
        except ImportError:
            import apiv1_store  # type: ignore
        apiv1_store.on_payment_fulfilled(payment_id, grant)
    except Exception as exc:  # noqa: BLE001
        print(f"[api-v1] on_payment_fulfilled {payment_id}: {exc}", flush=True)

    return {
        "ok": True,
        "payment_id": payment_id,
        "subscription_id": grant.get("subscription_id"),
        "expires_at": grant.get("expires_at"),
        "remnawave_ok": bool((grant.get("remnawave") or {}).get("ok")),
    }


def _refund_duplicate_stars(payment: dict[str, Any], charge_id: str, payer_id: Optional[int] = None) -> None:
    tg = payer_id or (get_user(int(payment["user_id"])) or {}).get("telegram_id")
    ok = False
    if tg:
        try:
            ok = notifier.call("refundStarPayment", {"user_id": int(tg), "telegram_payment_charge_id": str(charge_id)}) is not None
        except Exception:  # noqa: BLE001
            ok = False
    try:
        forum.report_error("Повторная оплата одного счёта в Stars",
                           f"payment_id={payment['payment_id']}, charge={charge_id}: " + ("возвращено автоматически" if ok else "ВЕРНИТЕ ВРУЧНУЮ"))
    except Exception:  # noqa: BLE001
        pass


def stars_precheckout_ok(payment: Optional[dict[str, Any]], query: dict[str, Any]) -> bool:
    if not payment or payment.get("status") != "pending" or payment.get("provider") != "tg_stars":
        return False
    if str(query.get("currency") or "") != "XTR":
        return False
    try:
        return int(query.get("total_amount") or 0) == int(payment.get("stars") or 0) > 0
    except (TypeError, ValueError):
        return False


def confirm_via_provider(payment_id: str) -> dict[str, Any]:
    payment = get_payment(payment_id)
    if not payment:
        return {"ok": False, "status": "not_found"}
    if payment["status"] == "paid":
        return {"ok": True, "status": "paid", "subscription_id": payment.get("subscription_id")}
    if payment["status"] == "failed":
        return {"ok": False, "status": "failed"}
    if payment.get("provider") != "yookassa" or not payment.get("provider_payment_id"):
        return {"ok": True, "status": "pending"}

    try:
        import yookassa  # type: ignore
        client = yookassa.get_client()
        if not client.is_configured():
            return {"ok": True, "status": "pending"}
        yp = client.get_payment(str(payment["provider_payment_id"]))
        if not yookassa.YooKassaClient.matches(yp, payment_id):
            return {"ok": False, "status": "pending", "note": "payload_mismatch"}
        norm = yookassa.YooKassaClient.normalize_status(yp.get("status"))
        if norm == "paid":
            res = fulfill_payment(
                payment_id,
                provider_payment_id=str(payment["provider_payment_id"]),
                amount=yookassa.YooKassaClient.payment_amount(yp),
            )
            return {"ok": res.get("ok", False), "status": "paid" if res.get("ok") else "pending",
                    "subscription_id": res.get("subscription_id")}
        if norm == "failed":
            mark_failed(payment_id, "provider_canceled")
            return {"ok": False, "status": "failed"}
        return {"ok": True, "status": "pending"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": True, "status": "pending", "note": f"{type(exc).__name__}"}


STUCK_PROCESSING_MIN = 10  # «processing» дольше - процесс упал посреди выдачи
RECHECK_AFTER_MIN = 3  # перепроверять у ЮKassa не раньше чем через 3 мин
UNPAID_EXPIRE_HOURS = 24  # неоплаченный платёж через сутки отменяется
RECONCILE_BATCH = 50


def reconcile_payments(log=print) -> dict[str, int]:
    now = utcnow()
    stats = {"unstuck": 0, "confirmed": 0, "expired": 0}

    stuck_before = iso(now - timedelta(minutes=STUCK_PROCESSING_MIN))
    cur = db.execute(
        "UPDATE payments SET status = 'pending' WHERE status = 'processing' "
        "AND (processing_at IS NULL OR processing_at < ?)",
        (stuck_before,),
    )
    stats["unstuck"] = cur.rowcount or 0

    recheck_before = iso(now - timedelta(minutes=RECHECK_AFTER_MIN))
    rows = db.fetchall(
        "SELECT payment_id FROM payments WHERE status = 'pending' AND provider = 'yookassa' "
        "AND provider_payment_id IS NOT NULL AND created_at < ? ORDER BY created_at DESC LIMIT ?",
        (recheck_before, RECONCILE_BATCH),
    )
    for r in rows:
        try:
            res = confirm_via_provider(str(r["payment_id"]))
            if res.get("status") == "paid" and res.get("ok"):
                stats["confirmed"] += 1
        except Exception:  # noqa: BLE001
            pass

    expire_before = iso(now - timedelta(hours=UNPAID_EXPIRE_HOURS))
    for r in db.fetchall(
        "SELECT payment_id FROM payments WHERE status = 'pending' AND created_at < ? LIMIT ?",
        (expire_before, RECONCILE_BATCH),
    ):
        mark_failed(str(r["payment_id"]), "expired_unpaid")
        stats["expired"] += 1

    if any(stats.values()):
        log(f"[payments] сверка: {stats}")
    return stats


def _credit_referral(user: dict[str, Any], amount: float, currency: str, payment_id: Optional[str] = None) -> None:
    try:
        ref_by = user.get("referred_by")
        if not ref_by or amount <= 0 or currency not in ("RUB",):
            return
        referrer = get_user(int(ref_by))
        if not referrer:
            return
        # ставка уровня (или индивидуальная из панели)
        try:
            from . import reflevels  # type: ignore
        except ImportError:
            import reflevels  # type: ignore
        rate = reflevels.effective_rate(referrer)
        bonus = round(amount * rate / 100.0, 2)
        if bonus <= 0:
            return
        # баланс, транзакция и строка леджера (API v1) — атомарно
        with db.transaction() as conn:
            conn.execute(
                "UPDATE users SET partner_balance = partner_balance + ? WHERE id = ?",
                (bonus, referrer["id"]),
            )
            conn.execute(
                "INSERT INTO transactions (user_id, amount, status, payment_method, hash, payment_id, description, created_at) "
                "VALUES (?, ?, 'completed', 'referral', ?, ?, ?, ?)",
                # хеш pay:<id>, чтобы возврат мог забрать бонус
                (referrer["id"], bonus, f"pay:{payment_id}" if payment_id else secrets.token_hex(8), secrets.token_hex(8),
                 f"referral bonus from user {user['id']}", db.utcnow_iso()),
            )
            conn.execute(
                "INSERT INTO referral_ledger (user_id, kind, amount, ref_user_id, payment_id, created_at) "
                "VALUES (?, 'accrual', ?, ?, ?, ?)",
                (referrer["id"], bonus, int(user["id"]), payment_id, db.utcnow_iso()),
            )
    except Exception:  # noqa: BLE001
        pass


def _notify_admin(user: dict[str, Any], payment: dict[str, Any], grant: dict[str, Any]) -> None:
    is_stars = payment.get("provider") == "tg_stars"
    if is_stars:
        amount = payment.get("stars") or payment.get("amount")
        currency = " ⭐"
        method = "tg_stars"
    else:
        amount = payment.get("amount")
        currency = "₽"
        method = payment.get("method") or "sbp"
    try:
        forum.notify_purchase(user, _fmt_amount(amount), method, currency=currency)
    except Exception:  # noqa: BLE001
        pass


def _fmt_amount(v: Any) -> str:
    try:
        f = float(v)
        return str(int(f)) if f == int(f) else f"{f:.2f}"
    except (TypeError, ValueError):
        return str(v)
