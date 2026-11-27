# API v1 для мобильного приложения: то, чего нет у мини-приложения.
#   • настройки «Приложение (API)» проекта (панель → Настройки): вкл/выкл, ключ приложения, возврат после оплаты…
#   • ключи приложения (X-App-Key): выдаются в панели, в БД — только sha-256, показываются один раз
#   • одноразовые билеты входа (вход по почте → session_token → POST /auth/token)
#   • устройства (HWID): приложение шлёт X-HWID, сервер сам регистрирует устройство в Remnawave
#     и следит за лимитом; знает, чьё устройство (владелец семьи или гость)
#   • config — ключи подключения (vless://…) из Remnawave, кеш
#   • network_stats — дни с VPN по типу сети (из телеметрии)
from __future__ import annotations

import hashlib
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

try:
    from . import database as db  # type: ignore
except ImportError:  # pragma: no cover
    import database as db  # type: ignore

projects = db.projects

# ── схема ──

SCHEMA = """
CREATE TABLE IF NOT EXISTS app_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,            -- sha-256 ключа; сам ключ не хранится
    prefix TEXT NOT NULL,                     -- первые символы — чтобы узнать ключ в списке
    created_at TEXT NOT NULL,
    created_by TEXT,
    last_used_at TEXT,
    revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_keys_project ON app_keys(project_id, revoked_at);

-- билет входа по почте для приложения: одноразовый, 10 минут, только хеш
CREATE TABLE IF NOT EXISTS app_login_tickets (
    ticket_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    used_at REAL
);

-- устройства, которые зарегистрировало приложение: чей это HWID в подписке владельца
CREATE TABLE IF NOT EXISTS app_devices (
    owner_user_id INTEGER NOT NULL,           -- чья подписка (владелец семьи или сам пользователь)
    hwid TEXT NOT NULL,
    user_id INTEGER NOT NULL,                 -- кто пользуется устройством (гость семьи или владелец)
    platform TEXT,
    os_version TEXT,
    model TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (owner_user_id, hwid)
);
CREATE INDEX IF NOT EXISTS idx_app_devices_user ON app_devices(user_id);

-- дни с включённым VPN по типу сети (телеметрия): для network_stats
CREATE TABLE IF NOT EXISTS vpn_network_days (
    user_id INTEGER NOT NULL,
    day TEXT NOT NULL,                        -- YYYY-MM-DD (UTC)
    network TEXT NOT NULL,                    -- wifi | lte
    PRIMARY KEY (user_id, day, network)
);
"""

_ready = False
_lock = threading.Lock()


def ensure_schema() -> None:
    global _ready
    if _ready:
        return
    with _lock:
        if _ready:
            return
        conn = db.connect()
        conn.executescript(SCHEMA)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(api_sessions)").fetchall()}
        if cols and "app_key_id" not in cols:
            # сессия помнит, каким ключом приложения её выдали (отзыв ключа может завершить его сессии)
            conn.execute("ALTER TABLE api_sessions ADD COLUMN app_key_id INTEGER")
        conn.commit()
        _ready = True


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime] = None) -> str:
    return (dt or _now()).replace(microsecond=0).isoformat()


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


# ═════════════════ настройки проекта «Приложение (API)» ═════════════════

S_ENABLED = "app_api_enabled"             # "0" — API v1 проекта выключено (по умолчанию включено)
S_KEY_REQUIRED = "app_key_required"       # "1" — без действующего X-App-Key запросы не принимаются
S_RETURN_URL = "app_payment_return_url"   # куда ЮKassa вернёт после оплаты из приложения
S_INVITE_URL = "app_invite_url"           # шаблон ссылки-приглашения в семью ({code})
S_WHITELIST = "app_whitelist_included"    # "1" — в платной подписке есть обход белых списков
SETTING_KEYS = (S_ENABLED, S_KEY_REQUIRED, S_RETURN_URL, S_INVITE_URL, S_WHITELIST)

# deep link приложения (fgn://…) или https; javascript:/data:/file: и т.п. — нельзя
_URL_RE = re.compile(r"^(https://[^\s<>\"']{3,300}|[a-z][a-z0-9+.\-]{1,30}://[^\s<>\"']{0,300})$", re.I)
_BAD_SCHEMES = ("javascript", "data", "file", "vbscript", "about", "blob", "http")


def _get(key: str, default: str = "", project: Optional[str] = None) -> str:
    return (db.get_setting(key, default, project=project) or default).strip()


def api_enabled(project: Optional[str] = None) -> bool:
    return _get(S_ENABLED, "1", project) != "0"


def key_required(project: Optional[str] = None) -> bool:
    return _get(S_KEY_REQUIRED, "0", project) == "1"


def whitelist_included(project: Optional[str] = None) -> bool:
    return _get(S_WHITELIST, "0", project) == "1"


def valid_url(url: str) -> bool:
    url = (url or "").strip()
    if not url:
        return True
    if not _URL_RE.match(url):
        return False
    return url.split(":", 1)[0].lower() not in _BAD_SCHEMES


def return_url_template(project: Optional[str] = None) -> str:
    u = _get(S_RETURN_URL, "", project)
    return u if u and valid_url(u) else ""


def invite_link(code: str, project: Optional[str] = None) -> Optional[str]:
    tpl = _get(S_INVITE_URL, "", project)
    if tpl and valid_url(tpl):
        return tpl.replace("{code}", code)
    p = projects.get(project) if project else projects.current()
    base = (p.site_url or p.miniapp_url or "").rstrip("/")
    return f"{base}/family?code={code}" if base else None


def settings_view(project: Optional[str] = None) -> dict[str, Any]:
    return {
        "enabled": api_enabled(project),
        "key_required": key_required(project),
        "return_url": _get(S_RETURN_URL, "", project),
        "invite_url": _get(S_INVITE_URL, "", project),
        "whitelist_included": whitelist_included(project),
    }


# ═════════════════ ключи приложения (X-App-Key) ═════════════════

KEY_PREFIX = "fak_"     # «app key»: видно в логах/коде, что это за строка
MAX_KEYS = 10
_used_cache: dict[int, float] = {}


def create_key(name: str, actor: str = "", project: Optional[str] = None) -> dict[str, Any]:
    ensure_schema()
    pid = project or db.pid()
    name = re.sub(r"\s+", " ", str(name or "")).strip()[:60] or "Приложение"
    live = db.fetchone("SELECT COUNT(*) AS c FROM app_keys WHERE project_id = ? AND revoked_at IS NULL", (pid,))
    if int((live or {}).get("c") or 0) >= MAX_KEYS:
        raise ValueError(f"Не больше {MAX_KEYS} действующих ключей — отзовите ненужные")
    raw = KEY_PREFIX + secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO app_keys (project_id, name, key_hash, prefix, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)",
        (pid, name, _sha(raw), raw[:10], _iso(), (actor or "")[:60]),
    )
    kid = int(db.last_id())
    return {"id": kid, "name": name, "key": raw, "prefix": raw[:10]}


def list_keys(project: Optional[str] = None) -> list[dict[str, Any]]:
    ensure_schema()
    rows = db.fetchall("SELECT id, name, prefix, created_at, created_by, last_used_at, revoked_at FROM app_keys "
                       "WHERE project_id = ? ORDER BY revoked_at IS NOT NULL, id DESC LIMIT 50", (project or db.pid(),))
    for r in rows:
        r["sessions"] = int((db.fetchone(
            "SELECT COUNT(*) AS c FROM api_sessions WHERE app_key_id = ? AND revoked_at IS NULL AND expires_at > ?",
            (int(r["id"]), time.time())) or {}).get("c") or 0)
    return rows


def active_keys_count(project: Optional[str] = None) -> int:
    ensure_schema()
    row = db.fetchone("SELECT COUNT(*) AS c FROM app_keys WHERE project_id = ? AND revoked_at IS NULL",
                      (project or db.pid(),))
    return int((row or {}).get("c") or 0)


def revoke_key(key_id: int, revoke_sessions: bool, project: Optional[str] = None) -> dict[str, Any]:
    ensure_schema()
    pid = project or db.pid()
    row = db.fetchone("SELECT * FROM app_keys WHERE id = ? AND project_id = ?", (int(key_id), pid))
    if not row:
        raise LookupError("Ключ не найден")
    db.execute("UPDATE app_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?", (_iso(), int(key_id)))
    n = 0
    if revoke_sessions:
        cur = db.execute("UPDATE api_sessions SET revoked_at = ?, revoke_reason = 'app_key_revoked' "
                         "WHERE app_key_id = ? AND revoked_at IS NULL", (time.time(), int(key_id)))
        n = int(cur.rowcount or 0)
    return {"revoked": True, "sessions_revoked": n}


def check_key(raw: Optional[str], project: Optional[str] = None) -> Optional[int]:
    """id действующего ключа проекта или None."""
    raw = (raw or "").strip()
    if not raw or len(raw) > 128 or not raw.startswith(KEY_PREFIX):
        return None
    ensure_schema()
    row = db.fetchone("SELECT id, project_id, revoked_at FROM app_keys WHERE key_hash = ?", (_sha(raw),))
    if not row or row.get("revoked_at") or str(row["project_id"]) != (project or db.pid()):
        return None
    kid = int(row["id"])
    now = time.time()
    if now - _used_cache.get(kid, 0) > 300:  # «последнее использование» — не чаще раза в 5 минут
        _used_cache[kid] = now
        db.execute("UPDATE app_keys SET last_used_at = ? WHERE id = ?", (_iso(), kid))
    return kid


def sessions_count(project: Optional[str] = None) -> int:
    ensure_schema()
    row = db.fetchone(
        "SELECT COUNT(*) AS c FROM api_sessions s JOIN users u ON u.id = s.user_id "
        "WHERE u.project_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?", (project or db.pid(), time.time()))
    return int((row or {}).get("c") or 0)


def revoke_project_sessions(project: Optional[str] = None) -> int:
    ensure_schema()
    cur = db.execute(
        "UPDATE api_sessions SET revoked_at = ?, revoke_reason = 'panel_revoke_all' WHERE revoked_at IS NULL "
        "AND user_id IN (SELECT id FROM users WHERE project_id = ?)", (time.time(), project or db.pid()))
    return int(cur.rowcount or 0)


# ═════════════════ билет входа по почте ═════════════════

TICKET_PREFIX = "lt_"
TICKET_TTL = 600


def create_login_ticket(user_id: int) -> str:
    ensure_schema()
    raw = TICKET_PREFIX + secrets.token_urlsafe(32)
    now = time.time()
    db.execute("INSERT INTO app_login_tickets (ticket_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
               (_sha(raw), int(user_id), now, now + TICKET_TTL))
    db.execute("DELETE FROM app_login_tickets WHERE expires_at < ?", (now - 86400,))
    return raw


def use_login_ticket(raw: str) -> Optional[int]:
    """user_id, если билет живой; билет тратится (второй раз не сработает)."""
    raw = (raw or "").strip()
    if not raw.startswith(TICKET_PREFIX) or len(raw) > 128:
        return None
    ensure_schema()
    now = time.time()
    with db.transaction() as conn:
        row = conn.execute("SELECT * FROM app_login_tickets WHERE ticket_hash = ?", (_sha(raw),)).fetchone()
        if not row or row["used_at"] or float(row["expires_at"]) < now:
            return None
        cur = conn.execute("UPDATE app_login_tickets SET used_at = ? WHERE ticket_hash = ? AND used_at IS NULL",
                           (now, _sha(raw)))
        if cur.rowcount != 1:
            return None
        return int(row["user_id"])


# ═════════════════ устройства (HWID) ═════════════════

HWID_RE = re.compile(r"^[A-Za-z0-9._:\-]{8,128}$")


class DeviceError(Exception):
    def __init__(self, code: str, message: str, status: int = 403):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def clean_hwid(raw: Optional[str]) -> Optional[str]:
    v = (raw or "").strip()
    return v if HWID_RE.match(v) else None


def _clean_meta(v: Optional[str], n: int = 64) -> Optional[str]:
    v = re.sub(r"[\x00-\x1f<>]", "", str(v or "")).strip()[:n]
    return v or None


def rw_devices(client: Any, rw_id: int) -> list[dict[str, Any]]:
    data = client.get_user_hwid_devices(int(rw_id))
    if isinstance(data, dict) and "response" in data:
        data = data["response"]
    items = data.get("devices") if isinstance(data, dict) else data
    return [d for d in (items or []) if isinstance(d, dict) and d.get("hwid")]


def register_device(client: Any, rw_id: int, owner_id: int, user_id: int, hwid: str, limit: int,
                    platform: Optional[str], os_version: Optional[str], model: Optional[str],
                    user_agent: Optional[str]) -> None:
    """устройство в Remnawave + чьё оно. Лимит общий на подписку (владелец + гости семьи)."""
    ensure_schema()
    platform, os_version, model = _clean_meta(platform, 32), _clean_meta(os_version, 32), _clean_meta(model, 64)
    devices = rw_devices(client, rw_id)
    known = any(str(d.get("hwid")) == hwid for d in devices)
    if not known:
        if limit > 0 and len(devices) >= limit:
            raise DeviceError("hwid_limit_reached", "Достигнут лимит устройств — отвяжите одно из устройств "
                                                    "или докупите слот", 403)
        body: dict[str, Any] = {"userId": int(rw_id), "hwid": hwid}
        if platform:
            body["platform"] = platform
        if os_version:
            body["osVersion"] = os_version
        if model:
            body["deviceModel"] = model
        if user_agent:
            body["userAgent"] = _clean_meta(user_agent, 200)
        client.create_hwid_device(body)
    ts = _iso()
    # устройство уже чьё-то в этой подписке — переписываем на того, кто им сейчас пользуется
    db.execute(
        "INSERT INTO app_devices (owner_user_id, hwid, user_id, platform, os_version, model, created_at, last_seen_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_user_id, hwid) DO UPDATE SET user_id = excluded.user_id, "
        "platform = COALESCE(excluded.platform, app_devices.platform), "
        "os_version = COALESCE(excluded.os_version, app_devices.os_version), "
        "model = COALESCE(excluded.model, app_devices.model), last_seen_at = excluded.last_seen_at",
        (int(owner_id), hwid, int(user_id), platform, os_version, model, ts, ts),
    )


def device_owners(owner_id: int) -> dict[str, int]:
    ensure_schema()
    return {str(r["hwid"]): int(r["user_id"])
            for r in db.fetchall("SELECT hwid, user_id FROM app_devices WHERE owner_user_id = ?", (int(owner_id),))}


def forget_device(owner_id: int, hwid: str) -> None:
    ensure_schema()
    db.execute("DELETE FROM app_devices WHERE owner_user_id = ? AND hwid = ?", (int(owner_id), hwid))


def forget_owner_devices(owner_id: int) -> None:
    ensure_schema()
    db.execute("DELETE FROM app_devices WHERE owner_user_id = ?", (int(owner_id),))


def device_view(d: dict[str, Any], owners: dict[str, int], fallback_user: int) -> dict[str, Any]:
    hwid = str(d.get("hwid"))
    platform = d.get("platform")
    model = d.get("deviceModel") or d.get("device_model")
    name = " · ".join(str(x) for x in (model, d.get("osVersion") or d.get("os_version")) if x) or platform or "Устройство"
    return {
        "id": hwid,
        "name": name,
        "platform": platform,
        "last_seen_at": d.get("updatedAt") or d.get("updated_at") or d.get("createdAt") or d.get("created_at"),
        "user_id": owners.get(hwid, fallback_user),
    }


# ═════════════════ config: ключи подключения ═════════════════

CONFIG_TTL = 120
_cfg_cache: dict[str, tuple[float, str]] = {}
_cfg_lock = threading.Lock()


def fetch_config(client: Any, short_uuid: str) -> Optional[str]:
    """vless://… (по строке на сервер) из Remnawave; кеш 2 мин. None — не удалось."""
    if not short_uuid:
        return None
    now = time.time()
    with _cfg_lock:
        hit = _cfg_cache.get(short_uuid)
        if hit and now - hit[0] < CONFIG_TTL:
            return hit[1]
    data = client.get_public_subscription_info(short_uuid)
    if isinstance(data, dict) and "response" in data:
        data = data["response"]
    links = data.get("links") if isinstance(data, dict) else None
    if not isinstance(links, list):
        return None
    lines = [str(x).strip() for x in links if isinstance(x, str) and "://" in x]
    if not lines:
        return None
    cfg = "\n".join(lines)
    with _cfg_lock:
        if len(_cfg_cache) > 5000:
            _cfg_cache.clear()
        _cfg_cache[short_uuid] = (now, cfg)
    return cfg


def drop_config_cache(short_uuid: Optional[str] = None) -> None:
    with _cfg_lock:
        if short_uuid:
            _cfg_cache.pop(short_uuid, None)
        else:
            _cfg_cache.clear()


# ═════════════════ телеметрия: тип сети ═════════════════

NETWORKS = {"wifi": "wifi", "wi-fi": "wifi", "ethernet": "wifi", "lte": "lte", "cellular": "lte", "mobile": "lte",
            "5g": "lte", "4g": "lte", "3g": "lte", "2g": "lte"}
STATS_DAYS = 30


def record_network(user_id: int, network: Optional[str]) -> None:
    net = NETWORKS.get(str(network or "").strip().lower())
    if not net:
        return
    ensure_schema()
    db.execute("INSERT OR IGNORE INTO vpn_network_days (user_id, day, network) VALUES (?, ?, ?)",
               (int(user_id), _now().strftime("%Y-%m-%d"), net))


def network_stats(user_ids: list[int]) -> dict[str, int]:
    """дни (за последние 30) с VPN через мобильную сеть / Wi-Fi."""
    ensure_schema()
    if not user_ids:
        return {"lte_days": 0, "wifi_days": 0, "period_days": STATS_DAYS}
    since = (_now() - timedelta(days=STATS_DAYS - 1)).strftime("%Y-%m-%d")
    marks = ",".join("?" * len(user_ids))
    rows = db.fetchall(f"SELECT network, COUNT(DISTINCT day) AS c FROM vpn_network_days "
                       f"WHERE user_id IN ({marks}) AND day >= ? GROUP BY network", (*[int(u) for u in user_ids], since))
    got = {str(r["network"]): int(r["c"]) for r in rows}
    return {"lte_days": got.get("lte", 0), "wifi_days": got.get("wifi", 0), "period_days": STATS_DAYS}

