# Перенос старой базы бота FGN (bot2.db, SQLAlchemy-бот до платформы) в проект fgn новой платформы.
#
# Шаги (каждый — отдельная команда, всё пишет подробный отчёт):
#   check     — только чтение: что и сколько будет перенесено, что вызывает вопросы. Ничего не меняет.
#   import    — база: одна транзакция (всё или ничего) + ПОЛНЫЙ архив старой базы в таблицах legacy_fgn_*.
#               Повторный запуск отказывается (перенос уже сделан).
#   adopt     — Remnawave: пользователь старого бота (найден по shortUuid из ключа) переименовывается
#               в batman_<id> — ключ у человека НЕ меняется, дальше подписку продлевает новая платформа.
#               Только живые подписки (действуют или истекли меньше 7 дней назад). Можно частями (--limit),
#               повторный запуск продолжает с места остановки.
#   provision — живая подписка без ключа (в старой базе ключ пустой/битый): выдать новый ключ.
#   verify    — сверка старой и новой базы построчно: люди, сроки, платежи, рефералы, подарки, архив.
#
# Запуск на сервере (контейнер api):  docker exec -it blinvpn-api python legacy_fgn.py check --old /app/data/bot2.db
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import uuid as _uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (_HERE, os.path.join(_HERE, "..", "api")):
    _p = os.path.abspath(_p)
    if _p not in sys.path:
        sys.path.insert(0, _p)

import database as db  # type: ignore  # noqa: E402

projects = db.projects

PROJECT = "fgn"
SETTING = "legacy_fgn_import"            # отметка «перенос сделан» + итоги
ARCHIVE_PREFIX = "legacy_fgn_"           # полный архив старой базы
PAY_PREFIX = "fgnold:"                   # payment_id перенесённых платежей
OLD_BASE_DEVICES = 5                     # в старом боте тариф — 5 устройств (users.device_limit DEFAULT 5)
DELETE_AFTER = timedelta(days=7)         # как fulfillment.DELETE_AFTER_DAYS: дольше — подписка «удалена»
OB_STAGES = ("m30", "h24", "h48", "h71", "h72")
KEY_RE = re.compile(r"^https?://[^/\s]+/([A-Za-z0-9_-]{6,64})/?$")


def log(msg: str) -> None:
    print(msg, flush=True)


# ── время: в старой базе naive UTC «YYYY-MM-DD HH:MM:SS.ffffff» ──

def parse_old(v: Any) -> Optional[datetime]:
    if v is None or v == "":
        return None
    s = str(v).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s.replace(" ", "T", 1) if "T" not in s else s)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def now() -> datetime:
    return datetime.now(timezone.utc)


def key_short(vpn_key: Any) -> Optional[str]:
    m = KEY_RE.match(str(vpn_key or "").strip())
    return m.group(1) if m else None


def gift_code_new(old: str) -> str:
    """GIFT_AB12CD34 → GIFT-AB12CD34, GIFTN_AB12CD34 → GIFT-NAB12CD34 (reflevels.normalize_gift_code делает так же)."""
    c = str(old or "").strip().upper()
    if c.startswith("GIFTN_"):
        return "GIFT-N" + c[6:]
    if c.startswith("GIFT_"):
        return "GIFT-" + c[5:]
    return c


# ── платёж: назначение по описанию старого бота ──

_RE_PLAN = re.compile(r"^Оплата подписки: (vpn|anti|bal)_(\d+)$")
_RE_DEV = re.compile(r"^Оплата устройств: (\d+) на (\d+) мес")
_RE_MONTHS = re.compile(r"(\d+)\s*(?:мес|месяц)")
_RE_DEVICES = re.compile(r"\((\d+)\s*устройств")


def classify_payment(desc: str, months: int) -> dict[str, Any]:
    d = str(desc or "").strip()
    out = {"purpose": "extend", "months": max(1, int(months or 1)), "extra_devices": 0, "plan_devices": None,
           "whitelist": 0}
    m = _RE_PLAN.match(d)
    if m:
        kind, n = m.group(1), int(m.group(2))
        if kind == "bal":
            out.update(purpose="topup", months=1)
        else:
            out.update(months=n, whitelist=1 if kind == "anti" else 0)
        return out
    m = _RE_DEV.match(d)
    if m:
        out.update(purpose="devices", extra_devices=int(m.group(1)), months=int(m.group(2)))
        return out
    if d.lower().startswith("покупка подарка"):
        out["purpose"] = "gift"
    if "anti" in d.lower() or "обход" in d.lower():
        out["whitelist"] = 1
    m = _RE_MONTHS.search(d)
    if m:
        out["months"] = int(m.group(1))
    m = _RE_DEVICES.search(d)
    if m:
        out["plan_devices"] = int(m.group(1))
    return out


# ── старая база ──

def open_old(path: str) -> sqlite3.Connection:
    if not os.path.isfile(path):
        raise SystemExit(f"Нет файла старой базы: {path}")
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    return c


EXPECTED_TABLES = {
    "admins", "anti_keys", "gifts", "notification_logs", "payment_history", "processed_payments",
    "promocode_usage", "promocodes", "referral_earnings", "referral_withdrawals", "settings",
    "user_language", "users", "white_list",
}


def old_count(c: sqlite3.Connection, table: str) -> int:
    """число строк полным проходом по таблице: в старой базе битый индекс users (COUNT(*) по нему теряет строку)."""
    return int(c.execute(f'SELECT COUNT(*) FROM "{table}" NOT INDEXED').fetchone()[0])


def old_integrity(c: sqlite3.Connection) -> list[str]:
    return [str(r[0]) for r in c.execute("PRAGMA integrity_check(100)").fetchall() if str(r[0]) != "ok"]


def old_tables(c: sqlite3.Connection) -> list[str]:
    return [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")]


def load_old(c: sqlite3.Connection) -> dict[str, Any]:
    users = [dict(r) for r in c.execute("SELECT * FROM users NOT INDEXED ORDER BY id")]
    pays = [dict(r) for r in c.execute("SELECT * FROM payment_history ORDER BY id")]
    return {
        "users": users,
        "payments": pays,
        "gifts": [dict(r) for r in c.execute("SELECT * FROM gifts ORDER BY id")],
        "earnings": [dict(r) for r in c.execute("SELECT * FROM referral_earnings ORDER BY id")],
        "withdrawals": [dict(r) for r in c.execute("SELECT * FROM referral_withdrawals ORDER BY id")],
        "promocodes": [dict(r) for r in c.execute("SELECT * FROM promocodes ORDER BY id")],
    }


def plan(old: dict[str, Any], at: datetime) -> dict[str, Any]:
    """что и как переносим — общий расчёт для check и import (чтобы проверка показывала ровно то, что сделает импорт)."""
    users = old["users"]
    by_tg = {int(u["telegram_id"]): u for u in users}
    payers = {int(p["user_id"]) for p in old["payments"]}
    gift_receivers = {int(g["to_user_id"]) for g in old["gifts"] if g.get("to_user_id") and g.get("is_activated")}
    subs: dict[int, dict[str, Any]] = {}
    cats = Counter()
    for u in users:
        tg = int(u["telegram_id"])
        exp = parse_old(u.get("vpn_expires_at"))
        short = key_short(u.get("vpn_key"))
        if exp is None:
            cats["без срока — подписки нет"] += 1
            continue
        paid = tg in payers or tg in gift_receivers
        dl = int(u.get("device_limit") or OLD_BASE_DEVICES)
        dev_exp = parse_old(u.get("devices_limit_expires_at"))
        addon = None
        # лимит — как в старом боте (столько же стоит в Remnawave и столько человек подключил). Понижать нельзя:
        # антиабуз увидит «устройств больше лимита» и заблокирует подписку. Срок докупки ещё идёт —
        # заводим доп. устройства, и платформа сама снимет их в свой срок.
        devices = dl
        if dl > OLD_BASE_DEVICES and dev_exp is not None and dev_exp > at:
            addon = {"count": dl - OLD_BASE_DEVICES, "expires_at": dev_exp}
        if exp > at:
            status, life = "Active", "active"
        elif exp > at - DELETE_AFTER:
            status, life = "Expired", "recent"
        else:
            status, life = "Deleted", "old"
        s = {
            "tg": tg, "expires_at": exp, "status": status, "life": life, "type": "vpn" if paid else "trial",
            "short": short, "key": str(u["vpn_key"]).strip() if short else None, "devices": max(1, devices),
            "addon": addon, "created_at": parse_old(u.get("created_at")) or at,
        }
        subs[tg] = s
        cats[{"active": "действует", "recent": "истекла ≤ 7 дней", "old": "истекла > 7 дней (→ удалена)"}[life]
             + (" · ключ есть" if short else " · ключа нет")] += 1
    # платежи: один payment_id — один платёж (старый бот иногда записывал одну оплату по 2–12 раз)
    seen: dict[str, dict[str, Any]] = {}
    dups = 0
    for p in old["payments"]:
        pid = str(p["payment_id"])
        if pid in seen:
            dups += 1
            continue
        seen[pid] = p
    return {"by_tg": by_tg, "subs": subs, "cats": cats, "payments": list(seen.values()), "pay_dups": dups}


# ── check ──

def cmd_check(args: argparse.Namespace) -> int:
    oc = open_old(args.old)
    tables = old_tables(oc)
    log(f"Старая база: {args.old}")
    for t in tables:
        log(f"  {t}: {old_count(oc, t)}")
    bad = old_integrity(oc)
    if bad:
        log("  ! повреждения в старой базе (данные читаются полным проходом таблиц, ничего не теряется):")
        for b in bad:
            log(f"    {b}")
    unknown = set(tables) - EXPECTED_TABLES - {"sqlite_sequence"}
    if unknown:
        log(f"  ! незнакомые таблицы (попадут в архив): {sorted(unknown)}")
    old = load_old(oc)
    at = now()
    p = plan(old, at)
    log("\nПодписки:")
    for k, v in sorted(p["cats"].items()):
        log(f"  {k}: {v}")
    live = [s for s in p["subs"].values() if s["life"] in ("active", "recent")]
    log(f"  к привязке в Remnawave (живые с ключом): {sum(1 for s in live if s['short'])}")
    log(f"  живые без ключа (получат новый ключ): {sum(1 for s in live if not s['short'])}")
    log(f"  пробные (ни одной оплаты): {sum(1 for s in p['subs'].values() if s['type'] == 'trial')}")
    log(f"  доп. устройства ещё действуют: {sum(1 for s in p['subs'].values() if s['addon'])}")
    anti_live = sum(1 for u in old["users"] if (parse_old(u.get("anti_expires_at")) or at) > at)
    anti_only = sum(1 for u in old["users"] if (parse_old(u.get("anti_expires_at")) or at) > at
                    and not ((parse_old(u.get("vpn_expires_at")) or at) > at))
    log(f"\nАнти-ключи (только в архив): действуют {anti_live}, из них без живого VPN — {anti_only}")
    log(f"\nПлатежи: строк {len(old['payments'])}, уникальных {len(p['payments'])}, повторных записей {p['pay_dups']}")
    rub = sum(float(x["amount"] or 0) for x in p["payments"] if x["payment_method"] != "stars")
    stars = sum(float(x["amount"] or 0) for x in p["payments"] if x["payment_method"] == "stars")
    log(f"  картой: {rub:,.2f} ₽ · звёздами: {stars:,.0f} ⭐".replace(",", " "))
    purp = Counter(classify_payment(x["description"], x["months"])["purpose"] for x in p["payments"])
    log(f"  назначение: {dict(purp)}")
    log(f"\nРефералы: приглашённых {sum(1 for u in old['users'] if u.get('referrer_id'))}, "
        f"начислений {len(old['earnings'])}, реф. баланс {sum(float(u.get('balance') or 0) for u in old['users']):.2f} ₽")
    g = old["gifts"]
    log(f"Подарки: {len(g)}, не активированы {sum(1 for x in g if not x['is_activated'])}")
    log(f"Промокоды: {len(old['promocodes'])}")
    # новая база
    db.init_db()
    if not projects.exists(PROJECT):
        log(f"\n! В сети нет проекта {PROJECT}")
        return 1
    n = db.fetchone("SELECT COUNT(*) AS c FROM users WHERE project_id = ?", (PROJECT,))["c"]
    log(f"\nНовая база ({db.DB_PATH}): пользователей FGN сейчас {n}")
    done = db.get_setting(SETTING, "")
    if done:
        log(f"  перенос уже сделан: {done[:300]}")
    clash = 0
    codes = {str(x["code"]).upper() for x in old["promocodes"]}
    for r in db.fetchall("SELECT code FROM promocodes"):
        clash += 1 if str(r["code"]).upper() in codes else 0
    if clash:
        log(f"  ! промокодов с такими же кодами уже есть: {clash} (их пропущу)")
    return 0


# ── import ──

def _fgn_values() -> dict[str, Any]:
    import fulfillment  # type: ignore
    with projects.use(PROJECT):
        return {
            "paid_gb": int(fulfillment.paid_traffic_gb()),
            "trial_gb": int(fulfillment.trial_traffic_gb()),
            "vpn_squads": list(fulfillment.vpn_squads() or []),
            "trial_squads": list(fulfillment.trial_squads() or []),
        }


def cmd_import(args: argparse.Namespace) -> int:
    db.init_db()
    try:
        import reflevels  # type: ignore
        reflevels._ensure_schema()
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"Не удалось подготовить таблицу подарков: {exc}")
    if not projects.exists(PROJECT):
        raise SystemExit(f"В сети нет проекта {PROJECT}")
    if db.get_setting(SETTING, ""):
        raise SystemExit("Перенос уже сделан (настройка legacy_fgn_import). Повторно не запускаю.")
    n = db.fetchone("SELECT COUNT(*) AS c FROM users WHERE project_id = ?", (PROJECT,))["c"]
    if n and not args.allow_existing:
        raise SystemExit(f"В FGN уже есть пользователи ({n}). Импорт рассчитан на пустой FGN — остановлено.")
    oc = open_old(args.old)
    tables = old_tables(oc)
    old = load_old(oc)
    oc.close()
    at = now()
    p = plan(old, at)
    vals = _fgn_values()
    t0 = time.time()

    conn = sqlite3.connect(db.DB_PATH, timeout=60)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 60000")
    conn.execute("PRAGMA foreign_keys = OFF")
    # триггеры проекта (database.py) вызывают current_project() — здесь это всегда FGN
    conn.create_function("current_project", 0, lambda: PROJECT)
    conn.execute("ATTACH DATABASE ? AS old", (os.path.abspath(args.old),))
    stats: dict[str, Any] = {}
    try:
        conn.execute("BEGIN IMMEDIATE")
        # 0. полный архив старой базы: все таблицы, все строки, все столбцы
        for t in tables:
            name = ARCHIVE_PREFIX + t
            if conn.execute("SELECT 1 FROM main.sqlite_master WHERE name = ?", (name,)).fetchone():
                raise SystemExit(f"Таблица архива {name} уже есть — похоже, перенос уже делали")
            conn.execute(f'CREATE TABLE main."{name}" AS SELECT * FROM old."{t}"')
        stats["archive_tables"] = len(tables)
        conn.execute(f"CREATE TABLE main.{ARCHIVE_PREFIX}map_users (old_id INTEGER PRIMARY KEY, telegram_id INTEGER NOT NULL, "
                     "user_id INTEGER NOT NULL)")
        conn.execute(f"CREATE TABLE main.{ARCHIVE_PREFIX}map_payments (old_payment_id TEXT PRIMARY KEY, "
                     "payment_id TEXT NOT NULL, old_rows INTEGER NOT NULL)")

        # 1. пользователи
        existing_codes = {r[0] for r in conn.execute("SELECT referral_code FROM main.users WHERE referral_code IS NOT NULL")}
        tg2id: dict[int, int] = {}
        for u in old["users"]:
            tg = int(u["telegram_id"])
            created = parse_old(u.get("created_at")) or at
            code = str(tg)
            if code in existing_codes:
                code = None  # type: ignore[assignment]
            else:
                existing_codes.add(code)
            anti_exp = parse_old(u.get("anti_expires_at"))
            cur = conn.execute(
                "INSERT INTO main.users (telegram_id, project_id, username, first_name, balance, status, is_banned, "
                "referral_code, is_partner, partner_balance, created_at, anti_key, anti_expires_at, first_start_at) "
                "VALUES (?, ?, ?, ?, 0, 'None', 0, ?, 0, ?, ?, ?, ?, ?)",
                (tg, PROJECT, (u.get("username") or None), (u.get("first_name") or None), code,
                 round(float(u.get("balance") or 0), 2), iso(created), (u.get("anti_key") or None), iso(anti_exp),
                 iso(created)))
            uid = int(cur.lastrowid)
            tg2id[tg] = uid
            conn.execute(f"INSERT INTO main.{ARCHIVE_PREFIX}map_users (old_id, telegram_id, user_id) VALUES (?, ?, ?)",
                         (int(u["id"]), tg, uid))
        stats["users"] = len(tg2id)
        # кто кого пригласил (в старой базе — telegram_id пригласившего)
        refs = 0
        for u in old["users"]:
            r = u.get("referrer_id")
            if r and int(r) in tg2id and int(r) != int(u["telegram_id"]):
                conn.execute("UPDATE main.users SET referred_by = ? WHERE id = ?", (tg2id[int(r)], tg2id[int(u["telegram_id"])]))
                refs += 1
        stats["referred"] = refs
        # пробный уже брали все: в старом боте 3 дня выдавались при первом /start
        conn.executemany("INSERT OR IGNORE INTO main.trial_claims (project_id, telegram_id, user_id, claimed_at) VALUES (?, ?, ?, ?)",
                         [(PROJECT, tg, uid, iso(parse_old(p["by_tg"][tg].get("created_at")) or at)) for tg, uid in tg2id.items()])

        # 2. подписки
        tg2sub: dict[int, int] = {}
        addons = 0
        for tg, s in p["subs"].items():
            uid = tg2id[tg]
            trial = s["type"] == "trial"
            cur = conn.execute(
                "INSERT INTO main.subscriptions (user_id, rw_id, key_uuid, short_uuid, key_config, status, expires_at, "
                "devices_limit, devices_used, traffic_used, traffic_limit, type, squads_json, created_at, project_id, deleted_at) "
                "VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)",
                (uid, str(_uuid.uuid4()), s["short"], s["key"], s["status"], iso(s["expires_at"]), s["devices"],
                 vals["trial_gb"] if trial else vals["paid_gb"], s["type"],
                 json.dumps(vals["trial_squads"] if trial else vals["vpn_squads"]), iso(s["created_at"]), PROJECT,
                 iso(min(s["expires_at"] + DELETE_AFTER, at)) if s["status"] == "Deleted" else None))
            sid = int(cur.lastrowid)
            tg2sub[tg] = sid
            if s["addon"] and s["status"] != "Deleted":
                conn.execute("INSERT INTO main.device_addons (user_id, subscription_id, payment_id, count, months, status, "
                             "created_at, expires_at) VALUES (?, ?, NULL, ?, 1, 'active', ?, ?)",
                             (uid, sid, s["addon"]["count"], iso(at), iso(s["addon"]["expires_at"])))
                addons += 1
        stats["subscriptions"] = len(tg2sub)
        stats["subscriptions_by_status"] = dict(Counter(s["status"] for s in p["subs"].values()))
        stats["device_addons"] = addons

        # 3. платежи → payments + transactions (история в приложении) + purchases (API v1)
        rows_per_pid = Counter(str(x["payment_id"]) for x in old["payments"])
        n_pay = 0
        for x in p["payments"]:
            tg = int(x["user_id"])
            uid = tg2id.get(tg)
            if uid is None:
                continue
            c = classify_payment(x["description"], x["months"])
            stars_pay = x["payment_method"] == "stars"
            provider, method = ("tg_stars", "tg_stars") if stars_pay else ("yookassa", "card")
            amount = 0.0 if stars_pay else round(float(x["amount"] or 0), 2)
            stars = int(round(float(x["amount"] or 0))) if stars_pay else None
            currency = "XTR" if stars_pay else (x.get("currency") or "RUB")
            created = iso(parse_old(x.get("created_at")) or at)
            new_pid = PAY_PREFIX + str(x["payment_id"])
            sub_id = tg2sub.get(tg) if c["purpose"] in ("extend", "devices") else None
            conn.execute(
                "INSERT INTO main.payments (payment_id, user_id, provider, method, provider_payment_id, amount, currency, stars, "
                "status, purpose, plan_devices, months, extra_devices, subscription_id, created_at, paid_at, project_id, "
                "whitelist, referral_applied, result_seen_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
                (new_pid, uid, provider, method, str(x["payment_id"]), amount, currency, stars, c["purpose"],
                 c["plan_devices"], c["months"], c["extra_devices"], sub_id, created, created, PROJECT, c["whitelist"], created))
            conn.execute(
                "INSERT INTO main.transactions (user_id, amount, status, payment_method, hash, payment_id, description, created_at, project_id) "
                "VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?)",
                (uid, amount if not stars_pay else float(stars or 0), method, new_pid, new_pid,
                 str(x.get("description") or ""), created, PROJECT))
            if c["purpose"] in ("extend", "subscription"):
                tariff = ("wl" if c["whitelist"] else "m") + str(c["months"])
            else:
                tariff = c["purpose"]
            conn.execute(
                "INSERT INTO main.purchases (payment_id, user_id, tariff_code, purpose, amount, currency, provider, "
                "provider_payment_id, subscription_id, expires_at, created_at, project_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
                (new_pid, uid, tariff, c["purpose"], amount, currency, provider, str(x["payment_id"]), sub_id, created, PROJECT))
            conn.execute(f"INSERT INTO main.{ARCHIVE_PREFIX}map_payments (old_payment_id, payment_id, old_rows) VALUES (?, ?, ?)",
                         (str(x["payment_id"]), new_pid, rows_per_pid[str(x["payment_id"])]))
            n_pay += 1
        stats["payments"] = n_pay
        stats["payment_duplicate_rows_skipped"] = p["pay_dups"]

        # 4. реферальные начисления → transactions (история) + referral_ledger; остаток — к реф. балансу
        pay_user = {str(x["payment_id"]): int(x["user_id"]) for x in old["payments"]}
        n_earn = 0
        for e in old["earnings"]:
            earner = tg2id.get(int(e["referrer_id"]))
            if earner is None:
                continue
            payer_tg = pay_user.get(str(e.get("payment_id") or ""))
            payer = tg2id.get(payer_tg) if payer_tg else None
            created = iso(parse_old(e.get("created_at")) or at)
            amount = round(float(e["amount"] or 0), 2)
            ppid = (PAY_PREFIX + str(e["payment_id"])) if e.get("payment_id") else None
            conn.execute(
                "INSERT INTO main.transactions (user_id, amount, status, payment_method, hash, payment_id, description, created_at, project_id) "
                "VALUES (?, ?, 'completed', 'referral', ?, ?, ?, ?, ?)",
                (earner, amount, f"pay:{ppid}" if ppid else _uuid.uuid4().hex[:16], _uuid.uuid4().hex[:16],
                 f"referral bonus from user {payer}" if payer else "referral bonus (старый бот FGN)", created, PROJECT))
            conn.execute(
                "INSERT INTO main.referral_ledger (user_id, kind, amount, ref_user_id, payment_id, note, created_at) "
                "VALUES (?, 'accrual', ?, ?, ?, ?, ?)",
                (earner, amount, payer, ppid, f"старый бот FGN, {e.get('percent')}% от {e.get('payment_amount')} ₽", created))
            n_earn += 1
        stats["referral_accruals"] = n_earn
        # леджер = реф. баланс: разница — то, что человек вывел/потратил в старом боте
        adj = 0
        for uid in tg2id.values():
            r = conn.execute("SELECT u.partner_balance AS b, COALESCE((SELECT SUM(amount) FROM main.referral_ledger l "
                             "WHERE l.user_id = u.id), 0) AS s FROM main.users u WHERE u.id = ?", (uid,)).fetchone()
            diff = round(float(r["b"] or 0) - float(r["s"] or 0), 2)
            if abs(diff) >= 0.01:
                conn.execute("INSERT INTO main.referral_ledger (user_id, kind, amount, note, created_at) "
                             "VALUES (?, 'adjustment', ?, 'остаток реф. баланса из старого бота FGN', ?)", (uid, diff, iso(at)))
                adj += 1
        stats["referral_adjustments"] = adj
        stats["partner_balance_total"] = round(sum(float(u.get("balance") or 0) for u in old["users"]), 2)

        # 5. подарки → referral_rewards (купленные — kind bought, раздачи админа — kind admin)
        n_g = Counter()
        existing_gift = {r[0] for r in conn.execute("SELECT code FROM main.referral_rewards WHERE code IS NOT NULL")}
        for g in old["gifts"]:
            code = gift_code_new(g["gift_code"])
            if code in existing_gift:
                n_g["skipped_code_clash"] += 1
                continue
            existing_gift.add(code)
            admin = str(g.get("payment_id") or "").startswith("bulk_admin")
            giver = tg2id.get(int(g["from_user_id"]))
            receiver = tg2id.get(int(g["to_user_id"])) if g.get("to_user_id") else None
            redeemed = bool(g.get("is_activated"))
            status = "redeemed" if redeemed else "issued"
            conn.execute(
                "INSERT INTO main.referral_rewards (user_id, kind, code, status, created_at, redeemed_by, redeemed_at, months, "
                "whitelist, payment_id, batch, note, expires_at, one_per_user, project_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
                (0 if admin else (giver or 0), "admin" if admin else "bought", code, status,
                 iso(parse_old(g.get("created_at")) or at), receiver if redeemed else None,
                 iso(parse_old(g.get("activated_at"))) if redeemed else None, max(1, int(g.get("months") or 1)),
                 1 if g.get("is_anti_gift") else 0,
                 None if admin else ((PAY_PREFIX + str(g["payment_id"])) if g.get("payment_id") else None),
                 "fgnold" if admin else None,
                 f"старый бот FGN: {g['gift_code']}" + (f", выдал {g['from_user_id']}" if admin else ""),
                 iso(parse_old(g.get("expires_at"))), PROJECT))
            n_g[status] += 1
        stats["gifts"] = dict(n_g)

        # 6. промокоды (скидка %)
        n_pc = Counter()
        existing_pc = {str(r[0]).upper() for r in conn.execute("SELECT code FROM main.promocodes")}
        for pc in old["promocodes"]:
            code = str(pc["code"]).strip()
            if code.upper() in existing_pc:
                n_pc["skipped_clash"] += 1
                continue
            existing_pc.add(code.upper())
            conn.execute(
                "INSERT INTO main.promocodes (code, name, type, value, uses_limit, uses_count, expires_at, is_active, created_at, project_id) "
                "VALUES (?, ?, 'discount', ?, ?, ?, ?, ?, ?, ?)",
                (code, "Из старого бота FGN", float(pc["discount_percent"] or 0), pc.get("max_uses"),
                 int(pc.get("current_uses") or 0), iso(parse_old(pc.get("expires_at"))), 1 if pc.get("is_active") else 0,
                 iso(parse_old(pc.get("created_at")) or at), PROJECT))
            n_pc["imported"] += 1
        stats["promocodes"] = dict(n_pc)

        # 7. автоматические рассылки: перенесённые люди не новички — без волны сообщений/подарков при первом проходе
        no_sub = [uid for tg, uid in tg2id.items() if tg not in tg2sub]
        conn.executemany("INSERT OR IGNORE INTO main.onboarding_reminders (user_id, stage, sent_at) VALUES (?, ?, ?)",
                         [(uid, st, iso(at)) for uid in no_sub for st in OB_STAGES])
        conn.executemany("INSERT OR IGNORE INTO main.user_notices (user_id, kind, ref, sent_at) VALUES (?, 'notconn', ?, ?)",
                         [(tg2id[tg], str(sid), iso(at)) for tg, sid in tg2sub.items()])
        if not args.winback:
            n_wb = conn.execute(
                "INSERT OR IGNORE INTO main.user_notices (user_id, kind, ref, sent_at) "
                "SELECT s.user_id, 'winback', substr(MAX(s.expires_at), 1, 19), ? FROM main.subscriptions s "
                "JOIN main.users u ON u.id = s.user_id WHERE u.project_id = ? AND s.expires_at IS NOT NULL "
                "GROUP BY s.user_id HAVING MAX(s.expires_at) <= ?", (iso(at), PROJECT, iso(at))).rowcount
            stats["winback_suppressed"] = n_wb
        stats["onboarding_marked_users"] = len(no_sub)

        # 8. статусы пользователей по подпискам (как fulfillment.compute_user_state)
        now_iso = iso(at)
        conn.execute(
            "UPDATE main.users SET status = CASE "
            " WHEN NOT EXISTS (SELECT 1 FROM main.subscriptions s WHERE s.user_id = users.id) THEN 'None' "
            " WHEN EXISTS (SELECT 1 FROM main.subscriptions s WHERE s.user_id = users.id AND s.status = 'Active' "
            "   AND s.type != 'trial' AND (s.expires_at IS NULL OR s.expires_at > ?)) THEN 'Active' "
            " WHEN EXISTS (SELECT 1 FROM main.subscriptions s WHERE s.user_id = users.id AND s.status = 'Active' "
            "   AND s.type = 'trial' AND (s.expires_at IS NULL OR s.expires_at > ?)) THEN 'Trial' "
            " ELSE 'Expired' END WHERE project_id = ?", (now_iso, now_iso, PROJECT))

        stats["at"] = iso(at)
        stats["old_db"] = os.path.basename(args.old)
        stats["seconds"] = round(time.time() - t0, 1)
        conn.execute("INSERT OR REPLACE INTO main.settings (key, value) VALUES (?, ?)", (SETTING, json.dumps(stats, ensure_ascii=False)))
        if args.dry_run:
            conn.execute("ROLLBACK")
            log("Пробный прогон: всё посчитано и ОТКАЧЕНО, база не изменилась.")
        else:
            conn.execute("COMMIT")
    except BaseException:
        try:
            conn.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        log("Ошибка — транзакция откачена, база не изменилась.")
        raise
    finally:
        try:
            conn.execute("DETACH DATABASE old")
        except sqlite3.Error:
            pass
        conn.close()
    log(json.dumps(stats, ensure_ascii=False, indent=1))
    if not args.dry_run:
        log("\nГотово. Дальше: python legacy_fgn.py verify --old ... → adopt → provision")
    return 0


# ── adopt: привязка ключей в Remnawave ──

def _rw_field(u: dict[str, Any], *names: str) -> Any:
    for n in names:
        if u.get(n) is not None:
            return u[n]
    return None


def cmd_adopt(args: argparse.Namespace) -> int:
    import provisioning  # type: ignore
    import remnawave  # type: ignore
    if not db.get_setting(SETTING, ""):
        raise SystemExit("Сначала import")
    if not provisioning.is_configured():
        raise SystemExit("Remnawave не настроена")
    client = remnawave.get_client()
    rows = db.fetchall(
        "SELECT s.id AS sid, s.user_id AS uid, s.short_uuid AS short, s.expires_at AS exp, s.devices_limit AS dev, "
        "s.status AS status, u.telegram_id AS tg FROM subscriptions s JOIN users u ON u.id = s.user_id "
        f"JOIN {ARCHIVE_PREFIX}map_users m ON m.user_id = u.id "
        "WHERE s.status IN ('Active', 'Expired') AND s.short_uuid IS NOT NULL AND s.rw_id IS NULL ORDER BY s.id")
    if args.limit:
        rows = rows[:args.limit]
    log(f"К привязке: {len(rows)}{' (пробно, без изменений)' if args.dry_run else ''}")
    res = Counter()
    issues: list[str] = []
    for i, r in enumerate(rows, 1):
        short, uid, tg = r["short"], int(r["uid"]), int(r["tg"])
        want = provisioning.rw_username(uid)
        try:
            u = client.find_user_by_short_uuid(short)
        except Exception as exc:  # noqa: BLE001
            res["ошибка чтения"] += 1
            issues.append(f"sub {r['sid']} {short}: чтение: {exc}")
            continue
        if not u:
            res["нет в Remnawave"] += 1
            issues.append(f"sub {r['sid']} user {uid} tg {tg}: ключ {short} не найден в Remnawave — выдаст новый шаг provision")
            if not args.dry_run:
                db.execute("UPDATE subscriptions SET sync_state = 'legacy_missing' WHERE id = ?", (int(r["sid"]),))
            continue
        rw_tg = _rw_field(u, "telegramId", "telegram_id")
        if rw_tg not in (None, "") and int(rw_tg) != tg:
            res["чужой Telegram ID"] += 1
            issues.append(f"sub {r['sid']} user {uid}: в Remnawave telegramId {rw_tg}, в базе {tg} — пропущено")
            continue
        name = str(u.get("username") or "")
        try:
            rw_num = int(u.get("id"))
        except (TypeError, ValueError):
            res["нет числового id в Remnawave"] += 1
            issues.append(f"sub {r['sid']} user {uid}: у пользователя {name!r} нет числового id — пропущено")
            continue
        # имя в панели НЕ меняем: привязываем как есть (rw_legacy_users). Занято кем-то — пропуск.
        if name.startswith(provisioning.USERNAME_PREFIX) and name != want:
            res["уже batman_ другого"] += 1
            issues.append(f"sub {r['sid']} user {uid}: в Remnawave уже {name} — пропущено")
            continue
        other = db.fetchone("SELECT user_id FROM rw_legacy_users WHERE (rw_id = ? OR username = ?) AND user_id != ?",
                            (rw_num, name, uid))
        if other:
            res["ключ уже привязан к другому"] += 1
            issues.append(f"sub {r['sid']} user {uid}: {name} уже привязан к user {other['user_id']} — пропущено")
            continue
        if args.dry_run:
            res["будет привязан"] += 1
            continue
        if name != want:
            db.execute("INSERT INTO rw_legacy_users (user_id, rw_id, username, short_uuid, source, created_at) "
                       "VALUES (?, ?, ?, ?, 'fgn', ?) ON CONFLICT(user_id) DO UPDATE SET rw_id = excluded.rw_id, "
                       "username = excluded.username, short_uuid = excluded.short_uuid",
                       (uid, rw_num, name, short, iso(now())))
            remnawave.invalidate_own_aliases()
        exp_rw = parse_old(_rw_field(u, "expireAt", "expire_at"))
        exp_db = parse_old(r["exp"])
        new_exp = exp_rw or exp_db
        if exp_rw and exp_db and abs((exp_rw - exp_db).total_seconds()) > 3600:
            res["срок отличался (взят из Remnawave)"] += 1
            issues.append(f"sub {r['sid']} user {uid}: срок в базе {iso(exp_db)}, в Remnawave {iso(exp_rw)}")
        status = "Active" if new_exp and new_exp > now() else "Expired"
        hw = _rw_field(u, "hwidDeviceLimit", "hwid_device_limit")
        devices = int(r["dev"] or 1)
        if hw not in (None, "") and int(hw) > devices:
            # в Remnawave разрешено больше (старый бот не снял докупку): берём больше — иначе антиабуз
            # увидит «устройств больше лимита» и заблокирует подписку
            res["лимит устройств взят из Remnawave"] += 1
            issues.append(f"sub {r['sid']} user {uid}: устройств в базе {r['dev']}, в Remnawave {hw} — взято {hw}")
            devices = int(hw)
        tl = _rw_field(u, "trafficLimitBytes", "traffic_limit_bytes")
        traffic_gb = int(round(int(tl) / (1024 ** 3))) if tl not in (None, "") else None  # 0 — безлимит
        db.execute("UPDATE subscriptions SET rw_id = ?, short_uuid = COALESCE(?, short_uuid), key_uuid = COALESCE(?, key_uuid), "
                   "key_config = COALESCE(?, key_config), expires_at = ?, status = ?, traffic_limit = COALESCE(?, traffic_limit), "
                   "devices_limit = ? WHERE id = ?",
                   (str(u.get("id") or u.get("uuid")), _rw_field(u, "shortUuid", "short_uuid"),
                    _rw_field(u, "vlessUuid", "vless_uuid"), _rw_field(u, "subscriptionUrl", "subscription_url"),
                    iso(new_exp), status, traffic_gb, devices, int(r["sid"])))
        res["привязан"] += 1
        if i % 200 == 0:
            log(f"  … {i}/{len(rows)}: {dict(res)}")
        time.sleep(args.pause)
    # статусы пользователей после уточнения сроков
    import fulfillment  # type: ignore
    for uid in {int(r["uid"]) for r in rows}:
        fulfillment._sync_user_status(uid)
    log(f"Итог: {dict(res)}")
    for line in issues[:200]:
        log("  " + line)
    if len(issues) > 200:
        log(f"  … и ещё {len(issues) - 200}")
    if issues:
        path = os.path.join(os.path.dirname(db.DB_PATH), f"legacy_fgn_adopt_{int(time.time())}.log")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(issues))
        log(f"Полный список: {path}")
    return 0


# ── relink: старый пользователь Remnawave по Telegram ID ──

OLD_NAME_RE = re.compile(r"^user_[A-Za-z0-9_-]{6,}$")   # имена пользователей старого бота FGN в Remnawave


def _scan_rw(client: Any) -> list[dict[str, Any]]:
    """все пользователи панели (только чтение), страницами внахлёст."""
    seen: dict[str, dict[str, Any]] = {}
    start, size, total = 0, 500, None
    for _ in range(5000):
        page = client.get_users(start=start, size=size)
        if isinstance(page, dict) and isinstance(page.get("response"), (dict, list)):
            page = page["response"]
        users = page.get("users") if isinstance(page, dict) else page
        if isinstance(page, dict) and page.get("total") is not None:
            total = int(page["total"])
        if not users:
            break
        for u in users:
            if isinstance(u, dict) and u.get("id") is not None:
                seen[str(u["id"])] = u
        end = start + len(users)
        if (total is not None and end >= total) or (total is None and len(users) < size):
            break
        start = end - 50 if len(users) > 100 else end
    return list(seen.values())


def _rw_used(client: Any, u: dict[str, Any]) -> bool:
    """пользовался ли ключом: трафик, подключения, устройства. Не смогли проверить — считаем, что да."""
    ut = u.get("userTraffic") if isinstance(u.get("userTraffic"), dict) else {}
    for k in ("onlineAt", "lastConnectedAt", "firstConnectedAt"):
        if u.get(k) or ut.get(k):
            return True
    for k in ("usedTrafficBytes", "lifetimeUsedTrafficBytes", "trafficUsedBytes"):
        try:
            if float(u.get(k) or ut.get(k) or 0) > 0:
                return True
        except (TypeError, ValueError):
            return True
    try:
        data = client.get_user_hwid_devices(int(u["id"]))
        if isinstance(data, dict) and "response" in data:
            data = data["response"]
        devs = data.get("devices") if isinstance(data, dict) else data
        return bool(devs)
    except Exception:  # noqa: BLE001
        return True


def _usage_key(u: dict[str, Any]) -> tuple:
    """какой из нескольких старых пользователей с одним Telegram ID — настоящий: которым пользовались."""
    ut = u.get("userTraffic") if isinstance(u.get("userTraffic"), dict) else {}

    def num(*keys: str) -> float:
        for k in keys:
            v = u.get(k) if u.get(k) is not None else ut.get(k)
            try:
                if v is not None:
                    return float(v)
            except (TypeError, ValueError):
                pass
        return 0.0
    online = str(u.get("onlineAt") or ut.get("onlineAt") or u.get("lastConnectedAt") or "")
    used = num("lifetimeUsedTrafficBytes", "usedTrafficBytes", "trafficUsedBytes")
    return (1 if (used > 0 or online) else 0, online, used, str(u.get("expireAt") or ""))


def _rw_by_id(client: Any, rid: Any) -> Optional[dict[str, Any]]:
    """пользователь панели по числовому id: в Remnawave 3.x — POST /api/users/resolve, GET /api/users/<id> — 404."""
    import remnawave  # type: ignore
    try:
        rid = int(str(rid))
    except (TypeError, ValueError):
        return None
    for call in (lambda: client.resolve_user(id=rid), lambda: client.get(f"/api/users/{rid}")):
        try:
            u = remnawave.RemnawaveAPI._unwrap_user(call())
        except remnawave.RemnawaveError:
            continue
        if u and str(u.get("id")) == str(rid):
            return u
    return None


RW_MAX_EXPIRE = datetime(2099, 12, 31, tzinfo=timezone.utc)


def _relink_live(client: Any, sub: dict[str, Any], pick: dict[str, Any]) -> None:
    """живой подписке — старый ключ: срок и устройства как в базе (не меньше, чем в Remnawave), затем строка подписки."""
    exp_db = parse_old(sub["expires_at"])
    exp_rw = parse_old(pick.get("expireAt"))
    exp = min(max([d for d in (exp_db, exp_rw) if d] or [now()]), RW_MAX_EXPIRE)
    try:
        hw = int(pick.get("hwidDeviceLimit") or 0)
    except (TypeError, ValueError):
        hw = 0
    dev = max(int(sub["devices_limit"] or 1), hw, 1)
    patch: dict[str, Any] = {"id": int(pick["id"]), "hwid_device_limit": dev}
    if exp > now():
        patch["expire_at"] = exp
        patch["status"] = "ACTIVE"
    # срок уже прошёл: Remnawave не принимает дату в прошлом («Expiration date cannot be in the past») —
    # срок не трогаем (там он тоже истёк), при оплате платформа выставит новый
    client.update_user(**patch)
    fresh = _rw_by_id(client, pick["id"]) or pick
    db.execute("UPDATE subscriptions SET rw_id = ?, short_uuid = ?, key_config = COALESCE(?, key_config), "
               "key_uuid = COALESCE(?, key_uuid), expires_at = ?, devices_limit = ?, sync_state = NULL, "
               "status = ? WHERE id = ?",
               (str(pick["id"]), fresh.get("shortUuid") or pick.get("shortUuid"), fresh.get("subscriptionUrl"),
                fresh.get("vlessUuid"), iso(exp), dev, "Active" if exp > now() else "Expired", int(sub["id"])))


def _rw_err(exc: Exception) -> str:
    pl = getattr(exc, "payload", None)
    return f"{exc}" + (f" {json.dumps(pl, ensure_ascii=False)[:300]}" if pl else "")


def cmd_relink(args: argparse.Namespace) -> int:
    import provisioning  # type: ignore
    import remnawave  # type: ignore
    if not db.get_setting(SETTING, ""):
        raise SystemExit("Сначала import")
    if not provisioning.is_configured():
        raise SystemExit("Remnawave не настроена")
    client = remnawave.get_client()
    log("Читаю всех пользователей Remnawave (только чтение)…")
    rw_all = _scan_rw(client)
    bound = db.fetchall("SELECT user_id, rw_id, username, source FROM rw_legacy_users")
    bound_by_user = {int(r["user_id"]): r for r in bound}
    bound_ids = {int(r["rw_id"]) for r in bound}
    bound_users = {int(r["user_id"]) for r in bound}
    # ключи «анти» старого бота — не основной VPN, их не привязываем
    anti = set()
    for r in db.fetchall(f"SELECT anti_key FROM {ARCHIVE_PREFIX}users WHERE anti_key IS NOT NULL"):
        sh = key_short(r["anti_key"])
        if sh:
            anti.add(sh)
    for r in db.fetchall(f'SELECT "key" AS k FROM {ARCHIVE_PREFIX}anti_keys'):
        sh = key_short(r["k"]) or (str(r["k"]) if r["k"] and "/" not in str(r["k"]) else None)
        if sh:
            anti.add(sh)
    by_tg: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for u in rw_all:
        name = str(u.get("username") or "")
        if not OLD_NAME_RE.match(name) or int(u["id"]) in bound_ids:
            continue
        if str(u.get("shortUuid") or "") in anti:
            continue
        try:
            tg = int(str(u.get("telegramId") or "").strip())
        except ValueError:
            continue
        by_tg[tg].append(u)
    log(f"В Remnawave: всего {len(rw_all)}, старых user_… с Telegram ID и без привязки — {sum(len(v) for v in by_tg.values())}")
    users = db.fetchall(f"SELECT m.user_id, m.telegram_id FROM {ARCHIVE_PREFIX}map_users m ORDER BY m.user_id")
    res = Counter()
    issues: list[str] = []
    done = 0
    for m in users:
        uid, tg = int(m["user_id"]), int(m["telegram_id"])
        if uid in bound_users:
            # починка после прерванного запуска: привязка записана, а живая подписка ещё смотрит не туда
            leg = bound_by_user.get(uid)
            if leg and leg["source"] == "fgn-tg":
                sub = db.fetchone("SELECT * FROM subscriptions WHERE user_id = ? AND status IN ('Active', 'Expired') "
                                  "ORDER BY id DESC LIMIT 1", (uid,))
                if sub and str(sub.get("rw_id") or "") != str(leg["rw_id"]):
                    pick = _rw_by_id(client, leg["rw_id"])
                    if not pick:
                        res["починка: старого уже нет в Remnawave"] += 1
                        continue
                    if args.dry_run:
                        res["будет починен (прерванный запуск)"] += 1
                        continue
                    try:
                        _relink_live(client, sub, pick)
                        res["починен после прерванного запуска"] += 1
                    except Exception as exc:  # noqa: BLE001
                        res["починка: панель отказала"] += 1
                        issues.append(f"user {uid}: починка {pick.get('username')}: {_rw_err(exc)}")
            continue
        cands = by_tg.get(tg) or []
        sub = db.fetchone("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY CASE status WHEN 'Active' THEN 0 "
                          "WHEN 'Expired' THEN 1 ELSE 2 END, id DESC LIMIT 1", (uid,))
        if not cands:
            res["старого в Remnawave нет"] += 1
            # живая подписка указывает на пользователя, которого в Remnawave уже нет (удалили вручную) —
            # отдаём её provision, иначе в приложении висит несуществующая ссылка
            if sub and sub["status"] == "Active" and sub.get("rw_id") and not _rw_by_id(client, sub["rw_id"]):
                res["ключ удалён в Remnawave — выдаст provision"] += 1
                issues.append(f"user {uid} tg {tg}: ключ {sub.get('short_uuid')} удалён в Remnawave, старого нет — новый выдаст provision")
                if not args.dry_run:
                    db.execute("UPDATE subscriptions SET rw_id = NULL, sync_state = 'legacy_missing' WHERE id = ?", (int(sub["id"]),))
            continue
        pick = None
        if sub and sub.get("short_uuid"):
            pick = next((c for c in cands if str(c.get("shortUuid")) == str(sub["short_uuid"])), None)
        if pick is None:
            # несколько (старый бот плодил дубли): тот, которым пользовались — трафик/подключения, потом срок
            cands = sorted(cands, key=_usage_key, reverse=True)
            pick = cands[0]
            if len(cands) > 1:
                k = _usage_key(pick)
                res["несколько старых — взят использованный" if k[0] else "несколько старых, ни одним не пользовались — взят с поздним сроком"] += 1
                issues.append(f"user {uid} tg {tg}: старых {len(cands)}, взят {pick['username']}"
                              f" (трафик {int(k[2]) // 1048576} МБ, онлайн {k[1] or '—'}, до {pick.get('expireAt')}); остальные: "
                              + ", ".join(c['username'] for c in cands[1:6]))
        live = bool(sub) and sub["status"] in ("Active", "Expired")
        new_rw = None
        if live and sub.get("rw_id"):
            # у живой подписки уже новый batman_ (выдал provision) — убираем его, только если им не пользовались
            new_rw = _rw_by_id(client, sub["rw_id"])
            if new_rw is None:
                res["новый batman_ уже удалён в Remnawave"] += 1
            if new_rw and str(new_rw.get("username")) == provisioning.rw_username(uid):
                if _rw_used(client, new_rw):
                    res["новый batman_ уже подключали — оставлен"] += 1
                    issues.append(f"user {uid}: {new_rw['username']} уже используется — старый {pick['username']} не привязан")
                    continue
            else:
                new_rw = None
        if args.dry_run:
            res["будет привязан" + (" (вместо нового batman_)" if new_rw else "")] += 1
            continue
        db.execute("INSERT INTO rw_legacy_users (user_id, rw_id, username, short_uuid, source, created_at) "
                   "VALUES (?, ?, ?, ?, 'fgn-tg', ?)", (uid, int(pick["id"]), str(pick["username"]), pick.get("shortUuid"), iso(now())))
        remnawave.invalidate_own_aliases()
        bound_ids.add(int(pick["id"]))
        if live:
            # сначала старый ключ — человеку, и только потом удаляем новый batman_: панель откажет — ничего не теряем
            try:
                _relink_live(client, sub, pick)
            except Exception as exc:  # noqa: BLE001
                db.execute("DELETE FROM rw_legacy_users WHERE user_id = ? AND source = 'fgn-tg'", (uid,))
                remnawave.invalidate_own_aliases()
                bound_ids.discard(int(pick["id"]))
                res["панель отказала — пропущено, ничего не изменено"] += 1
                issues.append(f"user {uid} tg {tg}: {pick['username']}: {_rw_err(exc)}")
                continue
            res["привязан, живая подписка"] += 1
            if new_rw:
                try:
                    client.delete_user(int(new_rw["id"]))
                    res["лишний batman_ удалён"] += 1
                except Exception as exc:  # noqa: BLE001
                    res["лишний batman_ не удалось удалить"] += 1
                    issues.append(f"user {uid}: {new_rw.get('username')} не удалён: {_rw_err(exc)}")
        else:
            res["привязан, подписка истекла (ключ оживёт при продлении)"] += 1
        done += 1
        if done % 500 == 0:
            log(f"  … {done}: {dict(res)}")
        time.sleep(args.pause)
    log(f"Итог: {dict(res)}")
    for line in issues[:100]:
        log("  " + line)
    if issues:
        path = os.path.join(os.path.dirname(db.DB_PATH), f"legacy_fgn_relink_{int(time.time())}.log")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(issues))
        log(f"Полный список: {path}")
    return 0


# ── provision: живая подписка без ключа ──

def cmd_provision(args: argparse.Namespace) -> int:
    import fulfillment  # type: ignore
    import provisioning  # type: ignore
    if not provisioning.is_configured():
        raise SystemExit("Remnawave не настроена")
    rows = db.fetchall(
        "SELECT s.*, u.telegram_id AS tg, u.username AS uname, u.email AS email FROM subscriptions s "
        f"JOIN users u ON u.id = s.user_id JOIN {ARCHIVE_PREFIX}map_users m ON m.user_id = u.id "
        "WHERE s.status = 'Active' AND s.rw_id IS NULL AND (s.short_uuid IS NULL OR s.sync_state = 'legacy_missing') "
        "AND s.expires_at > ? ORDER BY s.id",
        (iso(now()),))
    if args.limit:
        rows = rows[:args.limit]
    log(f"Живых подписок без ключа: {len(rows)}{' (пробно)' if args.dry_run else ''}")
    res = Counter()
    with projects.use(PROJECT):
        for s in rows:
            if args.dry_run:
                res["будет выдан ключ"] += 1
                continue
            trial = s["type"] == "trial"
            prov = provisioning.provision(
                user_id=int(s["user_id"]), telegram_id=int(s["tg"]), username=s["uname"], email=s["email"],
                expire_at=parse_old(s["expires_at"]), devices=int(s["devices_limit"] or 1),
                squads=db.loads(s["squads_json"], []) or None,
                traffic_limit_bytes=int(s["traffic_limit"] or 0) * fulfillment.GB,
                traffic_reset_strategy=fulfillment.RESET_STRATEGY)
            if not prov.get("ok"):
                res["ошибка"] += 1
                log(f"  sub {s['id']}: {prov.get('error')}")
                continue
            fulfillment._apply_provision_to_sub(s, prov)
            db.execute("UPDATE subscriptions SET sync_state = NULL WHERE id = ? AND sync_state = 'legacy_missing'", (int(s["id"]),))
            res["выдан"] += 1
            time.sleep(args.pause)
            _ = trial
    log(f"Итог: {dict(res)}")
    return 0


# ── verify ──

def cmd_verify(args: argparse.Namespace) -> int:
    oc = open_old(args.old)
    old = load_old(oc)
    tables = old_tables(oc)
    done = db.get_setting(SETTING, "")
    if not done:
        raise SystemExit("Перенос ещё не делали")
    info = json.loads(done)
    at = parse_old(info["at"]) or now()
    p = plan(old, at)
    fails: list[str] = []

    def ok(name: str, cond: bool, detail: str = "") -> None:
        log(("OK   " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
        if not cond:
            fails.append(name)

    # архив: каждая таблица, каждая строка
    for t in tables:
        a = old_count(oc, t)
        b = db.fetchone(f'SELECT COUNT(*) AS c FROM "{ARCHIVE_PREFIX}{t}"')["c"]
        ok(f"архив {t}: {a} строк", a == b, f"в архиве {b}")
    # по каждой таблице — совпадение содержимого (хэш всех строк)
    for t in tables:
        cols = [r[1] for r in oc.execute(f'PRAGMA table_info("{t}")')]
        sel = ", ".join(f'quote("{c}")' for c in cols)
        h1 = sorted(tuple(r) for r in oc.execute(f'SELECT {sel} FROM "{t}"'))
        conn = db.connect()
        h2 = sorted(tuple(r) for r in conn.execute(f'SELECT {sel} FROM "{ARCHIVE_PREFIX}{t}"'))
        ok(f"архив {t}: содержимое совпадает побайтно", h1 == h2)

    mp = {int(r["telegram_id"]): int(r["user_id"]) for r in db.fetchall(f"SELECT * FROM {ARCHIVE_PREFIX}map_users")}
    ok("каждый старый пользователь есть в новой базе", len(mp) == len(old["users"]) and
       all(int(u["telegram_id"]) in mp for u in old["users"]), f"{len(mp)} из {len(old['users'])}")
    new_users = {int(r["id"]): r for r in db.fetchall("SELECT * FROM users WHERE project_id = ?", (PROJECT,))}
    bad = [u for u in old["users"] if int(new_users[mp[int(u["telegram_id"])]]["telegram_id"]) != int(u["telegram_id"])
           or (new_users[mp[int(u["telegram_id"])]]["username"] or "") != (u.get("username") or "")
           or (new_users[mp[int(u["telegram_id"])]]["first_name"] or "") != (u.get("first_name") or "")]
    ok("Telegram ID, username, имя совпадают", not bad, f"расхождений {len(bad)}")
    bad = [u for u in old["users"] if abs(float(new_users[mp[int(u["telegram_id"])]]["partner_balance"] or 0)
                                          - round(float(u.get("balance") or 0), 2)) > 0.001]
    ok("реф. баланс совпадает у каждого", not bad, f"расхождений {len(bad)}")
    bad = []
    for u in old["users"]:
        r = u.get("referrer_id")
        got = new_users[mp[int(u["telegram_id"])]]["referred_by"]
        want = mp.get(int(r)) if r and int(r) != int(u["telegram_id"]) else None
        if (got or None) != want:
            bad.append(u)
    ok("кто кого пригласил — у каждого", not bad, f"расхождений {len(bad)}")
    # ledger = partner_balance
    led = {int(r["user_id"]): float(r["s"]) for r in db.fetchall(
        "SELECT user_id, SUM(amount) AS s FROM referral_ledger WHERE user_id IN "
        f"(SELECT user_id FROM {ARCHIVE_PREFIX}map_users) GROUP BY user_id")}
    bad = [uid for uid in mp.values() if abs(led.get(uid, 0.0) - float(new_users[uid]["partner_balance"] or 0)) > 0.011]
    ok("реф. леджер сходится с балансом у каждого", not bad, f"расхождений {len(bad)}")
    acc = db.fetchone(f"SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS s FROM referral_ledger WHERE kind = 'accrual' AND user_id IN "
                      f"(SELECT user_id FROM {ARCHIVE_PREFIX}map_users)")
    ok("реф. начисления: количество и сумма", int(acc["c"]) == len(old["earnings"]) and
       abs(float(acc["s"]) - sum(round(float(e["amount"] or 0), 2) for e in old["earnings"])) < 0.05,
       f"{acc['c']} / {acc['s']}")

    # подписки
    subs = {int(r["user_id"]): r for r in db.fetchall(
        f"SELECT * FROM subscriptions WHERE user_id IN (SELECT user_id FROM {ARCHIVE_PREFIX}map_users)")}
    ok("подписок столько же, сколько людей со сроком", len(subs) == len(p["subs"]), f"{len(subs)} vs {len(p['subs'])}")
    adopted = 0
    bad_exp, bad_key, bad_dev, bad_st = [], [], [], []
    for tg, s in p["subs"].items():
        ns = subs.get(mp[tg])
        if not ns:
            bad_exp.append(tg)
            continue
        if ns.get("rw_id"):
            adopted += 1  # после adopt срок/ключ могли уточниться по Remnawave
        else:
            if (parse_old(ns["expires_at"]) or at) != s["expires_at"]:
                bad_exp.append(tg)
            if (ns.get("short_uuid") or None) != s["short"] or (ns.get("key_config") or None) != s["key"]:
                bad_key.append(tg)
            if ns["status"] != s["status"]:
                bad_st.append(tg)
        if int(ns["devices_limit"]) != s["devices"] and not (ns.get("rw_id") and int(ns["devices_limit"]) > s["devices"]):
            bad_dev.append(tg)
    ok("срок подписки совпадает у каждого", not bad_exp, f"расхождений {len(bad_exp)}")
    ok("ключ (ссылка подписки) совпадает у каждого", not bad_key, f"расхождений {len(bad_key)}")
    ok("лимит устройств у каждого", not bad_dev, f"расхождений {len(bad_dev)}")
    ok("статус подписки у каждого", not bad_st, f"расхождений {len(bad_st)}")
    log(f"     привязано к Remnawave: {adopted}")
    live_old = sum(1 for s in p["subs"].values() if s["expires_at"] > now())
    live_new = sum(1 for s in subs.values() if (parse_old(s["expires_at"]) or at) > now() and s["status"] == "Active")
    ok("действующих подписок столько же, сколько в старой базе сейчас", live_old == live_new, f"{live_new} vs {live_old}")

    # платежи
    pays = {r["provider_payment_id"]: r for r in db.fetchall(
        "SELECT * FROM payments WHERE payment_id LIKE ? AND project_id = ?", (PAY_PREFIX + "%", PROJECT))}
    ok("каждый уникальный платёж перенесён", len(pays) == len(p["payments"]) and
       all(str(x["payment_id"]) in pays for x in p["payments"]), f"{len(pays)} vs {len(p['payments'])}")
    bad = []
    for x in p["payments"]:
        n = pays.get(str(x["payment_id"]))
        if not n:
            continue
        stars_pay = x["payment_method"] == "stars"
        want_amount = 0.0 if stars_pay else round(float(x["amount"] or 0), 2)
        if abs(float(n["amount"] or 0) - want_amount) > 0.001 or (stars_pay and int(n["stars"] or 0) != int(round(float(x["amount"] or 0)))) \
                or int(n["user_id"]) != mp[int(x["user_id"])] or (parse_old(n["paid_at"]) != parse_old(x["created_at"])):
            bad.append(x["payment_id"])
    ok("сумма, звёзды, плательщик, дата — у каждого платежа", not bad, f"расхождений {len(bad)}")
    rub_old = round(sum(float(x["amount"] or 0) for x in p["payments"] if x["payment_method"] != "stars"), 2)
    rub_new = round(sum(float(n["amount"] or 0) for n in pays.values()), 2)
    ok(f"итог картой {rub_old:,.2f} ₽".replace(",", " "), abs(rub_old - rub_new) < 0.01, f"в новой {rub_new}")
    tx = db.fetchone("SELECT COUNT(*) AS c FROM transactions WHERE payment_id LIKE ? AND payment_method != 'referral'", (PAY_PREFIX + "%",))
    ok("история платежей в приложении (transactions)", int(tx["c"]) == len(p["payments"]), f"{tx['c']}")

    # подарки
    gifts = {r["code"]: r for r in db.fetchall("SELECT * FROM referral_rewards WHERE project_id = ? AND note LIKE 'старый бот FGN%'",
                                                (PROJECT,))}
    bad = []
    for g in old["gifts"]:
        n = gifts.get(gift_code_new(g["gift_code"]))
        if not n or (n["status"] == "redeemed") != bool(g["is_activated"]) or int(n["months"]) != max(1, int(g["months"] or 1)):
            bad.append(g["gift_code"])
        elif g["is_activated"] and g.get("to_user_id") and int(n["redeemed_by"] or 0) != mp.get(int(g["to_user_id"])):
            bad.append(g["gift_code"])
    ok("подарки: код, статус, срок, получатель — у каждого", not bad, f"расхождений {len(bad)}")

    # промокоды
    pcs = {str(r["code"]).upper() for r in db.fetchall("SELECT code FROM promocodes WHERE project_id = ?", (PROJECT,))}
    miss = [x["code"] for x in old["promocodes"] if str(x["code"]).upper() not in pcs]
    ok("промокоды", not miss, f"нет: {miss}")

    ok("пробный период отмечен у всех перенесённых", db.fetchone(
        f"SELECT COUNT(*) AS c FROM trial_claims WHERE project_id = ? AND user_id IN (SELECT user_id FROM {ARCHIVE_PREFIX}map_users)",
        (PROJECT,))["c"] == len(mp))
    log(f"\nИтог: {'ВСЁ СХОДИТСЯ' if not fails else f'РАСХОЖДЕНИЙ: {len(fails)}'}")
    return 0 if not fails else 2


def main() -> int:
    ap = argparse.ArgumentParser(description="Перенос старой базы FGN в новую платформу")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("check", "import", "verify"):
        s = sub.add_parser(name)
        s.add_argument("--old", required=True, help="путь к старой базе (bot2.db)")
        if name == "import":
            s.add_argument("--dry-run", action="store_true", help="всё сделать и откатить")
            s.add_argument("--winback", action="store_true", help="не гасить «подарок вернувшимся» для истёкших")
            s.add_argument("--allow-existing", action="store_true", help="в FGN уже есть пользователи")
    for name in ("adopt", "relink", "provision"):
        s = sub.add_parser(name)
        s.add_argument("--limit", type=int, default=0)
        s.add_argument("--dry-run", action="store_true")
        s.add_argument("--pause", type=float, default=0.05)
    args = ap.parse_args()
    db.init_db()
    return {"check": cmd_check, "import": cmd_import, "adopt": cmd_adopt, "provision": cmd_provision,
            "verify": cmd_verify, "relink": cmd_relink}[args.cmd](args)


if __name__ == "__main__":
    raise SystemExit(main())
