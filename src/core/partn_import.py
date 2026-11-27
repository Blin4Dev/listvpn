# Амбассадоры старого бота: коды ?start=<код> (ambassadors.json: {"код": {"percent": 20}, …}) и кто по ним пришёл
# (partn.db: partner_user(user_id, referrer = код)). Запускать ПОСЛЕ legacy_import.py import (люди уже в проекте).
#
#   A="docker exec -it blinvpn-api python partn_import.py --project ovpn --partn /tmp/ovpn_partn.db --ambassadors /tmp/ambassadors.json"
#   $A check                 # только чтение: коды, сколько пришло, сколько платили, что будет создано
#   $A import --dry-run
#   $A import
#   $A verify
#   $A list                  # амбассадоры: аккаунт, ссылка, процент, рефералы, баланс
#
# Что делает import (одна транзакция, всё или ничего):
#   * полный архив partn.db и ambassadors.json в общей базе: legacy_<проект>_partn_<таблица>;
#   * на каждый код — аккаунт амбассадора: свой процент, ссылка t.me/<бот>?start=<код> (старые ссылки работают).
#     Telegram ID амбассадора неизвестен — аккаунт создаётся без Telegram (имя = код). Если ID известен
#     (--map CSV code,telegram_id) — амбассадором становится сам человек;
#   * каждый, кто пришёл по коду, — его реферал (referred_by), если пригласившего у человека ещё нет.
# Потом, когда станет известно, кто за кодом: панель → аккаунт амбассадора → «Telegram ID» → ввести ID →
# подтвердить объединение. Аккаунт амбассадора (ссылка, процент, рефералы, баланс) останется, а аккаунт человека
# (подписка, платежи) вольётся в него.
# Прошлые начисления партнёрам не переносятся: в partn.db нет ни процента, ни выплат — только оплаты.
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import secrets
import sqlite3
import sys
import time
from collections import Counter
from typing import Any, Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (_HERE, os.path.join(_HERE, "..", "api")):
    _p = os.path.abspath(_p)
    if _p not in sys.path:
        sys.path.insert(0, _p)

import database as db  # type: ignore  # noqa: E402
import ambassadors  # type: ignore  # noqa: E402

projects = db.projects
RESERVED_RE = re.compile(r"(?i)^(ref|trk|promo|gift|giftn|pay|payfail)_")
OB_STAGES = ("m30", "h24", "h48", "h71", "h72")


def log(m: str) -> None:
    print(m, flush=True)


def now_iso() -> str:
    return db.utcnow_iso()


def open_partn(path: str) -> sqlite3.Connection:
    if not os.path.isfile(path):
        raise SystemExit(f"Нет файла {path}")
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    if not c.execute("SELECT 1 FROM sqlite_master WHERE name = 'partner_user'").fetchone():
        raise SystemExit("В файле нет таблицы partner_user — это точно partn.db?")
    return c


def code_stats(pc: sqlite3.Connection) -> dict[str, dict]:
    out = {}
    for r in pc.execute(
            "SELECT u.referrer AS code, COUNT(*) AS people, MIN(u.created_at) AS first_at, "
            "(SELECT COUNT(DISTINCT p.user_id) FROM payment_history p JOIN partner_user x ON x.user_id = p.user_id "
            "  WHERE x.referrer = u.referrer) AS payers, "
            "(SELECT COALESCE(ROUND(SUM(p.amount), 2), 0) FROM payment_history p JOIN partner_user x ON x.user_id = p.user_id "
            "  WHERE x.referrer = u.referrer) AS paid_rub "
            "FROM partner_user u WHERE u.referrer IS NOT NULL AND u.referrer != '' GROUP BY u.referrer"):
        out[r["code"]] = dict(r)
    return out


def load_inputs(a) -> dict[str, dict]:
    """код → {rate, telegram_id, site, tg}. ambassadors.json даёт коды и процент, --map (CSV) — добавляет/уточняет."""
    items: dict[str, dict] = {}
    if a.ambassadors:
        with open(a.ambassadors, encoding="utf-8-sig") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            raise SystemExit("ambassadors.json: ожидается объект {\"код\": {\"percent\": N}, …}")
        for code, v in data.items():
            pct = (v or {}).get("percent") if isinstance(v, dict) else v
            items[str(code).strip()] = {"rate": float(pct) if pct not in (None, "") else None,
                                        "telegram_id": "", "site": "", "tg": ""}
    if a.map:
        with open(a.map, encoding="utf-8-sig", newline="") as fh:
            sample = fh.read(4096)
            fh.seek(0)
            for r in csv.DictReader(fh, dialect=csv.Sniffer().sniff(sample, delimiters=",;")):
                r = {str(k or "").strip().lower(): str(v or "").strip() for k, v in r.items()}
                code = r.get("code", "")
                if not code:
                    continue
                it = items.setdefault(code, {"rate": None, "telegram_id": "", "site": "", "tg": ""})
                if r.get("rate"):
                    it["rate"] = float(r["rate"].replace(",", "."))
                for k in ("telegram_id", "site", "tg"):
                    if r.get(k):
                        it[k] = r[k]
    if not items:
        raise SystemExit("Нужен --ambassadors ambassadors.json и/или --map таблица.csv")
    return items


def plan(a, pc) -> tuple[list[dict], list[str], list[str], dict]:
    pid = a.project
    stats = code_stats(pc)
    inputs = load_inputs(a)
    errs: list[str] = []
    notes: list[str] = []
    out: list[dict] = []
    seen_payload: dict[str, str] = {}
    seen_site: dict[str, str] = {}
    first_of_user: dict[int, str] = {}
    for code, it in inputs.items():
        st = stats.get(code) or {"people": 0, "payers": 0, "paid_rub": 0, "first_at": None}
        try:
            t = ambassadors.parse_tg(it.get("tg") or code)
            s = ambassadors.parse_site(it.get("site")) if it.get("site") else None
            rate = it.get("rate")
            if rate is not None and not 0 <= rate <= 100:
                raise ambassadors.AmbassadorError(f"процент {rate} — должен быть от 0 до 100")
            if RESERVED_RE.match(t[0]):
                raise ambassadors.AmbassadorError("код начинается с ref_/promo_/gift_/pay_/trk_ — занято ботом")
            if db.fetchone("SELECT id FROM tracking_links WHERE code = ? AND project_id = ?", (t[0], pid)):
                raise ambassadors.AmbassadorError(f"«{t[0]}» уже трекинговая ссылка")
            if t[0] in seen_payload:
                raise ambassadors.AmbassadorError(f"ссылка «{t[0]}» уже у кода {seen_payload[t[0]]}")
            if s and s in seen_site:
                raise ambassadors.AmbassadorError(f"ссылка на сайт {s} уже у кода {seen_site[s]}")
            user = None
            tg = str(it.get("telegram_id") or "")
            if tg:
                if not tg.isdigit():
                    raise ambassadors.AmbassadorError(f"telegram_id {tg!r} — не число")
                user = db.fetchone("SELECT * FROM users WHERE telegram_id = ? AND project_id = ?", (int(tg), pid))
                if not user:
                    raise ambassadors.AmbassadorError(f"Telegram ID {tg} нет в проекте {pid}")
            other = db.fetchone("SELECT id FROM users WHERE amb_tg = ? AND project_id = ?", (t[0], pid))
            if other and (not user or int(other["id"]) != int(user["id"])):
                raise ambassadors.AmbassadorError(f"ссылка «{t[0]}» уже у пользователя #{other['id']}")
            if s:
                o2 = db.fetchone("SELECT id FROM users WHERE amb_site = ? AND project_id = ?", (s, pid))
                if o2 and (not user or int(o2["id"]) != int(user["id"])):
                    raise ambassadors.AmbassadorError(f"ссылка на сайт {s} уже у пользователя #{o2['id']}")
        except (ambassadors.AmbassadorError, ValueError) as exc:
            errs.append(f"{code}: {exc}")
            continue
        link = True
        if user is not None:
            uid = int(user["id"])
            first = first_of_user.get(uid) or user.get("amb_tg")
            if first and first != t[0]:
                link = False
                notes.append(f"{code} → #{uid}: у него уже ссылка «{first}» — рефералы {code} ({st['people']}) будут его, "
                             f"но t.me/бот?start={code} перестанет работать")
            else:
                first_of_user[uid] = t[0]
        seen_payload[t[0]] = code
        if s:
            seen_site[s] = code
        out.append({"code": code, "user": user, "payload": t[0] if link else None, "mode": t[1], "site": s,
                    "rate": rate, "people": st["people"], "payers": st["payers"], "paid_rub": st["paid_rub"],
                    "first_at": st["first_at"]})
    for c in stats:
        if c not in inputs:
            errs.append(f"код {c!r} ({stats[c]['people']} человек) есть в partn.db, но не задан — его люди останутся без пригласившего")
    return out, errs, notes, stats


def _prepare_schema(pid: str) -> None:
    with projects.use(pid):
        ambassadors.ensure_schema()
        try:
            import reflevels  # type: ignore
            reflevels._ensure_schema()
        except Exception:  # noqa: BLE001
            pass


# ── check ──

def cmd_check(a, pc) -> int:
    _prepare_schema(a.project)
    items, errs, notes, stats = plan(a, pc)
    log(f"partn.db: людей {pc.execute('SELECT COUNT(*) FROM partner_user').fetchone()[0]}, "
        f"пришли по коду {sum(s['people'] for s in stats.values())}, кодов {len(stats)}")
    log(f"{'код':18s} {'%':>4s} {'пришло':>7s} {'платили':>8s} {'оплатили ₽':>12s}  амбассадор")
    for it in sorted(items, key=lambda x: -x["people"]):
        who = (f"#{it['user']['id']} @{it['user'].get('username') or '—'}" if it["user"]
               else "новый аккаунт без Telegram")
        hint = ""
        if not it["user"]:
            cands = db.fetchall("SELECT telegram_id, username FROM users WHERE project_id = ? AND lower(username) = lower(?)",
                                (a.project, it["code"]))
            if len(cands) == 1:
                hint = f"  (есть @{cands[0]['username']} tg {cands[0]['telegram_id']} — может, это он?)"
        pct = "" if it["rate"] is None else f"{it['rate']:g}"
        rub = f"{float(it['paid_rub'] or 0):,.0f}".replace(",", " ")
        log(f"{it['code']:18s} {pct:>4s} "
            f"{it['people']:7d} {it['payers']:8d} {rub:>12s}  {who}{hint}")
    for n in notes:
        log("  · " + n)
    for e in errs:
        log("  ! " + e)
    log(f"\nБудет амбассадоров: {len(items)} (новых аккаунтов без Telegram: {sum(1 for i in items if not i['user'])}), "
        f"рефералов к привязке: {sum(i['people'] for i in items)}; замечаний: {len(errs)}")
    return 0 if not errs else 2


# ── import ──

def cmd_import(a, pc) -> int:
    pid = a.project
    setting = f"legacy_{pid}_partn_import"
    if db.get_setting(setting, ""):
        raise SystemExit(f"Перенос амбассадоров {pid} уже сделан (настройка {setting}).")
    if not db.get_setting(f"legacy_{pid}_import", ""):
        raise SystemExit(f"Сначала перенос базы бота: legacy_import.py --project {pid} import")
    _prepare_schema(pid)
    items, errs, notes, _stats = plan(a, pc)
    for n in notes:
        log("  · " + n)
    for e in errs:
        log("  ! " + e)
    if errs and not a.force:
        raise SystemExit(f"\nЗамечаний: {len(errs)}. Исправьте или добавьте --force (такие коды пропустятся).")
    net_codes = {r["referral_code"] for r in db.fetchall("SELECT referral_code FROM users WHERE referral_code IS NOT NULL")}

    conn = sqlite3.connect(db.project_db_path(pid), timeout=60)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 60000")
    sdb = "main"
    if db.is_split():
        conn.execute("ATTACH DATABASE ? AS core", (db.dbshard.core_path(db.DB_PATH),))
        sdb = "core"
    conn.create_function("current_project", 0, lambda: pid)
    conn.execute("ATTACH DATABASE ? AS partn", (os.path.abspath(a.partn),))
    res = Counter()
    at = now_iso()
    t0 = time.time()
    amb_ids: dict[str, int] = {}
    try:
        conn.execute("BEGIN IMMEDIATE")
        # 0. архив
        for (t,) in conn.execute("SELECT name FROM partn.sqlite_master WHERE type = 'table'").fetchall():
            name = f"legacy_{pid}_partn_{t}"
            if conn.execute(f"SELECT 1 FROM {sdb}.sqlite_master WHERE name = ?", (name,)).fetchone():
                raise SystemExit(f"Таблица архива {name} уже есть — похоже, перенос уже делали")
            conn.execute(f'CREATE TABLE {sdb}."{name}" AS SELECT * FROM partn."{t}"')
            res["архив таблиц"] += 1
        reg = f"legacy_{pid}_partn_ambassadors"
        conn.execute(f'CREATE TABLE {sdb}."{reg}" (code TEXT PRIMARY KEY, user_id INTEGER NOT NULL, rate REAL, '
                     "created_account INTEGER NOT NULL, link INTEGER NOT NULL, people INTEGER NOT NULL, created_at TEXT NOT NULL)")
        # 1. амбассадоры
        for it in items:
            if it["user"] is not None:
                uid = int(it["user"]["id"])
                created = 0
            else:
                while True:
                    rc = "".join(secrets.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") for _ in range(8))
                    if rc not in net_codes:
                        net_codes.add(rc)
                        break
                cur = conn.execute(
                    "INSERT INTO main.users (telegram_id, project_id, username, first_name, balance, status, is_banned, "
                    "referral_code, is_partner, partner_balance, partner_rate, partner_rate_custom, autopay_enabled, "
                    "created_at, amb_tg, amb_tg_mode, amb_site) "
                    "VALUES (NULL, ?, ?, ?, 0, 'None', 0, ?, 1, 0, ?, ?, 0, ?, ?, ?, ?)",
                    (pid, it["code"], f"Амбассадор {it['code']}", rc,
                     it["rate"] if it["rate"] else 25, 1 if it["rate"] else 0, at,
                     it["payload"], it["mode"] if it["payload"] else None, it["site"]))
                uid = int(cur.lastrowid)
                created = 1
                # служебный аккаунт — не новичок: без онбординга
                conn.executemany("INSERT OR IGNORE INTO main.onboarding_reminders (user_id, stage, sent_at) VALUES (?, ?, ?)",
                                 [(uid, st, at) for st in OB_STAGES])
                res["создано аккаунтов амбассадоров (без Telegram)"] += 1
            if created == 0:
                if it["payload"]:
                    conn.execute("UPDATE main.users SET amb_tg = ?, amb_tg_mode = ?, amb_site = COALESCE(?, amb_site), "
                                 "is_partner = 1 WHERE id = ?", (it["payload"], it["mode"], it["site"], uid))
                if it["rate"] is not None:
                    conn.execute("UPDATE main.users SET partner_rate = ?, partner_rate_custom = ? WHERE id = ?",
                                 (it["rate"] if it["rate"] > 0 else 25, 1 if it["rate"] > 0 else 0, uid))
                res["амбассадор — существующий человек"] += 1
            amb_ids[it["code"]] = uid
            conn.execute(f'INSERT INTO {sdb}."{reg}" VALUES (?, ?, ?, ?, ?, ?, ?)',
                         (it["code"], uid, it["rate"], created, 1 if it["payload"] else 0, it["people"], at))
        # 2. рефералы по коду
        tg2uid = {int(r["telegram_id"]): int(r["id"]) for r in conn.execute(
            "SELECT id, telegram_id FROM main.users WHERE project_id = ? AND telegram_id IS NOT NULL", (pid,))}
        for r in conn.execute("SELECT user_id, referrer FROM partn.partner_user WHERE referrer IS NOT NULL AND referrer != ''").fetchall():
            amb = amb_ids.get(r["referrer"])
            if amb is None:
                res["код не задан — пропущено"] += 1
                continue
            me = tg2uid.get(int(r["user_id"]))
            if me is None:
                res["человека нет в проекте"] += 1
                continue
            if me == amb:
                res["сам себя — пропущено"] += 1
                continue
            if conn.execute("UPDATE main.users SET referred_by = ? WHERE id = ? AND referred_by IS NULL", (amb, me)).rowcount:
                res["привязано рефералов"] += 1
            else:
                res["уже был пригласивший — оставлен"] += 1
        info = {"at": at, "partn": os.path.basename(a.partn),
                "inputs": [os.path.basename(x) for x in (a.ambassadors, a.map) if x],
                "result": dict(res), "warnings": errs[:200], "ambassadors": amb_ids,
                "link_codes": [it["code"] for it in items if it["payload"]]}
        if a.ambassadors:
            with open(a.ambassadors, encoding="utf-8-sig") as fh:
                info["ambassadors_json"] = json.load(fh)
        conn.execute(f"INSERT OR REPLACE INTO {sdb}.settings (key, value) VALUES (?, ?)",
                     (setting, json.dumps(info, ensure_ascii=False)))
        if a.dry_run:
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
        conn.close()
    log(json.dumps(dict(res), ensure_ascii=False, indent=1))
    log(f"за {time.time() - t0:.1f} с")
    if not a.dry_run:
        log("\nДальше: verify; список амбассадоров — list")
    return 0


# ── verify / list ──

def _info(pid: str) -> dict:
    raw = db.get_setting(f"legacy_{pid}_partn_import", "")
    if not raw:
        raise SystemExit("Перенос амбассадоров ещё не делали")
    return json.loads(raw)


def cmd_verify(a, pc) -> int:
    pid = a.project
    info = _info(pid)
    amb = {c: int(u) for c, u in info["ambassadors"].items()}
    link_codes = set(info.get("link_codes") or amb)
    want = info.get("ambassadors_json") or {}
    fails = 0

    def ok(name: str, cond: bool, detail: str = "") -> None:
        nonlocal fails
        log(("OK   " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
        fails += 0 if cond else 1

    for t in [r[0] for r in pc.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]:
        n1 = pc.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        n2 = db.fetchone(f'SELECT COUNT(*) AS c FROM "legacy_{pid}_partn_{t}"')["c"]
        ok(f"архив {t}: {n1} строк", n1 == n2, f"в архиве {n2}")
    _prepare_schema(pid)
    with projects.use(pid):
        bad_link, bad_rate = [], []
        for code, uid in amb.items():
            u = db.fetchone("SELECT * FROM users WHERE id = ?", (uid,))
            if not u:
                bad_link.append(f"{code}: аккаунта #{uid} нет (удалён?)")
                continue
            if code in link_codes:
                found = ambassadors.by_tg(code, pid)
                if not found or int(found["id"]) != uid:
                    bad_link.append(f"{code}: ?start={code} → {found and found['id']}, ожидался #{uid}")
            pct = (want.get(code) or {}).get("percent") if isinstance(want.get(code), dict) else None
            if pct:
                if not u.get("partner_rate_custom") or abs(float(u.get("partner_rate") or 0) - float(pct)) > 1e-9:
                    bad_rate.append(f"{code}: {u.get('partner_rate')} (свой: {bool(u.get('partner_rate_custom'))}), ожидалось {pct}")
        ok(f"ссылки ?start=<код> ведут к своему амбассадору ({len(link_codes)})", not bad_link, "; ".join(bad_link[:5]))
        if want:
            ok("процент у каждого — как в ambassadors.json", not bad_rate, "; ".join(bad_rate[:5]))
        tg2 = {int(r["telegram_id"]): r for r in db.fetchall(
            "SELECT id, telegram_id, referred_by FROM users WHERE project_id = ? AND telegram_id IS NOT NULL", (pid,))}
        missing = other = 0
        for r in pc.execute("SELECT user_id, referrer FROM partner_user WHERE referrer IS NOT NULL AND referrer != ''"):
            if r["referrer"] not in amb:
                continue
            me = tg2.get(int(r["user_id"]))
            if not me or int(me["id"]) == amb[r["referrer"]]:
                continue
            if me["referred_by"] is None:
                missing += 1
            elif int(me["referred_by"]) != amb[r["referrer"]]:
                other += 1
        ok("каждый пришедший по коду — реферал своего амбассадора", missing == 0, f"без пригласившего {missing}")
        if other:
            log(f"     у {other} пригласивший другой (был раньше или аккаунт объединяли) — оставлен")
    log(f"\nИтог: {'ВСЁ СХОДИТСЯ' if not fails else f'РАСХОЖДЕНИЙ: {fails}'}")
    return 0 if not fails else 2


def cmd_list(a, pc) -> int:
    pid = a.project
    info = _info(pid)
    _prepare_schema(pid)
    log(f"{'код':18s} {'аккаунт':>12s} {'Telegram':>12s} {'%':>4s} {'реф.':>6s} {'баланс ₽':>9s}")
    for code, uid in sorted(info["ambassadors"].items()):
        u = db.fetchone("SELECT * FROM users WHERE id = ?", (int(uid),)) or {}
        inv = db.fetchone("SELECT COUNT(*) AS c FROM users WHERE referred_by = ?", (int(uid),))["c"] if u else 0
        log(f"{code:18s} {('#' + str(uid)):>12s} {str(u.get('telegram_id') or '— нет'):>12s} "
            f"{(u.get('partner_rate') or 0):4g} {inv:6d} {float(u.get('partner_balance') or 0):9.2f}"
            + ("" if u else "  (аккаунт удалён/объединён)"))
    log("\nПривязать человека: панель → аккаунт амбассадора → «Telegram ID» → ввести ID → подтвердить объединение.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Амбассадоры старого бота (ambassadors.json + partn.db)")
    ap.add_argument("--project", required=True)
    ap.add_argument("--partn", required=True, help="partn.db")
    ap.add_argument("--ambassadors", default="", help='ambassadors.json: {"код": {"percent": 20}, …}')
    ap.add_argument("--map", default="", help="необязательно, CSV: code,telegram_id[,rate,site,tg] — если ID известен")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    s = sub.add_parser("import")
    s.add_argument("--dry-run", action="store_true")
    s.add_argument("--force", action="store_true", help="пропустить коды с замечаниями")
    sub.add_parser("verify")
    sub.add_parser("list")
    a = ap.parse_args()
    db.init_db()
    if not projects.exists(a.project):
        raise SystemExit(f"Нет проекта {a.project}")
    pc = open_partn(a.partn)
    if a.cmd in ("check", "import"):
        load_inputs(a)  # ранняя проверка файлов
    return {"check": cmd_check, "import": cmd_import, "verify": cmd_verify, "list": cmd_list}[a.cmd](a, pc)


if __name__ == "__main__":
    raise SystemExit(main())
