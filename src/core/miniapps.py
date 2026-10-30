# Серверы мини-приложений проектов (listvpn).
#
# install.sh ставит только панель (главный сервер: API, бот, БД, панель). Мини-приложение каждого проекта
# ставится из панели на свой сервер со своим доменом:
#   панель (IP + домен) → одноразовая команда `curl -fsSL https://<панель>/m/<код> | sudo bash` (30 мин)
#   → на сервере агент (miniapp_agent.py, systemd) регистрируется и опрашивает панель (/api/agent/poll)
#   → задача install: Caddy, сертификат LE, статика мини-приложения, прокси /api и вебхуков ЮKassa на главный
#     сервер (заголовок X-Miniapp-Gateway — общий секрет MINIAPP_GATEWAY_SECRET), DKIM, проверка.
# Письма проекта уходят с его сервера и домена (no-reply@<домен>): главный подписывает DKIM, агент доставляет на MX.
# Или на сервер панели (MINIAPP_SERVER = "local"): без агента — в Caddy панели общий сайт `https://` с on-demand TLS
# (install.sh), сертификат выпускается, только если /api/internal/miniapp/ask узнал домен; проект статике — из
# /api/internal/miniapp/route (forward_auth → X-Project), API узнаёт проект по домену сам. Почта — напрямую с панели.
# Состояние проекта — в настройках панели (projects.PANEL_CONFIG): MINIAPP_DOMAIN / MINIAPP_URL / SITE_DOMAIN /
# MINIAPP_SERVER / PROJECT_ACTIVE.
from __future__ import annotations

import asyncio
import hashlib
import hmac
import io
import ipaddress
import json
import os
import re
import secrets
import socket
import tarfile
import threading
import time
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field, field_validator

try:
    from . import database as db  # type: ignore
    from . import projects  # type: ignore
except ImportError:  # pragma: no cover
    import database as db  # type: ignore
    import projects  # type: ignore

AGENT_VERSION = "1.1"  # = VERSION в miniapp_agent.py; другая у агента → он сам скачает новую
CODE_TTL = 30 * 60
ONLINE_SEC = 75           # агент опрашивает панель каждые ≤25 с
POLL_HOLD = 25.0          # long-poll
INSTALL_STUCK = 25 * 60   # задача установки без ответа — ошибка
AGENT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "miniapp_agent.py")

# шаги установки: ключ, подпись, процент круга
STEPS: list[tuple[str, str, int]] = [
    ("connect", "Панель подключилась к серверу", 6),
    ("domain", "Получен домен", 12),
    ("caddy", "Установка Caddy", 30),
    ("cert", "Выпуск сертификата Let’s Encrypt", 55),
    ("bundle", "Загрузка мини-приложения", 74),
    ("dkim", "Настройка почты: DKIM-ключ для домена", 88),
    ("check", "Проверка https://", 100),
]
STEP_KEYS = [s[0] for s in STEPS]

_DOMAIN_RE = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$")
_schema_lock = threading.Lock()
_schema_ok = False


# ───────────────────────── схема ─────────────────────────

def ensure() -> None:
    global _schema_ok
    if _schema_ok:
        return
    with _schema_lock:
        if _schema_ok:
            return
        conn = db.connect()
        conn.executescript("""
CREATE TABLE IF NOT EXISTS miniapp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL UNIQUE,
    token_hash TEXT,
    code_hash TEXT,
    code_expires REAL,
    hostname TEXT,
    os TEXT,
    agent_version TEXT,
    caddy TEXT,
    created_at REAL,
    connected_at REAL,
    last_seen REAL
);
CREATE TABLE IF NOT EXISTS miniapp_installs (
    project_id TEXT PRIMARY KEY,
    server_id INTEGER,
    domain TEXT,
    site_domain TEXT,
    state TEXT,
    step TEXT,
    label TEXT,
    error TEXT,
    fresh INTEGER DEFAULT 1,
    task_id INTEGER,
    created_at REAL,
    updated_at REAL,
    done_at REAL
);
CREATE TABLE IF NOT EXISTS miniapp_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT,
    state TEXT NOT NULL DEFAULT 'new',
    result TEXT,
    created_at REAL,
    taken_at REAL,
    done_at REAL
);
CREATE INDEX IF NOT EXISTS ix_miniapp_tasks_srv ON miniapp_tasks(server_id, state);
""")
        conn.commit()
        _schema_ok = True


def _now() -> float:
    return time.time()


def _sha(v: str) -> str:
    return hashlib.sha256(v.encode()).hexdigest()


def norm_domain(v: Any) -> str:
    s = re.sub(r"^[a-z]+://", "", str(v or "").strip().lower()).split("/", 1)[0].split(":", 1)[0].rstrip(".")
    return s if _DOMAIN_RE.match(s) else ""


def norm_ip(v: Any) -> str:
    try:
        ip = ipaddress.ip_address(str(v or "").strip())
    except ValueError:
        return ""
    if ip.version != 4 or ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_multicast or ip.is_link_local:
        return ""
    return str(ip)


# ───────────────────────── главный сервер ─────────────────────────

def panel_url() -> str:
    return (os.getenv("PANEL_URL") or "").strip().rstrip("/")


def panel_host() -> str:
    return (urlparse(panel_url()).hostname or "").lower()


def gateway_secret() -> str:
    return (os.getenv("MINIAPP_GATEWAY_SECRET") or "").strip()


LOCAL = "local"  # MINIAPP_SERVER проекта, чьё мини-приложение стоит на сервере панели (в miniapp_installs — server_id 0)
_pip: dict[str, Any] = {"ip": "", "at": 0.0}


def _sid_cfg(sid: Any) -> str:
    """server_id установки → значение MINIAPP_SERVER."""
    try:
        return LOCAL if int(sid or 0) == 0 else str(int(sid))
    except (TypeError, ValueError):
        return str(sid)


def https_port() -> int:
    try:
        return int(os.getenv("HTTPS_PORT") or 443)
    except ValueError:
        return 443


def _no_proxy_open(url: str, timeout: float):
    import urllib.request
    return urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url, timeout=timeout)


def panel_ip() -> str:
    """публичный IPv4 сервера панели (SERVER_IP из .env, иначе спрашиваем снаружи; кэш на час)."""
    ip = norm_ip(os.getenv("SERVER_IP"))
    if ip:
        return ip
    if _pip["ip"] and _now() - _pip["at"] < 3600:
        return _pip["ip"]
    import urllib.request
    for url in ("https://api.ipify.org", "https://ipv4.icanhazip.com"):
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                ip = norm_ip(resp.read(64).decode(errors="ignore").strip())
        except Exception:  # noqa: BLE001
            ip = ""
        if ip:
            break
    if not ip:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as so:
                so.connect(("1.1.1.1", 53))
                ip = norm_ip(so.getsockname()[0])
        except OSError:
            ip = ""
    if ip:
        _pip.update(ip=ip, at=_now())
    return ip


def local_caddy_ready() -> Optional[bool]:
    """есть ли в Caddy панели общий сайт для мини-приложений (on-demand TLS от install.sh). None — не узнать."""
    try:
        with _no_proxy_open("http://127.0.0.1:2019/config/apps/tls/automation/on_demand", 3) as resp:
            body = resp.read(4096).decode(errors="ignore").strip()
    except Exception:  # noqa: BLE001
        return None
    return body not in ("", "null", "{}")


def _resolve_a(dom: str) -> list[str]:
    try:
        return sorted({i[4][0] for i in socket.getaddrinfo(dom, None, socket.AF_INET)})
    except OSError:
        return []


def _tls_get(dom: str, path: str = "/", timeout: float = 30.0) -> tuple[int, bytes]:
    """HTTPS-запрос к своему Caddy (127.0.0.1) с SNI домена — без «шпильки» через внешний IP. Сертификат проверяется."""
    import ssl
    ctx = ssl.create_default_context()
    with socket.create_connection(("127.0.0.1", https_port()), timeout=timeout) as raw:
        with ctx.wrap_socket(raw, server_hostname=dom) as s:
            s.sendall(f"GET {path} HTTP/1.1\r\nHost: {dom}\r\nUser-Agent: blin-panel\r\nConnection: close\r\n\r\n".encode())
            data = b""
            while len(data) < 262144:
                chunk = s.recv(16384)
                if not chunk:
                    break
                data += chunk
    head, _, body = data.partition(b"\r\n\r\n")
    try:
        code = int(head.split(b" ", 2)[1])
    except (IndexError, ValueError):
        code = 0
    return code, body


def _data_dir() -> str:
    return os.path.dirname(os.path.abspath(os.getenv("DB_PATH") or "data/data.db"))


def bundle_dir(pid: str) -> str:
    """сборка мини-приложения проекта: контейнер miniapp выкладывает её в data/miniapp-dist/<id>/."""
    return os.path.join(_data_dir(), "miniapp-dist", pid)


def bundle_hash(pid: str) -> str:
    root = bundle_dir(pid)
    if not os.path.isfile(os.path.join(root, "index.html")):
        return ""
    h = hashlib.sha256()
    for base, dirs, files in os.walk(root):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(base, f)
            try:
                st = os.stat(p)
            except OSError:
                continue
            h.update(f"{os.path.relpath(p, root)}|{st.st_size}|{int(st.st_mtime)}\n".encode())
    return h.hexdigest()[:24]


def bundle_tar(pid: str) -> bytes:
    root = bundle_dir(pid)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", compresslevel=6) as tar:
        for base, dirs, files in os.walk(root):
            dirs.sort()
            for f in sorted(files):
                p = os.path.join(base, f)
                if os.path.islink(p):
                    continue
                tar.add(p, arcname=os.path.relpath(p, root), recursive=False)
    return buf.getvalue()


# ───────────────────────── серверы и задачи ─────────────────────────

def server(sid: Any) -> Optional[dict[str, Any]]:
    ensure()
    try:
        return db.fetchone("SELECT * FROM miniapp_servers WHERE id = ?", (int(sid),))
    except (TypeError, ValueError):
        return None


def server_online(s: Optional[dict[str, Any]]) -> bool:
    return bool(s and s.get("token_hash") and (s.get("last_seen") or 0) > _now() - ONLINE_SEC)


def server_projects(sid: int) -> list[str]:
    out = []
    for p in projects.all_projects():
        cfg = projects.panel_config(p.id)
        if cfg.get("MINIAPP_SERVER") == str(sid):
            out.append(p.id)
    return out


def add_task(sid: int, kind: str, payload: dict[str, Any]) -> int:
    ensure()
    cur = db.execute("INSERT INTO miniapp_tasks (server_id, kind, payload, state, created_at) VALUES (?, ?, ?, 'new', ?)",
                     (sid, kind, json.dumps(payload, ensure_ascii=False), _now()))
    return int(cur.lastrowid)


def _task(tid: int) -> Optional[dict[str, Any]]:
    return db.fetchone("SELECT * FROM miniapp_tasks WHERE id = ?", (tid,))


def _cleanup() -> None:
    """старые задачи и просроченные команды неподключённых серверов."""
    now = _now()
    db.execute("DELETE FROM miniapp_tasks WHERE created_at < ? AND state IN ('done', 'error')", (now - 7 * 86400,))
    db.execute("UPDATE miniapp_tasks SET state = 'error', result = ? WHERE kind IN ('mail', 'port25') AND state IN ('new', 'taken') "
               "AND created_at < ?", (json.dumps({"ok": False, "error": "агент не ответил"}), now - 120))


# ───────────────────────── установка ─────────────────────────

def install_row(pid: str) -> Optional[dict[str, Any]]:
    ensure()
    return db.fetchone("SELECT * FROM miniapp_installs WHERE project_id = ?", (pid,))


def _install_update(pid: str, **kw: Any) -> None:
    kw["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in kw)
    db.execute(f"UPDATE miniapp_installs SET {cols} WHERE project_id = ?", (*kw.values(), pid))


def _install_payload(pid: str, row: dict[str, Any]) -> dict[str, Any]:
    return {
        "project": pid, "name": projects.get(pid).name,
        "domain": row["domain"], "site_domain": row.get("site_domain") or "",
        "panel_url": panel_url(), "panel_host": panel_host(), "gateway": gateway_secret(),
        "bundle": bundle_hash(pid),
    }


def _start_install_task(pid: str) -> None:
    row = install_row(pid)
    if not row:
        return
    if int(row["server_id"] or 0) == 0:
        _start_local(pid)
        return
    tid = add_task(int(row["server_id"]), "install", _install_payload(pid, row))
    _install_update(pid, state="installing", step="connect", label=STEPS[0][1], error="", task_id=tid)


def domain_owner(domain: str, except_pid: str = "") -> Optional[str]:
    """какой проект уже занял домен."""
    for p in projects.all_projects():
        if p.id == except_pid:
            continue
        if domain in p.hosts:
            return p.id
        row = install_row(p.id)
        if row and row.get("state") in ("waiting", "installing") and domain in (row.get("domain"), row.get("site_domain")):
            return p.id
    if domain == panel_host():
        return "panel"
    return None


class SetupError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def start_install(pid: str, *, ip: str = "", server_id: Optional[int] = None, domain: str, site_domain: str = "",
                  local: bool = False) -> dict[str, Any]:
    """новая установка / перенос мини-приложения проекта (local — на сервер панели). Возвращает {"code": …} для нового сервера."""
    ensure()
    if not projects.exists(pid):
        raise SetupError("Нет такого проекта", 404)
    if not local and not panel_url():
        raise SetupError("В .env главного сервера нет PANEL_URL — запустите install.sh → обновление")
    if not local and not gateway_secret():
        raise SetupError("В .env главного сервера нет MINIAPP_GATEWAY_SECRET — запустите install.sh → обновление")
    dom = norm_domain(domain)
    if not dom:
        raise SetupError("Похоже на опечатку в домене")
    site = norm_domain(site_domain) if site_domain else ""
    if site_domain and not site:
        raise SetupError("Похоже на опечатку в домене сайта")
    if site == dom:
        site = ""
    for d in (dom, site):
        if not d:
            continue
        owner = domain_owner(d, pid)
        if owner == "panel":
            raise SetupError("Это домен панели — мини-приложению нужен свой")
        if owner:
            raise SetupError(f"Домен {d} уже занят проектом {projects.get(owner).name}")
    cur = install_row(pid)
    if cur and cur.get("state") == "installing" and (cur.get("updated_at") or 0) > _now() - INSTALL_STUCK:
        raise SetupError("Установка уже идёт — дождитесь окончания", 409)

    code = ""
    now = _now()
    if local:
        if local_caddy_ready() is False:
            raise SetupError("Caddy панели ещё без общего сайта для мини-приложений — обновите панель: "
                             "sudo bash install.sh → 1, затем повторите")
        sid = 0
    elif server_id:
        srv = server(server_id)
        if not srv or not srv.get("token_hash"):
            raise SetupError("Сервер не найден", 404)
        if not server_online(srv):
            raise SetupError("Сервер не на связи — проверьте, что он включён (служба blin-agent)")
        sid = int(srv["id"])
    else:
        ipn = norm_ip(ip)
        if not ipn:
            raise SetupError("Нужен публичный IPv4-адрес сервера")
        srv = db.fetchone("SELECT * FROM miniapp_servers WHERE ip = ?", (ipn,))
        if srv and srv.get("token_hash") and server_online(srv):
            raise SetupError("Этот сервер уже подключён — выберите его во вкладке «Подключённый сервер»")
        code = "".join(secrets.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(10))
        if srv:
            sid = int(srv["id"])
            db.execute("UPDATE miniapp_servers SET code_hash = ?, code_expires = ? WHERE id = ?",
                       (_sha(code), now + CODE_TTL, sid))
        else:
            c = db.execute("INSERT INTO miniapp_servers (ip, code_hash, code_expires, created_at) VALUES (?, ?, ?, ?)",
                           (ipn, _sha(code), now + CODE_TTL, now))
            sid = int(c.lastrowid)
    fresh = 0 if (local or server_projects(sid)) else 1
    db.execute("INSERT INTO miniapp_installs (project_id, server_id, domain, site_domain, state, step, label, error, fresh, "
               "task_id, created_at, updated_at, done_at) VALUES (?, ?, ?, ?, 'waiting', '', '', '', ?, NULL, ?, ?, NULL) "
               "ON CONFLICT(project_id) DO UPDATE SET server_id = excluded.server_id, domain = excluded.domain, "
               "site_domain = excluded.site_domain, state = 'waiting', step = '', label = '', error = '', "
               "fresh = excluded.fresh, task_id = NULL, created_at = excluded.created_at, updated_at = excluded.updated_at, "
               "done_at = NULL", (pid, sid, dom, site, fresh, now, now))
    if not code:
        _start_install_task(pid)
    out = install_view(pid)
    if code:
        out["code"] = code
        out["command"] = f"curl -fsSL {panel_url()}/m/{code} | sudo bash"
    return out


def cancel_install(pid: str) -> None:
    row = install_row(pid)
    if not row:
        return
    if row.get("state") == "installing" and (row.get("updated_at") or 0) > _now() - INSTALL_STUCK:
        raise SetupError("Установка уже идёт — дождитесь окончания", 409)
    db.execute("DELETE FROM miniapp_installs WHERE project_id = ?", (pid,))
    _forget_unused_pending()


def _forget_unused_pending() -> None:
    """серверы, которые так и не подключились и ни к чему не привязаны."""
    for s in db.fetchall("SELECT id FROM miniapp_servers WHERE token_hash IS NULL"):
        if not db.fetchone("SELECT 1 FROM miniapp_installs WHERE server_id = ?", (s["id"],)):
            db.execute("DELETE FROM miniapp_servers WHERE id = ?", (s["id"],))


def install_view(pid: str) -> Optional[dict[str, Any]]:
    row = install_row(pid)
    if not row:
        return None
    local = int(row["server_id"] or 0) == 0
    srv = {} if local else (server(row["server_id"]) or {})
    state = row.get("state") or ""
    if local and state == "installing" and pid not in _local_running:
        state = "error"
        _install_update(pid, state="error", error="Установка прервалась (панель перезапустилась) — нажмите «Повторить»")
        row = install_row(pid) or row
    if state == "installing" and (row.get("updated_at") or 0) < _now() - INSTALL_STUCK:
        state = "error"
        _install_update(pid, state="error", error="Сервер перестал отвечать во время установки")
        row = install_row(pid) or row
    step = row.get("step") or ""
    idx = STEP_KEYS.index(step) if step in STEP_KEYS else -1
    pct = STEPS[idx][2] if idx >= 0 else 0
    if state == "done":
        pct = 100
    expires = 0
    if state == "waiting" and not srv.get("token_hash"):
        expires = max(0, int((srv.get("code_expires") or 0) - _now()))
    labels = []
    for key, label, _p in STEPS:
        if local and key in LOCAL_LABELS:
            label = LOCAL_LABELS[key]
        if key == "domain":
            label = f"Получен домен {row['domain']}"
        elif key == "caddy" and not row.get("fresh") and not local:
            label = "Caddy уже стоит — добавляем сайт"
        elif key == "check":
            label = f"Проверка https://{row['domain']}"
        labels.append({"key": key, "label": label})
    return {
        "project": pid, "state": state, "step": step, "step_index": idx, "pct": pct,
        "label": row.get("label") or "", "error": row.get("error") or "",
        "domain": row["domain"], "site_domain": row.get("site_domain") or "",
        "server_id": row["server_id"], "server_ip": panel_ip() if local else (srv.get("ip") or ""),
        "server_online": local or server_online(srv), "local": local,
        "connected": local or bool(srv.get("token_hash")), "fresh": bool(row.get("fresh")),
        "expires_in": expires, "steps": labels,
        "command": "", "panel_url": panel_url(),
    }


def _finish_install(pid: str, ok: bool, error: str = "") -> None:
    row = install_row(pid)
    if not row:
        return
    if not ok:
        _install_update(pid, state="error", error=(error or "Установка не удалась")[:500])
        return
    old = projects.panel_config(pid, fresh=True)
    old_sid = old.get("MINIAPP_SERVER", "")
    old_dom = old.get("MINIAPP_DOMAIN", "")
    dom = row["domain"]
    new_sid = _sid_cfg(row["server_id"])
    port = https_port() if new_sid == LOCAL else 443
    projects.set_panel_config(pid, {
        "MINIAPP_DOMAIN": dom, "MINIAPP_URL": f"https://{dom}" + (f":{port}" if port != 443 else ""),
        "SITE_DOMAIN": row.get("site_domain") or "", "MINIAPP_SERVER": new_sid,
        "PROJECT_ACTIVE": "1",
    })
    _local_cache["at"] = 0.0
    _install_update(pid, state="done", step="check", label="Готово", error="", done_at=_now())
    # перенос: старый сайт снять после проверки нового (на сервере панели снимать нечего — общий сайт)
    if old_sid and old_sid != new_sid and old_sid != LOCAL:
        try:
            add_task(int(old_sid), "remove", {"project": pid, "domain": old_dom})
        except (TypeError, ValueError):
            pass
    try:
        set_menu_button(pid)
    except Exception as exc:  # noqa: BLE001
        print(f"[miniapps] кнопка мини-приложения {pid}: {exc}", flush=True)


# ───────────────────────── установка на сервер панели ─────────────────────────

LOCAL_LABELS = {
    "connect": "Сервер панели",
    "caddy": "Caddy панели — добавляем сайт",
    "bundle": "Мини-приложение из сборки панели",
}
_local_lock = threading.Lock()
_local_running: set[str] = set()
_local_cache: dict[str, Any] = {"at": 0.0, "map": {}}


def local_domains(fresh: bool = False) -> dict[str, str]:
    """домены мини-приложений на сервере панели → проект (готовые и устанавливаемые)."""
    if not fresh and _now() - _local_cache["at"] < 3:
        return _local_cache["map"]
    ensure()
    out: dict[str, str] = {}
    for p in projects.all_projects():
        cfg = projects.panel_config(p.id, fresh=fresh)
        if cfg.get("MINIAPP_SERVER") == LOCAL:
            for k in ("MINIAPP_DOMAIN", "SITE_DOMAIN"):
                if cfg.get(k):
                    out[cfg[k].lower()] = p.id
    for row in db.fetchall("SELECT project_id, domain, site_domain FROM miniapp_installs WHERE server_id = 0"):
        for d in (row.get("domain"), row.get("site_domain")):
            if d:
                out.setdefault(d.lower(), row["project_id"])
    _local_cache.update(at=_now(), map=out)
    return out


def _start_local(pid: str) -> None:
    with _local_lock:
        if pid in _local_running:
            return
        _local_running.add(pid)
    _local_cache["at"] = 0.0
    _install_update(pid, state="installing", step="connect", label=LOCAL_LABELS["connect"], error="", task_id=None)
    threading.Thread(target=_run_local, args=(pid,), daemon=True, name=f"miniapp-local-{pid}").start()


def _run_local(pid: str) -> None:
    try:
        try:
            err = _local_steps(pid)
        except Exception as exc:  # noqa: BLE001
            err = f"{type(exc).__name__}: {exc}"
        row = install_row(pid)
        if row and int(row["server_id"] or 0) == 0 and row.get("state") == "installing":
            _finish_install(pid, not err, err)
    finally:
        with _local_lock:
            _local_running.discard(pid)


def _wait_cert(dom: str, tries: int = 6) -> str:
    """Caddy выпускает сертификат при первом TLS-рукопожатии (on-demand). '' — сертификат есть."""
    import ssl
    err = ""
    for i in range(tries):
        try:
            _tls_get(dom, "/api/health", timeout=90)
            return ""
        except ssl.SSLCertVerificationError as exc:
            err = f"сертификат не подтверждён ({exc.verify_message or exc})"
        except ssl.SSLError as exc:
            err = f"Caddy не смог выпустить сертификат ({exc.reason or exc})"
        except OSError as exc:
            err = f"Caddy панели не отвечает на 127.0.0.1:{https_port()} ({exc})"
        if i < tries - 1:
            time.sleep(15)
    return err


def _local_steps(pid: str) -> str:
    """шаги установки на сервер панели; '' — успех, иначе текст ошибки."""
    row = install_row(pid)
    if not row:
        return "Установка отменена"
    dom, site = row["domain"], row.get("site_domain") or ""

    def step(key: str, label: str) -> None:
        _install_update(pid, step=key, label=label, state="installing")

    step("domain", f"Получен домен {dom}")
    ip = panel_ip()
    wrong: list[str] = []
    for d in (dom, site):
        if not d:
            continue
        ips = _resolve_a(d)
        if not ips:
            return f"У домена {d} нет A-записи — добавьте её на IP сервера панели {ip}".rstrip()
        if ip and ip not in ips:
            wrong.append(f"{d} → {', '.join(ips)}")

    step("caddy", LOCAL_LABELS["caddy"])
    if local_caddy_ready() is False:
        return "Caddy панели ещё без общего сайта для мини-приложений — обновите панель: sudo bash install.sh → 1"

    step("cert", f"Выпуск сертификата Let’s Encrypt для {dom}")
    for d in (dom, site):
        if not d:
            continue
        err = _wait_cert(d)
        if err:
            hint = f". A-запись: {'; '.join(wrong)}, а IP сервера панели — {ip}" if wrong else \
                ". Проверьте, что порты 80 и 443 открыты"
            return f"Сертификат для {d} не выпустился: {err}{hint}"

    step("bundle", LOCAL_LABELS["bundle"])
    for _ in range(30):
        if bundle_hash(pid):
            break
        time.sleep(2)
    else:
        return "Сборка мини-приложения ещё не готова (контейнер miniapp) — повторите через минуту"

    step("dkim", "Настройка почты: DKIM-ключ для домена")
    try:
        try:
            from . import mailer  # type: ignore
        except ImportError:  # pragma: no cover
            import mailer  # type: ignore
        mailer.ensure_dkim(dom)
    except Exception as exc:  # noqa: BLE001
        print(f"[miniapps] DKIM {dom}: {exc}", flush=True)

    step("check", f"Проверка https://{dom}")
    _local_cache["at"] = 0.0
    for d in (dom, site):
        if not d:
            continue
        code, _b = _tls_get(d, "/")
        if code != 200:
            return f"https://{d} ответил {code or 'непонятно'} — мини-приложение не открылось (контейнер miniapp запущен?)"
        code, body = _tls_get(d, "/api/health")
        if code != 200 or b"blinvpn-api" not in body:
            return f"https://{d}/api/health ответил {code or 'непонятно'} — API недоступен через этот домен"
    return ""


def set_menu_button(pid: str) -> bool:
    """кнопка мини-приложения в боте проекта → https://<домен>."""
    import urllib.request
    p = projects.get(pid)
    tok, url = p.bot_token, p.miniapp_url
    if not tok or not url.startswith("https://"):
        return False
    text = p.bot_text("menu_button", "Открыть") or "Открыть"
    body = json.dumps({"menu_button": {"type": "web_app", "text": text[:64], "web_app": {"url": url}}}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{tok}/setChatMenuButton", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return bool(json.loads(resp.read().decode()).get("ok"))


def admin_ids() -> list[str]:
    return [x for x in (db.get_setting("forum_admin_ids", "") or "").replace(",", " ").split() if x.lstrip("-").isdigit()]


def project_ready(p: Any, pay_methods: Any = None) -> tuple[bool, list[str]]:
    """проект работает: мини-приложение стоит, проект включён, бот, админы, оплата (сквады — нет). → (готов, чего не хватает)."""
    missing: list[str] = []
    cfg = projects.panel_config(p.id)
    installed = bool(cfg.get("MINIAPP_DOMAIN")) or bool(p.miniapp_url)
    if not p.bot_token:
        missing.append("бот")
    if not admin_ids():
        missing.append("админы")
    # сквады необязательны: не выбраны — действуют общие сети
    if pay_methods is not None:
        pm = {m["id"]: m["enabled"] for m in pay_methods}
        if (pm.get("card", True) or pm.get("sbp", True)) and not p.payments_configured:
            missing.append("оплата")
    return (installed and p.active and not missing), missing


def project_server(pid: str) -> Optional[dict[str, Any]]:
    sid = projects.panel_config(pid).get("MINIAPP_SERVER", "")
    return server(sid) if sid else None


# ───────────────────────── почта через агента ─────────────────────────

def mail_route(pid: Optional[str] = None) -> Optional[dict[str, Any]]:
    """письма проекта уходят с его сервера мини-приложения: {"domain", "server_id", "ip"} или None."""
    pid = pid or projects.current_id()
    try:
        cfg = projects.panel_config(pid)
    except Exception:  # noqa: BLE001
        return None
    dom, sid = cfg.get("MINIAPP_DOMAIN", ""), cfg.get("MINIAPP_SERVER", "")
    if not dom or not sid:
        return None
    if sid == LOCAL:  # мини-приложение на сервере панели: письма уходят прямо отсюда
        return {"domain": dom, "server_id": 0, "ip": panel_ip(), "local": True}
    try:
        srv = server(sid)
    except Exception:  # noqa: BLE001
        return None
    if not srv or not srv.get("token_hash"):
        return None
    return {"domain": dom, "server_id": int(srv["id"]), "ip": srv["ip"]}


def mail_dns(pid: Optional[str] = None) -> dict[str, Any]:
    """DNS-записи почты проекта (SPF — IP сервера мини-приложения, DKIM, DMARC) с отметкой «найдена»."""
    route = mail_route(pid)
    if not route:
        return {"records": [], "from": ""}
    try:
        from . import mailer  # type: ignore
    except ImportError:  # pragma: no cover
        import mailer  # type: ignore
    recs = mailer.dns_records(route["domain"], route["ip"])
    # SPF: только сервер мини-приложения (письма уходят с него)
    for rec in recs:
        if rec["host"] == "@":
            rec["value"] = f"v=spf1 ip4:{route['ip']} -all"
        if rec["host"] == "_dmarc":
            rec["value"] = f"v=DMARC1; p=quarantine; rua=mailto:dmarc@{route['domain']}"
    return {"records": [{**x, "name": route["domain"] if x["host"] == "@" else f"{x['host']}.{route['domain']}"} for x in recs],
            "from": f"no-reply@{route['domain']}"}


def port25_open(server_id: int, timeout: float = 25.0) -> Optional[bool]:
    """открыт ли исходящий порт 25 на сервере мини-приложения. None — сервер не ответил (не на связи / старый агент)."""
    if not server_id:  # сервер панели
        try:
            from . import mailer  # type: ignore
        except ImportError:  # pragma: no cover
            import mailer  # type: ignore
        return mailer.port25_open()
    srv = server(server_id)
    if not server_online(srv):
        return None
    tid = add_task(server_id, "port25", {})
    deadline = _now() + timeout
    while _now() < deadline:
        t = _task(tid)
        if t and t["state"] in ("done", "error"):
            res = json.loads(t.get("result") or "{}") if t.get("result") else {}
            return bool(res.get("ok"))
        time.sleep(0.3)
    db.execute("UPDATE miniapp_tasks SET state = 'error' WHERE id = ? AND state IN ('new', 'taken')", (tid,))
    return None


def deliver(server_id: int, *, sender: str, to: str, ehlo: str, mx: list[str], message: bytes,
            timeout: float = 45.0) -> tuple[bool, str]:
    """отправить готовое (подписанное DKIM) письмо с сервера мини-приложения."""
    import base64
    srv = server(server_id)
    if not server_online(srv):
        return False, "Сервер мини-приложения не на связи (служба blin-agent)"
    tid = add_task(server_id, "mail", {"from": sender, "to": to, "ehlo": ehlo, "mx": mx[:6],
                                       "raw": base64.b64encode(message).decode()})
    deadline = _now() + timeout
    while _now() < deadline:
        t = _task(tid)
        if t and t["state"] in ("done", "error"):
            res = json.loads(t.get("result") or "{}") if t.get("result") else {}
            if res.get("ok"):
                return True, ""
            return False, str(res.get("error") or "Агент не смог отправить письмо")
        time.sleep(0.3)
    db.execute("UPDATE miniapp_tasks SET state = 'error' WHERE id = ? AND state IN ('new', 'taken')", (tid,))
    return False, "Сервер мини-приложения не ответил вовремя"


# ───────────────────────── скрипт для сервера ─────────────────────────

def install_script(code: str) -> str:
    """bash для `curl … /m/<код> | sudo bash`: ставит агента, тот подключается к панели."""
    pu = panel_url()
    ok = False
    if re.fullmatch(r"[a-z0-9]{6,16}", code or ""):
        ensure()
        s = db.fetchone("SELECT id FROM miniapp_servers WHERE code_hash = ? AND code_expires > ?", (_sha(code), _now()))
        ok = bool(s)
    if not ok:
        return ("#!/usr/bin/env bash\n"
                "printf '\\033[31m✗ Команда устарела или уже использована — получите новую в панели (Проекты → Установить).\\033[0m\\n' >&2\n"
                "exit 1\n")
    return _SCRIPT.replace("__PANEL__", pu).replace("__CODE__", code)


_SCRIPT = r"""#!/usr/bin/env bash
# listvpn · сервер мини-приложения (скрипт выдала панель, одноразовый)
set -euo pipefail
PANEL="__PANEL__"
CODE="__CODE__"
G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; W=$'\033[1m'; N=$'\033[0m'
ok()   { printf '%s✓%s %s\n' "$G" "$N" "$*"; }
fail() { printf '%s✗ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

printf '\n%slistvpn · сервер мини-приложения%s\n' "$W" "$N"
[ "$(id -u)" -eq 0 ] || fail "Запустите от root: curl -fsSL ${PANEL}/m/${CODE} | sudo bash"
command -v apt-get >/dev/null 2>&1 || fail "Нужен Ubuntu 22.04+ или Debian 12 (apt)."
command -v systemctl >/dev/null 2>&1 || fail "Нужен systemd."
. /etc/os-release 2>/dev/null || true
ok "${PRETTY_NAME:-Linux} · $(nproc 2>/dev/null || echo ?) vCPU · $(free -m 2>/dev/null | awk '/^Mem:/{print $2}') МБ RAM"

export DEBIAN_FRONTEND=noninteractive
need=""
for c in curl python3 openssl ss; do command -v "$c" >/dev/null 2>&1 || need="$need $c"; done
if [ -n "$need" ]; then
    pk="ca-certificates"
    for c in $need; do case "$c" in ss) pk="$pk iproute2" ;; *) pk="$pk $c" ;; esac; done
    apt-get update -qq >/dev/null 2>&1 || true
    apt-get install -y -qq $pk >/dev/null 2>&1 || fail "Не удалось установить:$need"
fi

busy="$(ss -ltnpH 2>/dev/null | awk '$4 ~ /:(80|443)$/' | grep -v '"caddy"' || true)"
if [ -n "$busy" ]; then
    printf '%s\n' "$busy" | sed 's/^/   /' >&2
    fail "Порты 80/443 заняты другой программой — мини-приложению нужен Caddy на этих портах."
fi
ok "Порты 80 и 443 свободны"

install -d -m 755 /opt/blin-agent
install -d -m 700 /var/lib/blin-agent
curl -4 -fsSL --retry 3 "${PANEL}/api/agent/agent.py" -o /opt/blin-agent/agent.py.new || fail "Панель ${PANEL} недоступна с этого сервера."
python3 -c "import ast,sys; ast.parse(open('/opt/blin-agent/agent.py.new').read())" || fail "Агент скачался с ошибкой — повторите команду."
mv -f /opt/blin-agent/agent.py.new /opt/blin-agent/agent.py
chmod 755 /opt/blin-agent/agent.py
python3 /opt/blin-agent/agent.py register "$PANEL" "$CODE"
exec python3 /opt/blin-agent/agent.py watch </dev/null
"""


class RegisterBody(BaseModel):
    code: str = Field(..., max_length=32)
    hostname: str = Field("", max_length=120)
    os: str = Field("", max_length=120)
    version: str = Field("", max_length=20)


class PollBody(BaseModel):
    version: str = Field("", max_length=20)
    caddy: str = Field("", max_length=60)
    hostname: str = Field("", max_length=120)
    bundles: dict[str, str] = Field(default_factory=dict)


class ProgressBody(BaseModel):
    task: int
    step: str = Field(..., max_length=20)
    label: str = Field("", max_length=200)


class ResultBody(BaseModel):
    task: int
    ok: bool
    error: str = Field("", max_length=2000)
    result: dict[str, Any] = Field(default_factory=dict)


class InstallBody(BaseModel):
    project: str = Field(..., max_length=24)
    ip: str = Field("", max_length=45)
    server_id: Optional[int] = None
    local: bool = False
    domain: str = Field(..., max_length=253)
    site_domain: str = Field("", max_length=253)


class SetupProjectBody(BaseModel):
    active: Optional[bool] = None
    bot_token: Optional[str] = Field(None, max_length=200)
    admins: Optional[list[str]] = Field(None, max_length=80)
    squads_vpn: Optional[list[str]] = Field(None, max_length=80)
    squads_trial: Optional[list[str]] = Field(None, max_length=80)
    pay_mode: Optional[str] = None
    yookassa_shop_id: Optional[str] = Field(None, max_length=50)
    yookassa_secret_key: Optional[str] = Field(None, max_length=200)
    channel_id: Optional[str] = Field(None, max_length=200)
    channel_required: Optional[bool] = None

    @field_validator("pay_mode", mode="before")
    @classmethod
    def _pay(cls, v: Any) -> Any:
        if v in (None, ""):
            return None
        s = str(v).strip().lower()
        return s if s in ("yk", "stars") else v

    @field_validator("channel_id", "bot_token", "yookassa_shop_id", "yookassa_secret_key", mode="before")
    @classmethod
    def _txt(cls, v: Any) -> Any:
        if v is None:
            return None
        return str(v).strip()

    @field_validator("admins", "squads_vpn", "squads_trial", mode="before")
    @classmethod
    def _ids(cls, v: Any) -> Any:
        if v is None:
            return None
        out: list[str] = []
        for x in v if isinstance(v, list) else []:
            if isinstance(x, dict):
                x = x.get("uuid") or x.get("id") or ""
            s = str(x).strip()
            if s:
                out.append(s)
        return out

    @field_validator("channel_required", "active", mode="before")
    @classmethod
    def _flag(cls, v: Any) -> Any:
        if v in (1, "1", "true", "True", "yes"):
            return True
        if v in (0, "0", "false", "False", "no"):
            return False
        return v


# ───────────────────────── роутер ─────────────────────────

def build_router(core: Any):
    r = APIRouter()

    def _err(e: SetupError) -> HTTPException:
        return HTTPException(e.status, detail={"message": e.message})

    # ── агент ──
    def _agent(authorization: Optional[str]) -> dict[str, Any]:
        ensure()
        raw = (authorization or "").strip()
        if not raw.lower().startswith("bearer "):
            raise HTTPException(401, detail={"message": "Нет ключа агента"})
        s = db.fetchone("SELECT * FROM miniapp_servers WHERE token_hash = ?", (_sha(raw[7:].strip()),))
        if not s:
            raise HTTPException(401, detail={"message": "Ключ агента не принят — сервер отключён в панели"})
        return s

    @r.get("/api/agent/script/{code}", response_class=PlainTextResponse)
    def agent_script(code: str) -> PlainTextResponse:
        return PlainTextResponse(install_script(code), headers={"Cache-Control": "no-store"})

    @r.get("/api/agent/agent.py", response_class=PlainTextResponse)
    def agent_source() -> PlainTextResponse:
        with open(AGENT_FILE, encoding="utf-8") as fh:
            return PlainTextResponse(fh.read(), headers={"Cache-Control": "no-store"})

    @r.post("/api/agent/register")
    def agent_register(request: Request, body: RegisterBody = Body(...)) -> dict[str, Any]:
        ensure()
        code = body.code.strip().lower()
        s = db.fetchone("SELECT * FROM miniapp_servers WHERE code_hash = ? AND code_expires > ?", (_sha(code), _now())) \
            if re.fullmatch(r"[a-z0-9]{6,16}", code) else None
        if not s:
            raise HTTPException(403, detail={"message": "Команда устарела или уже использована — получите новую в панели"})
        seen = core._client_ip(request)
        if seen and seen != s["ip"]:
            raise HTTPException(403, detail={"message": f"Сервер подключился с IP {seen}, а в панели указан {s['ip']}. "
                                                       f"Запустите команду на {s['ip']} или укажите в панели верный IP."})
        token = secrets.token_urlsafe(32)
        now = _now()
        db.execute("UPDATE miniapp_servers SET token_hash = ?, code_hash = NULL, code_expires = NULL, hostname = ?, os = ?, "
                   "agent_version = ?, connected_at = ?, last_seen = ? WHERE id = ?",
                   (_sha(token), body.hostname[:120], body.os[:120], body.version[:20], now, now, s["id"]))
        for row in db.fetchall("SELECT project_id FROM miniapp_installs WHERE server_id = ? AND state = 'waiting'", (s["id"],)):
            _start_install_task(row["project_id"])
        return {"token": token, "server_id": s["id"], "ip": s["ip"], "panel_url": panel_url()}

    @r.post("/api/agent/poll")
    async def agent_poll(body: PollBody = Body(...), authorization: Optional[str] = Header(None)) -> dict[str, Any]:
        s = _agent(authorization)
        sid = int(s["id"])
        db.execute("UPDATE miniapp_servers SET last_seen = ?, agent_version = ?, caddy = ?, hostname = COALESCE(NULLIF(?, ''), hostname) "
                   "WHERE id = ?", (_now(), body.version[:20], body.caddy[:60], body.hostname[:120], sid))
        if secrets.randbelow(50) == 0:
            _cleanup()
        deadline = _now() + POLL_HOLD
        tasks: list[dict[str, Any]] = []
        while True:
            rows = db.fetchall("SELECT id, kind, payload FROM miniapp_tasks WHERE server_id = ? AND state = 'new' "
                               "ORDER BY id LIMIT 10", (sid,))
            if rows:
                now = _now()
                for t in rows:
                    db.execute("UPDATE miniapp_tasks SET state = 'taken', taken_at = ? WHERE id = ? AND state = 'new'", (now, t["id"]))
                    tasks.append({"id": t["id"], "kind": t["kind"], "payload": json.loads(t["payload"] or "{}")})
                break
            if _now() >= deadline:
                break
            await asyncio.sleep(0.5)
        db.execute("UPDATE miniapp_servers SET last_seen = ? WHERE id = ?", (_now(), sid))
        # свежая сборка мини-приложения: агент сам скачает, если хэш другой
        want = {}
        for pid in server_projects(sid):
            h = bundle_hash(pid)
            if h:
                want[pid] = h
        return {"tasks": tasks, "want": want, "gateway": gateway_secret(), "panel_host": panel_host(), "agent": AGENT_VERSION}

    @r.post("/api/agent/progress")
    def agent_progress(body: ProgressBody = Body(...), authorization: Optional[str] = Header(None)) -> dict[str, Any]:
        s = _agent(authorization)
        t = _task(body.task)
        if not t or int(t["server_id"]) != int(s["id"]) or t["kind"] != "install":
            raise HTTPException(404, detail={"message": "Нет такой задачи"})
        pid = json.loads(t["payload"] or "{}").get("project", "")
        row = install_row(pid)
        if not row or row.get("task_id") != t["id"]:
            return {"ok": False, "stale": True}
        if body.step not in STEP_KEYS:
            raise HTTPException(400, detail={"message": "Неизвестный шаг"})
        extra: dict[str, Any] = {}
        if body.step == "dkim":
            # ключ DKIM живёт на главном (он подписывает письма), сервер мини-приложения только доставляет
            try:
                import mailer  # type: ignore
                extra["dkim"] = mailer.ensure_dkim(row["domain"])
            except Exception as exc:  # noqa: BLE001
                extra["dkim_error"] = f"{type(exc).__name__}: {exc}"
        if body.step == "caddy" and body.label.startswith("Caddy уже"):
            db.execute("UPDATE miniapp_installs SET fresh = 0 WHERE project_id = ?", (pid,))
        _install_update(pid, step=body.step, label=body.label[:200], state="installing")
        return {"ok": True, **extra}

    @r.post("/api/agent/result")
    def agent_result(body: ResultBody = Body(...), authorization: Optional[str] = Header(None)) -> dict[str, Any]:
        s = _agent(authorization)
        t = _task(body.task)
        if not t or int(t["server_id"]) != int(s["id"]):
            raise HTTPException(404, detail={"message": "Нет такой задачи"})
        res = {"ok": body.ok, "error": body.error, **body.result}
        db.execute("UPDATE miniapp_tasks SET state = ?, result = ?, done_at = ? WHERE id = ?",
                   ("done" if body.ok else "error", json.dumps(res, ensure_ascii=False)[:20000], _now(), t["id"]))
        if t["kind"] == "install":
            pid = json.loads(t["payload"] or "{}").get("project", "")
            row = install_row(pid)
            if row and row.get("task_id") == t["id"]:
                _finish_install(pid, body.ok, body.error)
        return {"ok": True}

    @r.get("/api/agent/bundle/{pid}")
    def agent_bundle(pid: str, authorization: Optional[str] = Header(None)) -> Response:
        s = _agent(authorization)
        pid = projects.normalize(pid) or ""
        row = install_row(pid) if pid else None
        allowed = pid and (pid in server_projects(int(s["id"])) or (row and int(row["server_id"]) == int(s["id"])))
        if not allowed:
            raise HTTPException(403, detail={"message": "Проект не на этом сервере"})
        if not bundle_hash(pid):
            raise HTTPException(503, detail={"message": "Сборка мини-приложения ещё не готова на главном сервере "
                                                       "(контейнер miniapp) — повторите через минуту"})
        return Response(bundle_tar(pid), media_type="application/gzip",
                        headers={"X-Bundle-Hash": bundle_hash(pid), "Cache-Control": "no-store"})

    # ── сервер панели: общий сайт Caddy с on-demand TLS (install.sh) ──
    def _loopback(request: Request) -> None:
        if (request.client.host if request.client else "") not in ("127.0.0.1", "::1"):
            raise HTTPException(404)

    @r.get("/api/internal/miniapp/ask")
    def local_ask(request: Request, domain: str = "") -> Response:
        """Caddy спрашивает перед выпуском сертификата: наш ли домен."""
        _loopback(request)
        d = norm_domain(domain)
        return Response(status_code=200 if d and d in local_domains(fresh=True) else 404)

    @r.get("/api/internal/miniapp/route")
    def local_route(request: Request) -> Response:
        """forward_auth: проект статики по домену → X-Project для контейнера мини-приложений."""
        _loopback(request)
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
        pid = local_domains().get(norm_domain(host))
        if not pid:
            return Response("Not found", status_code=404)
        return Response(status_code=200, headers={"X-Project": pid, "Cache-Control": "no-store"})

    # ── панель: начальное меню ──
    def _project_view(p: Any) -> dict[str, Any]:
        cfg = projects.panel_config(p.id, fresh=True)
        local = cfg.get("MINIAPP_SERVER") == LOCAL
        srv = server(cfg["MINIAPP_SERVER"]) if cfg.get("MINIAPP_SERVER") and not local else None
        legacy = bool(p.miniapp_url) and not cfg.get("MINIAPP_DOMAIN")
        with projects.use(p.id):
            # сквады: свои у проекта, иначе — общие сети (как их видит выдача подписки)
            vpn_sq = core.fulfillment.squad_setting("squad_mapping_vpn", project_id=p.id)
            trial_sq = core.fulfillment.squad_setting("squad_mapping_trial", project_id=p.id)
            chan_req = db.get_setting("channel_required", "0") in ("1", "true", "True", "yes")
            methods = core.pay_methods()
            pm = {m["id"]: m["enabled"] for m in methods}
            ready, missing = project_ready(p, methods)
        tok = p.bot_token
        return {
            "id": p.id, "name": p.name, "has_site": bool(p.feature("site")),
            "installed": bool(cfg.get("MINIAPP_DOMAIN")) or legacy, "legacy": legacy,
            "active": p.active, "domain": cfg.get("MINIAPP_DOMAIN") or (urlparse(p.miniapp_url).hostname or ""),
            "site_domain": cfg.get("SITE_DOMAIN", ""),
            "server": ({"id": 0, "ip": panel_ip(), "online": True, "local": True} if local else
                       {"id": srv["id"], "ip": srv["ip"], "online": server_online(srv), "local": False} if srv else None),
            "install": install_view(p.id),
            "bot": {"token_set": bool(tok), "username": p.bot_username,
                    "token_hint": core._mask(tok.split(":", 1)[1]) if ":" in tok else ""},
            "squads": {"vpn": list(vpn_sq), "trial": list(trial_sq)},
            "pay_mode": "yk" if (pm.get("card", True) or pm.get("sbp", True)) else "stars",
            "yookassa": {"shop_id": p.env("YOOKASSA_SHOP_ID"), "secret_set": bool(p.env("YOOKASSA_SECRET_KEY")),
                         "webhook_url": f"{p.miniapp_url}/yookassa" if p.miniapp_url else ""},
            "channel": {"id": p.channel_id, "required": chan_req},
            "mail_from": f"no-reply@{cfg['MINIAPP_DOMAIN']}" if cfg.get("MINIAPP_DOMAIN") else "",
            "ready": ready, "missing": missing,
        }

    def _servers_view() -> list[dict[str, Any]]:
        out = []
        for s in db.fetchall("SELECT * FROM miniapp_servers WHERE token_hash IS NOT NULL ORDER BY id"):
            out.append({"id": s["id"], "ip": s["ip"], "hostname": s.get("hostname") or "", "online": server_online(s),
                        "caddy": s.get("caddy") or "", "projects": server_projects(int(s["id"]))})
        return out

    @r.get("/api/panel/setup")
    def setup_get(_: dict = Depends(core.require_owner)) -> dict[str, Any]:
        ensure()
        squads = db.fetchall("SELECT squad_uuid, squad_name FROM squads WHERE is_active = 1 ORDER BY priority DESC")
        admins = admin_ids()
        return {
            "panel_url": panel_url(), "panel_host": panel_host(), "gateway_ready": bool(gateway_secret()),
            "remnawave": bool((os.getenv("REMWAVE_API_KEY") or "").strip()),
            "projects": [_project_view(p) for p in projects.all_projects()],
            "servers": _servers_view(),
            "squads": [{"uuid": q["squad_uuid"], "name": q["squad_name"]} for q in squads],
            "admins": admins,
            "panel_ip": panel_ip(), "local_caddy": local_caddy_ready() is not False,
        }

    @r.get("/api/panel/setup/install/{pid}")
    def setup_install_get(pid: str, _: dict = Depends(core.require_owner)) -> dict[str, Any]:
        return {"install": install_view(pid), "servers": _servers_view()}

    @r.post("/api/panel/setup/install")
    def setup_install(body: InstallBody = Body(...), p: dict = Depends(core.require_owner)) -> dict[str, Any]:
        try:
            out = start_install(body.project, ip=body.ip, server_id=body.server_id, domain=body.domain,
                                site_domain=body.site_domain, local=body.local)
        except SetupError as e:
            raise _err(e)
        core.audit(p["actor"], p["name"], f"setup: установка {body.project} → {body.domain}")
        return {"install": out}

    @r.post("/api/panel/setup/install/{pid}/cancel")
    def setup_install_cancel(pid: str, _: dict = Depends(core.require_owner)) -> dict[str, Any]:
        try:
            cancel_install(pid)
        except SetupError as e:
            raise _err(e)
        return {"ok": True}

    @r.post("/api/panel/setup/install/{pid}/retry")
    def setup_install_retry(pid: str, _: dict = Depends(core.require_owner)) -> dict[str, Any]:
        row = install_row(pid)
        if not row:
            raise HTTPException(404, detail={"message": "Установки нет"})
        if int(row["server_id"] or 0) != 0 and not server_online(server(row["server_id"])):
            raise HTTPException(400, detail={"message": "Сервер не на связи — проверьте службу blin-agent"})
        _start_install_task(pid)
        return {"install": install_view(pid)}

    @r.get("/api/panel/setup/mail/{pid}")
    def setup_mail(pid: str, _: dict = Depends(core.require_owner)) -> dict[str, Any]:
        return mail_dns(pid)

    @r.put("/api/panel/setup/project/{pid}")
    def setup_project_put(pid: str, body: SetupProjectBody = Body(...), p: dict = Depends(core.require_owner)) -> dict[str, Any]:
        pid = projects.normalize(pid) or ""
        if not pid:
            raise HTTPException(404, detail={"message": "Нет такого проекта"})
        if body.pay_mode not in (None, "yk", "stars"):
            raise HTTPException(400, detail={"message": "Оплата: ЮKassa или Stars"})
        with projects.use(pid):
            fields = {k: getattr(body, k) for k in ("bot_token", "yookassa_shop_id", "yookassa_secret_key", "channel_id")
                      if getattr(body, k) is not None}
            if body.pay_mode == "stars":
                fields.pop("yookassa_shop_id", None)
                fields.pop("yookassa_secret_key", None)
            if fields:
                try:
                    core.panel_project_config_put(core.ProjectConfigBody(**fields), p)
                except HTTPException:
                    raise
                except Exception as exc:  # noqa: BLE001
                    raise HTTPException(400, detail={"message": str(exc) or "Не удалось сохранить настройки"}) from exc
            if body.admins is not None:
                ids = [x.strip() for x in body.admins if x.strip().lstrip("-").isdigit()]
                db.set_setting("forum_admin_ids", ", ".join(dict.fromkeys(ids)))
            if body.squads_vpn is not None or body.squads_trial is not None:
                cur_vpn = db.loads(db.get_setting("squad_mapping_vpn", "[]"), []) or []
                cur_trial = db.loads(db.get_setting("squad_mapping_trial", "[]"), []) or []
                core.set_squad_mapping(list(body.squads_vpn if body.squads_vpn is not None else cur_vpn),
                                       list(body.squads_trial if body.squads_trial is not None else cur_trial))
            if body.pay_mode is not None:
                cur = {m["id"]: {"enabled": m["enabled"]} for m in core.pay_methods()}
                for k in ("card", "sbp"):
                    if k in cur:
                        cur[k]["enabled"] = body.pay_mode == "yk"
                if "tg_stars" in cur:
                    cur["tg_stars"]["enabled"] = True
                db.set_setting("pay_methods", db.dumps(cur))
            if body.channel_required is not None:
                db.set_setting("channel_required", "1" if body.channel_required else "0")
            if body.active is not None:
                projects.set_panel_config(pid, {"PROJECT_ACTIVE": "1" if body.active else "0"})
            if body.bot_token:
                try:
                    set_menu_button(pid)
                except Exception as exc:  # noqa: BLE001
                    print(f"[miniapps] кнопка мини-приложения {pid}: {exc}", flush=True)
        core.audit(p["actor"], p["name"], f"setup: настройки проекта {pid}")
        return {"project": _project_view(projects.get(pid))}

    @r.post("/api/panel/setup/servers/{sid}/forget")
    def setup_server_forget(sid: int, _: dict = Depends(core.require_owner)) -> dict[str, Any]:
        if server_projects(sid):
            raise HTTPException(400, detail={"message": "На сервере есть проекты — сначала перенесите их"})
        db.execute("DELETE FROM miniapp_installs WHERE server_id = ? AND state != 'done'", (sid,))
        db.execute("DELETE FROM miniapp_tasks WHERE server_id = ?", (sid,))
        db.execute("DELETE FROM miniapp_servers WHERE id = ?", (sid,))
        return {"ok": True}

    return r
