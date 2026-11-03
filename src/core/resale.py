# Ресейл: клиенты ресейлеров в общем Remnawave (dnet_…, atom_… — у каждого в карточке telegramId)
# и перенос клиентов ресейлера в FGN.
#
# Remnawave здесь ТОЛЬКО читаем (GET /api/users): чужих пользователей не меняем и не отключаем.
# Перенос: снимок группы на момент переноса → для каждого Telegram ID остаток срока min(остаток, 30 дней)
# (истёкшие и с остатком меньше суток — не переносим). Когда человек с этим Telegram ID заходит в FGN
# (мини-приложение или сайт), он видит окно «<старый VPN> теперь FGN» и кнопкой «Заменить ключ»
# получает этот срок: прибавкой к своей подписке FGN или новой подпиской.
from __future__ import annotations

import re
import sqlite3
import threading
import time
import uuid as _uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

try:
    from . import database as db  # type: ignore
    from . import fulfillment  # type: ignore
    from . import provisioning  # type: ignore
except ImportError:
    import database as db  # type: ignore
    import fulfillment  # type: ignore
    import provisioning  # type: ignore

projects = db.projects

TARGET_PROJECT = "fgn"                    # перенос строго в FGN
KNOWN_PREFIXES = ("dnet_", "atom_", "vasya_", "vasilych_", "sunduk_")
DAY = 86400
MAX_GRANT_SECONDS = 30 * DAY              # больше 30 дней не даём, даже если оставался год
MIN_REMAINING_SECONDS = DAY               # меньше суток («0 дней») — не переносим
NAME_MAX = 40

PAGE_SIZE = 500                           # Remnawave: size ≤ 1000
PAGE_OVERLAP = 50                         # страницы внахлёст: сдвиг списка во время чтения не теряет людей
RW_TIMEOUT = 60.0
MAX_PAGES = 5000

_PREFIX_RE = re.compile(r"^([A-Za-z0-9][A-Za-z0-9-]{0,31})_")
SCAN_SETTING = "resale_scan"              # сводка последнего чтения Remnawave (общая для сети)


class ResaleError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ── схема ──

SCHEMA = """
CREATE TABLE IF NOT EXISTS resale_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prefix TEXT NOT NULL,
    old_name TEXT NOT NULL,
    target_project TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',   -- running | active | failed | cancelled
    snapshot_at TEXT,
    scanned INTEGER NOT NULL DEFAULT 0,       -- подписок группы в Remnawave
    no_tg INTEGER NOT NULL DEFAULT 0,         -- без Telegram ID
    expired INTEGER NOT NULL DEFAULT 0,       -- с Telegram ID, но истёкших / меньше суток
    capped INTEGER NOT NULL DEFAULT 0,        -- оставалось больше 30 дней → 30
    skipped_claimed INTEGER NOT NULL DEFAULT 0, -- уже получили в прошлом переносе этой группы
    people INTEGER NOT NULL DEFAULT 0,        -- перенесено людей (уникальных Telegram ID)
    error TEXT,
    info_url TEXT,                            -- ссылка с объяснением (telegra.ph): в сообщении бота при /start
    created_by TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    cancelled_at TEXT,
    cancelled_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_resale_mig_prefix ON resale_migrations(prefix, status);
-- одна живая (идёт / действует) миграция на группу: два одновременных запуска не пройдут
CREATE UNIQUE INDEX IF NOT EXISTS uq_resale_mig_live ON resale_migrations(prefix) WHERE status IN ('running', 'active');

CREATE TABLE IF NOT EXISTS resale_migration_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    rw_usernames TEXT NOT NULL DEFAULT '[]',
    old_expire_at TEXT,
    remaining_seconds INTEGER NOT NULL,       -- сколько оставалось на момент переноса
    grant_seconds INTEGER NOT NULL,           -- сколько выдаём: min(остаток, 30 дней)
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | claiming | claimed | cancelled
    claim_token TEXT,
    claimed_user_id INTEGER,
    claimed_at TEXT,
    granted_until TEXT,
    notified_at TEXT,                         -- когда бот один раз прислал «Ваши подписки переезжают»
    granted_seconds INTEGER,                  -- сколько выдали на самом деле (общий потолок 30 дней на Telegram ID)
    claim_sub_id INTEGER,                     -- подписка, которую продлеваем (для восстановления после рестарта)
    claim_prev_exp TEXT,                      -- её срок до выдачи; новая подписка — «new:<макс. id подписок>»
    UNIQUE (migration_id, telegram_id)
);
CREATE INDEX IF NOT EXISTS idx_resale_users_tg ON resale_migration_users(telegram_id, status);
"""

_schema_ready = False
_schema_lock = threading.Lock()


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        conn = db.connect()
        conn.executescript(SCHEMA)
        # старые базы: новые столбцы (API и бот — разные процессы: второй ALTER того же столбца не ошибка)
        for table, col, typ in (("resale_migrations", "info_url", "TEXT"),
                                ("resale_migration_users", "notified_at", "TEXT"),
                                ("resale_migration_users", "granted_seconds", "INTEGER"),
                                ("resale_migration_users", "claim_sub_id", "INTEGER"),
                                ("resale_migration_users", "claim_prev_exp", "TEXT")):
            cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
            if col not in cols:
                try:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
                except sqlite3.OperationalError as exc:
                    if "duplicate column" not in str(exc).lower():
                        raise
        conn.commit()
        _schema_ready = True


def recover_after_restart() -> None:
    """ТОЛЬКО при старте API (фоновые задачи и выдачи живут в его процессе; бот — отдельный процесс и
    сюда не ходит). Перенос, оборванный перезапуском, иначе навсегда остался бы «Выполняется» и блокировал
    группу. Выдача, оборванная посередине, — по подписке смотрим, успела ли она продлиться."""
    ensure_schema()
    db.execute("UPDATE resale_migrations SET status = 'failed', error = 'Прервано перезапуском сервера — запустите перенос заново', "
               "finished_at = ? WHERE status = 'running'", (_iso(_now()),))
    for t in db.fetchall("SELECT DISTINCT claim_token FROM resale_migration_users WHERE status = 'claiming' "
                         "AND claim_token IS NOT NULL"):
        token = t["claim_token"]
        r = db.fetchone("SELECT * FROM resale_migration_users WHERE claim_token = ? AND status = 'claiming' LIMIT 1", (token,))
        if not r or not r.get("claimed_user_id") or not r.get("claim_prev_exp"):
            continue  # запись старого формата — оставляем как есть, видно в панели «Выдаётся»
        uid, prev = int(r["claimed_user_id"]), str(r["claim_prev_exp"])
        done_sub = None
        if prev.startswith("new:"):
            try:
                max_id = int(prev[4:])
            except ValueError:
                continue
            done_sub = db.fetchone("SELECT * FROM subscriptions WHERE user_id = ? AND id > ? AND status != 'Deleted' "
                                   "ORDER BY id DESC LIMIT 1", (uid, max_id))
        elif r.get("claim_sub_id"):
            sub = db.fetchone("SELECT * FROM subscriptions WHERE id = ?", (int(r["claim_sub_id"]),))
            if sub and prev.startswith("exp:") and str(sub.get("expires_at") or "") != prev[4:]:
                done_sub = sub
        if done_sub:
            db.execute("UPDATE resale_migration_users SET status = 'claimed', granted_until = ? "
                       "WHERE claim_token = ? AND status = 'claiming'", (done_sub.get("expires_at"), token))
            print(f"[resale] выдача user {uid} после рестарта: подписка продлена — отмечено «заменён»", flush=True)
        else:
            _release_claim(token)
            print(f"[resale] выдача user {uid} после рестарта: не успела — снова ждёт замены ключа", flush=True)


# ── чтение Remnawave ──

def prefix_of(username: Any) -> Optional[str]:
    """«dnet_123» → «dnet_»; свои batman_<id> и имена без «_» — None."""
    m = _PREFIX_RE.match(str(username or ""))
    if not m:
        return None
    p = m.group(1) + "_"
    if p == provisioning.USERNAME_PREFIX:
        return None
    return p


def _tg(u: dict[str, Any]) -> Optional[int]:
    raw = u.get("telegramId")
    if raw is None:
        raw = u.get("telegram_id")
    try:
        v = int(str(raw).strip()) if raw is not None and str(raw).strip() != "" else None
    except (TypeError, ValueError):
        return None
    return v if v and v > 0 else None


def _page(data: Any) -> tuple[list[dict[str, Any]], Optional[int]]:
    if isinstance(data, dict) and isinstance(data.get("response"), (dict, list)):
        data = data["response"]
    total = None
    users: list[dict[str, Any]] = []
    if isinstance(data, dict):
        for key in ("users", "items", "data"):
            if isinstance(data.get(key), list):
                users = [u for u in data[key] if isinstance(u, dict)]
                break
        try:
            total = int(data["total"]) if data.get("total") is not None else None
        except (TypeError, ValueError):
            total = None
    elif isinstance(data, list):
        users = [u for u in data if isinstance(u, dict)]
    return users, total


def _slim(u: dict[str, Any]) -> Optional[dict[str, Any]]:
    name = str(u.get("username") or "")
    p = prefix_of(name)
    if not p:
        return None
    exp = _parse(u.get("expireAt") or u.get("expire_at"))
    return {
        "username": name,
        "prefix": p,
        "tg": _tg(u),
        "expire_at": _iso(exp) if exp else None,
        "status": str(u.get("status") or "").upper(),
    }


def _client():
    """отдельный клиент с длинным таймаутом: страница на 500 человек тяжёлая."""
    try:
        import remnawave  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise ResaleError(f"Remnawave недоступна: {exc}", 503) from None
    if not provisioning.is_configured():
        raise ResaleError("Remnawave не настроена (REMWAVE_API_KEY)", 503)
    base = remnawave.get_client()
    return remnawave.RemnawaveAPI(base.base_url, base.token, timeout=RW_TIMEOUT, verify_ssl=base.verify_ssl)


def fetch_reseller_users(client: Any = None, progress: Optional[Callable[[int, Optional[int]], None]] = None
                         ) -> tuple[list[dict[str, Any]], int, Optional[int]]:
    """все пользователи Remnawave с чужими префиксами (не batman_). Только чтение.
    Возвращает (пользователи ресейлеров, сколько всего прочитано в панели, total по панели)."""
    client = client or _client()
    seen: dict[str, dict[str, Any]] = {}
    read_keys: set[str] = set()
    start, size, total = 0, PAGE_SIZE, None
    for _ in range(MAX_PAGES):
        page = None
        for attempt in range(3):
            try:
                page = client.get_users(start=start, size=size)
                break
            except Exception as exc:  # noqa: BLE001
                if attempt == 2:
                    raise ResaleError(f"Не удалось прочитать пользователей Remnawave: {exc}", 502) from None
                time.sleep(1.5 * (attempt + 1))
        users, t = _page(page)
        if t is not None:
            total = t
        if not users:
            break
        for u in users:
            key = str(u.get("id") or u.get("uuid") or u.get("username") or "")
            if not key:
                continue
            read_keys.add(key)
            s = _slim(u)
            if s:
                seen[key] = s
        if progress:
            progress(len(read_keys), total)
        end = start + len(users)
        if total is not None and end >= total:
            break
        if total is None and len(users) < size:
            break
        # следующая страница внахлёст: если за время чтения кого-то удалили/добавили, никого не пропустим
        start = end - PAGE_OVERLAP if len(users) > PAGE_OVERLAP * 2 else end
    else:
        raise ResaleError("Слишком много страниц в Remnawave — чтение остановлено", 502)
    return list(seen.values()), len(read_keys), total


def _grant_for(remaining: float) -> int:
    return int(min(max(0.0, remaining), MAX_GRANT_SECONDS))


def build_people(users: list[dict[str, Any]], prefix: str, now: datetime) -> dict[str, Any]:
    """группа prefix → кого переносим. Один Telegram ID с несколькими подписками — берём самую долгую."""
    group = [u for u in users if u["prefix"] == prefix]
    people: dict[int, dict[str, Any]] = {}
    no_tg = 0
    expired_subs = 0
    for u in group:
        tg = u.get("tg")
        if not tg:
            no_tg += 1
            continue
        exp = _parse(u.get("expire_at"))
        remaining = (exp - now).total_seconds() if exp else 0.0
        if remaining < MIN_REMAINING_SECONDS:
            expired_subs += 1
            continue
        cur = people.get(tg)
        if cur is None:
            people[tg] = {"telegram_id": tg, "usernames": [u["username"]], "old_expire_at": u["expire_at"],
                          "remaining": int(remaining)}
        else:
            cur["usernames"].append(u["username"])
            if remaining > cur["remaining"]:
                cur["remaining"] = int(remaining)
                cur["old_expire_at"] = u["expire_at"]
    for p in people.values():
        p["grant"] = _grant_for(p["remaining"])
    tgs_all = {u["tg"] for u in group if u.get("tg")}
    expired_people = len(tgs_all - set(people))
    return {
        "subs": len(group),
        "no_tg": no_tg,
        "expired_subs": expired_subs,
        "expired_people": expired_people,
        "people": people,
    }


def _fgn_accounts(tgs: list[int]) -> int:
    n = 0
    for i in range(0, len(tgs), 500):
        chunk = tgs[i:i + 500]
        row = db.fetchone(
            f"SELECT COUNT(*) AS c FROM users WHERE project_id = ? AND telegram_id IN ({','.join('?' * len(chunk))})",
            (TARGET_PROJECT, *chunk))
        n += int((row or {}).get("c") or 0)
    return n


def _group_summary(users: list[dict[str, Any]], prefix: str, now: datetime) -> dict[str, Any]:
    b = build_people(users, prefix, now)
    people = list(b["people"].values())
    buckets = {"d1_7": 0, "d8_14": 0, "d15_30": 0, "over30": 0}
    total_grant = 0
    for p in people:
        days = p["remaining"] / DAY
        if days > 30:
            buckets["over30"] += 1
        elif days > 14:
            buckets["d15_30"] += 1
        elif days > 7:
            buckets["d8_14"] += 1
        else:
            buckets["d1_7"] += 1
        total_grant += p["grant"]
    statuses: dict[str, int] = {}
    for u in users:
        if u["prefix"] == prefix:
            statuses[u["status"] or "?"] = statuses.get(u["status"] or "?", 0) + 1
    return {
        "prefix": prefix,
        "known": prefix in KNOWN_PREFIXES,
        "subs": b["subs"],
        "with_tg": b["subs"] - b["no_tg"],
        "no_tg": b["no_tg"],
        "people": len(people),
        "expired_people": b["expired_people"],
        "expired_subs": b["expired_subs"],
        "buckets": buckets,
        "grant_days_total": round(total_grant / DAY),
        "in_fgn": _fgn_accounts([p["telegram_id"] for p in people]) if people else 0,
        "statuses": statuses,
    }


# ── фоновая задача (одна на всё: чтение или перенос) ──

_job_lock = threading.Lock()
_job: dict[str, Any] = {"kind": None, "running": False, "read": 0, "total": None, "started_at": None,
                        "finished_at": None, "error": None, "migration_id": None}


def job_state() -> dict[str, Any]:
    return dict(_job)


def _start_job(kind: str, target: Callable[[], None], migration_id: Optional[int] = None) -> None:
    if not _job_lock.acquire(blocking=False):
        raise ResaleError("Уже выполняется чтение Remnawave или перенос — дождитесь окончания", 409)
    _job.update(kind=kind, running=True, read=0, total=None, started_at=_iso(_now()), finished_at=None,
                error=None, migration_id=migration_id)

    def _run() -> None:
        try:
            target()
        except ResaleError as exc:
            _job["error"] = exc.message
        except Exception as exc:  # noqa: BLE001
            _job["error"] = f"{type(exc).__name__}: {exc}"
            print(f"[resale] {kind}: {type(exc).__name__}: {exc}", flush=True)
        finally:
            _job.update(running=False, finished_at=_iso(_now()))
            _job_lock.release()

    try:
        threading.Thread(target=projects.bind(_run), name=f"resale-{kind}", daemon=True).start()
    except Exception:
        _job.update(running=False)
        _job_lock.release()
        raise


def _progress(read: int, total: Optional[int]) -> None:
    _job["read"] = read
    _job["total"] = total


def _save_scan(users: list[dict[str, Any]], read: int, total: Optional[int]) -> dict[str, Any]:
    now = _now()
    prefixes = sorted({u["prefix"] for u in users} | set(KNOWN_PREFIXES))
    groups = [_group_summary(users, p, now) for p in prefixes]
    # известные ресейлеры первыми, дальше — по числу подписок
    groups.sort(key=lambda g: (0 if g["known"] else 1, -g["subs"], g["prefix"]))
    data = {"at": _iso(now), "read": read, "total": total, "groups": groups}
    db.set_setting(SCAN_SETTING, db.dumps(data))
    return data


def start_scan() -> None:
    ensure_schema()

    def _scan() -> None:
        users, read, total = fetch_reseller_users(progress=_progress)
        _save_scan(users, read, total)
        print(f"[resale] Remnawave прочитана: {read} пользователей, ресейлеров {len(users)}", flush=True)

    _start_job("scan", _scan)


def last_scan() -> Optional[dict[str, Any]]:
    return db.loads(db.get_setting(SCAN_SETTING, ""), None)


# ── перенос ──

def normalize_prefix(raw: Any) -> str:
    p = str(raw or "").strip()
    if p and not p.endswith("_"):
        p += "_"
    if not _PREFIX_RE.fullmatch(p) or p == provisioning.USERNAME_PREFIX:
        raise ResaleError("Неверный префикс группы")
    return p


def normalize_name(raw: Any) -> str:
    name = re.sub(r"\s+", " ", str(raw or "")).strip()
    if not name:
        raise ResaleError("Введите название старого VPN")
    if len(name) > NAME_MAX:
        raise ResaleError(f"Название — не длиннее {NAME_MAX} символов")
    if re.search(r"[<>\x00-\x1f]", name):
        raise ResaleError("В названии недопустимые символы")
    return name


def target_name() -> str:
    try:
        return projects.get(TARGET_PROJECT).name
    except Exception:  # noqa: BLE001
        return "FGN"


INFO_URL_MAX = 500
_INFO_URL_RE = re.compile(r"^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d{1,5})?(?:[/?#][^\s<>\"']*)?$")


def normalize_info_url(raw: Any) -> str:
    """ссылка с объяснением переноса: только https, без пробелов и кавычек."""
    url = str(raw or "").strip()
    if not url:
        raise ResaleError("Укажите ссылку с объяснением переноса")
    if len(url) > INFO_URL_MAX or not _INFO_URL_RE.match(url):
        raise ResaleError("Ссылка должна начинаться с https:// — например, https://telegra.ph/…")
    return url


def set_info_url(mid: int, raw: Any) -> str:
    ensure_schema()
    url = normalize_info_url(raw)
    m = db.fetchone("SELECT status FROM resale_migrations WHERE id = ?", (int(mid),))
    if not m:
        raise ResaleError("Перенос не найден", 404)
    if m["status"] not in ("running", "active"):
        raise ResaleError("Перенос уже не действует")
    db.execute("UPDATE resale_migrations SET info_url = ? WHERE id = ?", (url, int(mid)))
    return url


def start_migration(prefix: str, name: str, actor: str, info_url: Any = "") -> int:
    """запуск переноса в фоне: свежее чтение Remnawave → снимок → записи «ждёт замены ключа»."""
    ensure_schema()
    if not projects.exists(TARGET_PROJECT):
        raise ResaleError("Проект FGN не найден в сети", 500)
    prefix = normalize_prefix(prefix)
    name = normalize_name(name)
    info_url = normalize_info_url(info_url)
    busy = db.fetchone("SELECT id FROM resale_migrations WHERE prefix = ? AND status IN ('running', 'active') LIMIT 1",
                       (prefix,))
    if busy:
        raise ResaleError(f"Группа {prefix} уже перенесена. Чтобы перенести заново, сначала отмените прошлый перенос", 409)
    if not _job_lock.acquire(blocking=False):
        raise ResaleError("Уже выполняется чтение Remnawave или перенос — дождитесь окончания", 409)
    _job_lock.release()
    try:
        db.execute(
            "INSERT INTO resale_migrations (prefix, old_name, target_project, status, info_url, created_by, created_at) "
            "VALUES (?, ?, ?, 'running', ?, ?, ?)",
            (prefix, name, TARGET_PROJECT, info_url, (actor or "")[:60], _iso(_now())),
        )
    except sqlite3.IntegrityError:
        raise ResaleError(f"Группа {prefix} уже переносится или перенесена", 409) from None
    mid = int(db.last_id())

    def _migrate() -> None:
        try:
            _run_migration(mid, prefix)
        except BaseException as exc:
            msg = exc.message if isinstance(exc, ResaleError) else f"{type(exc).__name__}: {exc}"
            db.execute("UPDATE resale_migrations SET status = 'failed', error = ?, finished_at = ? "
                       "WHERE id = ? AND status = 'running'", (msg[:500], _iso(_now()), mid))
            raise

    try:
        _start_job("migrate", _migrate, migration_id=mid)
    except ResaleError:
        db.execute("UPDATE resale_migrations SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
                   ("не запустился: занято", _iso(_now()), mid))
        raise
    return mid


def _run_migration(mid: int, prefix: str) -> None:
    users, read, total = fetch_reseller_users(progress=_progress)
    snapshot = _now()
    b = build_people(users, prefix, snapshot)
    people = b["people"]
    with db.transaction():
        # кто уже получил срок в прошлом переносе этой группы — второй раз не даём;
        # получил из другой группы — только остаток до общего потолка 30 дней
        claimed = {int(r["telegram_id"]) for r in db.fetchall(
            "SELECT DISTINCT u.telegram_id FROM resale_migration_users u JOIN resale_migrations m ON m.id = u.migration_id "
            "WHERE m.prefix = ? AND u.status IN ('claimed', 'claiming')", (prefix,))}
        given = _granted_totals()
        rows = []
        capped = 0
        for tg, p in people.items():
            if tg in claimed:
                continue
            grant = min(int(p["grant"]), MAX_GRANT_SECONDS - given.get(tg, 0))
            if grant < MIN_REMAINING_SECONDS:
                claimed.add(tg)  # потолок уже выбран — считаем в «уже получали»
                continue
            if p["remaining"] > MAX_GRANT_SECONDS:
                capped += 1
            rows.append((mid, tg, db.dumps(sorted(p["usernames"])), p["old_expire_at"], int(p["remaining"]), grant))
        if rows:
            db.executemany(
                "INSERT INTO resale_migration_users (migration_id, telegram_id, rw_usernames, old_expire_at, "
                "remaining_seconds, grant_seconds) VALUES (?, ?, ?, ?, ?, ?)", rows)
        cur = db.execute(
            "UPDATE resale_migrations SET status = 'active', snapshot_at = ?, scanned = ?, no_tg = ?, expired = ?, "
            "capped = ?, skipped_claimed = ?, people = ?, finished_at = ? WHERE id = ? AND status = 'running'",
            (_iso(snapshot), b["subs"], b["no_tg"], b["expired_people"], capped,
             len([t for t in people if t in claimed]), len(rows), _iso(_now()), mid))
        if cur.rowcount != 1:
            raise ResaleError("Перенос отменён во время выполнения")
    # сводку групп тоже обновляем — чтение уже сделано
    try:
        _save_scan(users, read, total)
    except Exception as exc:  # noqa: BLE001
        print(f"[resale] сводка после переноса: {exc}", flush=True)
    print(f"[resale] перенос #{mid} {prefix}: людей {len(rows)}, подписок в группе {b['subs']}", flush=True)


def cancel_migration(mid: int, actor: str) -> dict[str, Any]:
    """отмена: окно больше не показывается тем, кто ещё не заменил ключ. Уже выданные сроки остаются."""
    ensure_schema()
    m = db.fetchone("SELECT * FROM resale_migrations WHERE id = ?", (int(mid),))
    if not m:
        raise ResaleError("Перенос не найден", 404)
    if m["status"] not in ("active", "failed"):
        raise ResaleError("Этот перенос нельзя отменить")
    with db.transaction():
        db.execute("UPDATE resale_migrations SET status = 'cancelled', cancelled_at = ?, cancelled_by = ? WHERE id = ?",
                   (_iso(_now()), (actor or "")[:60], int(mid)))
        cur = db.execute("UPDATE resale_migration_users SET status = 'cancelled' WHERE migration_id = ? AND status = 'pending'",
                         (int(mid),))
    return {"cancelled": int(cur.rowcount or 0)}


def _mig_counts(mid: int) -> dict[str, int]:
    out = {"pending": 0, "claiming": 0, "claimed": 0, "cancelled": 0}
    for r in db.fetchall("SELECT status, COUNT(*) AS c FROM resale_migration_users WHERE migration_id = ? GROUP BY status",
                         (int(mid),)):
        out[str(r["status"])] = int(r["c"])
    return out


def migrations() -> list[dict[str, Any]]:
    ensure_schema()
    out = []
    for m in db.fetchall("SELECT * FROM resale_migrations ORDER BY id DESC LIMIT 100"):
        out.append({**m, "counts": _mig_counts(int(m["id"]))})
    return out


def migration_users(mid: int, status: str = "", q: str = "", limit: int = 100, offset: int = 0) -> dict[str, Any]:
    ensure_schema()
    where, params = ["u.migration_id = ?"], [int(mid)]
    if status in ("pending", "claiming", "claimed", "cancelled"):
        where.append("u.status = ?")
        params.append(status)
    q = (q or "").strip()
    if q:
        if q.isdigit():
            where.append("(u.telegram_id = ? OR u.rw_usernames LIKE ?)")
            params += [int(q), f"%{q}%"]
        else:
            where.append("u.rw_usernames LIKE ?")
            params.append(f"%{q}%")
    w = " AND ".join(where)
    total = int((db.fetchone(f"SELECT COUNT(*) AS c FROM resale_migration_users u WHERE {w}", params) or {}).get("c") or 0)
    rows = db.fetchall(
        f"SELECT u.*, (SELECT id FROM users x WHERE x.project_id = ? AND x.telegram_id = u.telegram_id LIMIT 1) AS fgn_user_id "
        f"FROM resale_migration_users u WHERE {w} ORDER BY u.id LIMIT ? OFFSET ?",
        [TARGET_PROJECT, *params, max(1, min(500, int(limit))), max(0, int(offset))])
    items = []
    for r in rows:
        items.append({
            "telegram_id": r["telegram_id"],
            "usernames": db.loads(r.get("rw_usernames"), []) or [],
            "old_expire_at": r.get("old_expire_at"),
            "remaining_days": round(int(r["remaining_seconds"]) / DAY, 1),
            "grant_days": round(int(r["grant_seconds"]) / DAY, 1),
            "status": r["status"],
            "claimed_at": r.get("claimed_at"),
            "granted_until": r.get("granted_until"),
            "user_id": r.get("claimed_user_id") or r.get("fgn_user_id"),
        })
    return {"total": total, "items": items}


def overview() -> dict[str, Any]:
    ensure_schema()
    scan = last_scan()
    active = {m["prefix"]: m for m in db.fetchall(
        "SELECT id, prefix, old_name, status FROM resale_migrations WHERE status IN ('running', 'active')")}
    if scan:
        for g in scan.get("groups") or []:
            m = active.get(g["prefix"])
            g["migration"] = ({"id": m["id"], "old_name": m["old_name"], "status": m["status"]} if m else None)
    return {
        "target": {"id": TARGET_PROJECT, "name": target_name()},
        "rules": {"max_days": MAX_GRANT_SECONDS // DAY, "min_days": MIN_REMAINING_SECONDS // DAY},
        "scan": scan,
        "job": job_state(),
        "migrations": migrations(),
    }


# ── человек заходит в FGN ──

def _eligible_user(user: Optional[dict[str, Any]]) -> bool:
    return bool(user) and projects.of(user) == TARGET_PROJECT and bool(user.get("telegram_id")) \
        and not user.get("is_banned")


def _granted_totals(telegram_id: Optional[int] = None) -> dict[int, int]:
    """сколько секунд уже выдано по переносам на Telegram ID (все группы). Одна выдача = один claim_token,
    в ней все строки с одним сроком — берём максимум по токену."""
    where, params = "", []
    if telegram_id is not None:
        where, params = " AND u.telegram_id = ?", [int(telegram_id)]
    out: dict[int, int] = {}
    for r in db.fetchall(
            "SELECT u.telegram_id AS tg, MAX(MIN(COALESCE(u.granted_seconds, u.grant_seconds), ?)) AS s "
            "FROM resale_migration_users u JOIN resale_migrations m ON m.id = u.migration_id "
            f"WHERE u.status IN ('claimed', 'claiming') AND m.target_project = ?{where} "
            "GROUP BY u.telegram_id, COALESCE(u.claim_token, u.id)", [MAX_GRANT_SECONDS, TARGET_PROJECT, *params]):
        out[int(r["tg"])] = min(MAX_GRANT_SECONDS, out.get(int(r["tg"]), 0) + int(r["s"] or 0))
    return out


def _release_claim(token: str) -> None:
    db.execute("UPDATE resale_migration_users SET status = 'pending', claim_token = NULL, claimed_user_id = NULL, "
               "claimed_at = NULL, granted_seconds = NULL, claim_sub_id = NULL, claim_prev_exp = NULL "
               "WHERE claim_token = ? AND status = 'claiming'", (token,))


def _pending_rows(telegram_id: int) -> list[dict[str, Any]]:
    return db.fetchall(
        "SELECT u.*, m.old_name, m.info_url FROM resale_migration_users u JOIN resale_migrations m ON m.id = u.migration_id "
        "WHERE u.telegram_id = ? AND u.status = 'pending' AND m.status = 'active' AND m.target_project = ? "
        "ORDER BY u.grant_seconds DESC, u.id ASC",
        (int(telegram_id), TARGET_PROJECT))


def pending_for(user: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """окно «<старый VPN> теперь FGN» — если человеку есть что забрать."""
    if not _eligible_user(user):
        return None
    ensure_schema()
    rows = _pending_rows(int(user["telegram_id"]))  # type: ignore[index]
    if not rows:
        return None
    top = rows[0]
    left = MAX_GRANT_SECONDS - _granted_totals(int(user["telegram_id"])).get(int(user["telegram_id"]), 0)  # type: ignore[index]
    return {
        "name": top["old_name"],
        "target": target_name(),
        "days": int(max(0, min(int(top["grant_seconds"]), left)) // DAY),
        "info_url": top.get("info_url") or "",
    }


def take_start_notice(user: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """/start в FGN: один раз сообщить «Ваши подписки переезжают» со ссылкой переноса.
    Строки сразу помечаются отправленными (два /start подряд не дадут два сообщения);
    не удалось отправить — release_start_notice(ids)."""
    if not _eligible_user(user):
        return None
    ensure_schema()
    rows = [r for r in _pending_rows(int(user["telegram_id"])) if r.get("info_url")]  # type: ignore[index]
    fresh = [r for r in rows if not r.get("notified_at")]
    if not fresh:
        return None
    now = _iso(_now())
    ids = []
    for r in fresh:
        cur = db.execute("UPDATE resale_migration_users SET notified_at = ? WHERE id = ? AND notified_at IS NULL",
                         (now, int(r["id"])))
        if cur.rowcount == 1:
            ids.append(int(r["id"]))
    if not ids:
        return None
    top = next(r for r in fresh if int(r["id"]) in ids)
    return {"ids": ids, "target": target_name(), "name": top["old_name"], "info_url": top["info_url"]}


def release_start_notice(ids: list[int]) -> None:
    for i in ids:
        db.execute("UPDATE resale_migration_users SET notified_at = NULL WHERE id = ?", (int(i),))


def _end_grace(user_id: int) -> None:
    try:
        try:
            from . import grace  # type: ignore
        except ImportError:
            import grace  # type: ignore
        grace.end_for_user(int(user_id))
    except Exception:  # noqa: BLE001
        pass


def grant_seconds(user: dict[str, Any], seconds: int) -> dict[str, Any]:
    """+seconds к подписке FGN (как продление: от конца текущей или от сейчас); нет подписки — новая.
    Remnawave обновляется ДО базы: не вышло — ничего не меняем и бросаем ошибку."""
    seconds = int(seconds)
    if seconds <= 0:
        raise ResaleError("Нечего начислять")
    uid = int(user["id"])
    tg = int(user["telegram_id"]) if user.get("telegram_id") else None
    now = _now()
    GB = fulfillment.GB
    target, upgrading_trial = fulfillment.find_extend_target(uid, "extend", None)

    if target is not None and not target.get("expires_at") and target.get("status") == "Active":
        # бессрочная — продлевать нечего
        return {"subscription_id": target["id"], "expires_at": None, "mode": "forever"}

    if target is not None:
        base = _parse(target.get("expires_at")) or now
        if base < now:
            base = now
        new_exp = base + timedelta(seconds=seconds)
        squads = fulfillment.squads_for()
        if upgrading_trial:
            # пробная → обычная: устройства и трафик по тарифу, трафик пробной обнуляем (как при оплате)
            devices = max(1, fulfillment.tariff_devices())
            traffic_gb = fulfillment.paid_traffic_gb()
            prov = provisioning.provision(
                user_id=uid, telegram_id=tg, username=user.get("username"), expire_at=new_exp,
                devices=devices, squads=squads, email=user.get("email"),
                traffic_limit_bytes=traffic_gb * GB, traffic_reset_strategy=fulfillment.RESET_STRATEGY,
                reset_traffic=True,
            )
        else:
            # своя подписка: только срок; устройства и трафик — как были (сквады — обычные VPN, как при продлении)
            devices = max(1, int(target.get("devices_limit") or 1))
            traffic_gb = None
            prov = provisioning.provision(
                user_id=uid, telegram_id=tg, username=user.get("username"), expire_at=new_exp,
                devices=devices, squads=squads, email=user.get("email"),
                traffic_limit_bytes=None, traffic_reset_strategy=fulfillment.RESET_STRATEGY,
            )
        if provisioning.is_configured() and not prov.get("ok"):
            raise ResaleError(f"Remnawave: {prov.get('error') or 'не удалось'}", 502)
        if upgrading_trial:
            db.execute(
                "UPDATE subscriptions SET expires_at = ?, status = 'Active', devices_limit = ?, traffic_limit = ?, "
                "traffic_used = 0, type = 'vpn', squads_json = ? WHERE id = ?",
                (_iso(new_exp), devices, traffic_gb, db.dumps(squads), target["id"]))
        else:
            db.execute("UPDATE subscriptions SET expires_at = ?, status = 'Active' WHERE id = ?",
                       (_iso(new_exp), target["id"]))
        # срок уже записан: дальше — только сопутствующее; его сбой не должен вернуть перенос в «ждёт»
        # (иначе повторное нажатие выдало бы срок второй раз)
        _after_grant(uid, lambda: fulfillment._apply_provision_to_sub(target, prov))
        return {"subscription_id": target["id"], "expires_at": _iso(new_exp),
                "mode": "trial_upgrade" if upgrading_trial else "extend"}

    new_exp = now + timedelta(seconds=seconds)
    squads = fulfillment.squads_for()
    devices = max(1, fulfillment.tariff_devices())
    traffic_gb = fulfillment.paid_traffic_gb()
    prov = provisioning.provision(
        user_id=uid, telegram_id=tg, username=user.get("username"), expire_at=new_exp,
        devices=devices, squads=squads, email=user.get("email"),
        traffic_limit_bytes=traffic_gb * GB, traffic_reset_strategy=fulfillment.RESET_STRATEGY,
    )
    if provisioning.is_configured() and not prov.get("ok"):
        raise ResaleError(f"Remnawave: {prov.get('error') or 'не удалось'}", 502)
    sub = fulfillment._create_subscription_row(
        user=user, devices=devices, expire_at=new_exp, provision=prov,
        traffic_gb=traffic_gb, sub_type="vpn", squads=squads,
    )
    _after_grant(uid, None)
    return {"subscription_id": sub["id"], "expires_at": sub.get("expires_at") or _iso(new_exp), "mode": "new"}


def _after_grant(uid: int, apply: Optional[Callable[[], None]]) -> None:
    for step in (apply, lambda: fulfillment._sync_user_status(uid), lambda: _end_grace(uid)):
        if step is None:
            continue
        try:
            step()
        except Exception as exc:  # noqa: BLE001
            print(f"[resale] user {uid}: после выдачи: {type(exc).__name__}: {exc}", flush=True)


_claim_lock = threading.Lock()


def claim(user: dict[str, Any]) -> dict[str, Any]:
    """«Заменить ключ»: выдать срок из переноса. Повторное нажатие не начисляет второй раз."""
    if not user or projects.of(user) != TARGET_PROJECT:
        raise ResaleError("Недоступно", 404)
    if not user.get("telegram_id"):
        raise ResaleError("Войдите через Telegram — перенос привязан к Telegram-аккаунту", 403)
    if user.get("is_banned"):
        raise ResaleError("Аккаунт заблокирован", 403)
    ensure_schema()
    tg = int(user["telegram_id"])
    uid = int(user["id"])
    token = _uuid.uuid4().hex
    with _claim_lock:
        rows = _pending_rows(tg)
        if not rows:
            done = db.fetchone(
                "SELECT u.*, m.old_name FROM resale_migration_users u JOIN resale_migrations m ON m.id = u.migration_id "
                "WHERE u.telegram_id = ? AND u.status IN ('claimed', 'claiming') AND m.target_project = ? "
                "ORDER BY u.claimed_at DESC LIMIT 1", (tg, TARGET_PROJECT))
            if done:
                # уже заменён (двойное нажатие, вторая вкладка) — не ошибка
                return {"success": True, "already": True, "name": done["old_name"], "target": target_name(),
                        "days": int(int(done["grant_seconds"]) // DAY), "expires_at": done.get("granted_until")}
            raise ResaleError("Переносить нечего", 404)
        ids = [int(r["id"]) for r in rows]
        marks = ",".join("?" * len(ids))
        # несколько переносов на один Telegram ID — всего не больше 30 дней (в том числе с прошлыми выдачами)
        left = MAX_GRANT_SECONDS - _granted_totals(tg).get(tg, 0)
        seconds = max(0, min(MAX_GRANT_SECONDS, left, max(int(r["grant_seconds"]) for r in rows)))
        # что продлеваем и какой там срок сейчас — чтобы после рестарта посреди выдачи понять, успела ли она
        with projects.use(TARGET_PROJECT):
            target, _trial = fulfillment.find_extend_target(uid, "extend", None)
        if target is not None:
            sub_id, prev = int(target["id"]), "exp:" + str(target.get("expires_at") or "")
        else:
            mx = db.fetchone("SELECT COALESCE(MAX(id), 0) AS m FROM subscriptions WHERE user_id = ?", (uid,))
            sub_id, prev = None, f"new:{int((mx or {}).get('m') or 0)}"
        cur = db.execute(
            f"UPDATE resale_migration_users SET status = 'claiming', claim_token = ?, claimed_user_id = ?, claimed_at = ?, "
            f"granted_seconds = ?, claim_sub_id = ?, claim_prev_exp = ? WHERE id IN ({marks}) AND status = 'pending'",
            (token, uid, _iso(_now()), seconds, sub_id, prev, *ids))
        if cur.rowcount != len(ids):
            # кто-то успел раньше: вернуть своё и попросить повторить
            _release_claim(token)
            raise ResaleError("Повторите через пару секунд", 409)
    if seconds < 60:
        # потолок 30 дней уже выбран прошлыми переносами — выдавать нечего, окно больше не показываем
        db.execute("UPDATE resale_migration_users SET status = 'claimed', granted_seconds = 0, claimed_at = ? "
                   "WHERE claim_token = ? AND status = 'claiming'", (_iso(_now()), token))
        return {"success": True, "already": True, "name": rows[0]["old_name"], "target": target_name(),
                "days": 0, "expires_at": target.get("expires_at") if target else None, "mode": "cap"}
    try:
        with projects.use(TARGET_PROJECT):
            res = grant_seconds(user, seconds)
    except BaseException as exc:
        _release_claim(token)
        if isinstance(exc, ResaleError):
            raise
        raise ResaleError("Не удалось перенести подписку, попробуйте ещё раз через минуту", 502) from exc
    until = res.get("expires_at")
    try:
        db.execute("UPDATE resale_migration_users SET status = 'claimed', granted_until = ?, claimed_at = ? "
                   "WHERE claim_token = ? AND status = 'claiming'", (until, _iso(_now()), token))
    except Exception as exc:  # noqa: BLE001 — срок уже выдан: остаётся «claiming», при рестарте восстановится
        print(f"[resale] user {uid}: срок выдан, но отметка не записалась: {exc}", flush=True)
    print(f"[resale] user {uid} (tg {tg}): +{seconds // 3600} ч из переноса «{rows[0]['old_name']}», "
          f"{res.get('mode')}, до {until}", flush=True)
    return {"success": True, "already": False, "name": rows[0]["old_name"], "target": target_name(),
            "days": int(seconds // DAY), "expires_at": until, "mode": res.get("mode")}
