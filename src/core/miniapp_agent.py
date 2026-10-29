#!/usr/bin/env python3
# listvpn · агент сервера мини-приложения (blin-agent).
# Ставится командой из панели: curl -fsSL https://<панель>/m/<код> | sudo bash
#   agent.py register <панель> <код> — подключить сервер к панели (ключ → /etc/blin-agent.json, служба systemd)
#   agent.py watch                   — показать ход установки в терминале
#   agent.py run                     — служба: опрашивает панель, ставит сайты мини-приложений в Caddy, шлёт письма
# Только стандартная библиотека Python 3.8+. Панель главного сервера — единственный, кому агент доверяет.
from __future__ import annotations

import base64
import io
import json
import os
import platform
import queue
import shutil
import smtplib
import socket
import ssl
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.request

VERSION = "1.0"
CONF = "/etc/blin-agent.json"
STATE_DIR = "/var/lib/blin-agent"
STATUS = os.path.join(STATE_DIR, "status.json")
BUNDLES = os.path.join(STATE_DIR, "bundles.json")
WWW = "/var/www/blin"
SITES = "/etc/caddy/blin"
CADDYFILE = "/etc/caddy/Caddyfile"
IMPORT_LINE = "import /etc/caddy/blin/*.caddy"
UNIT = "/etc/systemd/system/blin-agent.service"
CADDY_FALLBACK = "2.8.4"

G, R, Y, W, N = "\033[32m", "\033[31m", "\033[33m", "\033[1m", "\033[0m"

# панель — по IPv4: панель сверяет IP сервера с тем, что указан при установке
_orig_gai = socket.getaddrinfo


def _gai4(host, port, family=0, type=0, proto=0, flags=0):  # noqa: A002
    res = _orig_gai(host, port, socket.AF_INET, type, proto, flags)
    return res or _orig_gai(host, port, family, type, proto, flags)


socket.getaddrinfo = _gai4


def log(msg: str) -> None:
    print(f"[blin-agent] {msg}", flush=True)


# ───────────────────────── HTTP к панели ─────────────────────────

class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _request(url: str, *, data: dict | None = None, token: str = "", timeout: float = 30, raw: bool = False):
    body = json.dumps(data).encode() if data is not None else None
    headers = {"User-Agent": f"blin-agent/{VERSION}", "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content = resp.read()
            return (content, dict(resp.headers)) if raw else json.loads(content.decode() or "{}")
    except urllib.error.HTTPError as e:
        msg = f"HTTP {e.code}"
        try:
            det = json.loads(e.read().decode()).get("detail")
            msg = det.get("message", msg) if isinstance(det, dict) else (str(det) if det else msg)
        except Exception:  # noqa: BLE001
            pass
        raise ApiError(e.code, msg)


def load_conf() -> dict:
    with open(CONF, encoding="utf-8") as fh:
        return json.load(fh)


def _write_json(path: str, data: dict, mode: int = 0o600) -> None:
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def _read_json(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def sh(cmd: str, timeout: int = 900) -> tuple[int, str]:
    p = subprocess.run(["bash", "-c", cmd], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    return p.returncode, p.stdout.decode("utf-8", "replace")


def os_name() -> str:
    try:
        with open("/etc/os-release", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("PRETTY_NAME="):
                    return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return platform.platform()


# ───────────────────────── register / watch ─────────────────────────

UNIT_TEXT = """[Unit]
Description=listvpn agent (сервер мини-приложения)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/env python3 /opt/blin-agent/agent.py run
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
"""


def cmd_register(panel: str, code: str) -> int:
    panel = panel.rstrip("/")
    try:
        r = _request(f"{panel}/api/agent/register", data={"code": code, "hostname": socket.gethostname(),
                                                          "os": os_name(), "version": VERSION}, timeout=20)
    except ApiError as e:
        print(f"{R}✗ {e.message}{N}", file=sys.stderr)
        return 1
    except Exception as e:  # noqa: BLE001
        print(f"{R}✗ Панель {panel} недоступна: {e}{N}", file=sys.stderr)
        return 1
    _write_json(CONF, {"panel": panel, "token": r["token"], "server_id": r["server_id"], "ip": r.get("ip", "")})
    _write_json(STATUS, {"connected": False, "install": None, "ts": time.time()}, 0o644)
    with open(UNIT, "w", encoding="utf-8") as fh:
        fh.write(UNIT_TEXT)
    sh("systemctl daemon-reload && systemctl enable blin-agent >/dev/null 2>&1; systemctl restart blin-agent")
    print(f"{G}✓{N} Агент установлен, ключ панели получен", flush=True)
    return 0


def cmd_watch() -> int:
    frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    i = 0
    shown_conn = False
    shown_steps: set[str] = set()
    shown_domain = ""
    host = ""
    try:
        host = load_conf().get("panel", "").split("://", 1)[-1]
    except Exception:  # noqa: BLE001
        pass
    deadline = time.time() + 40 * 60
    tty = sys.stdout.isatty()
    while time.time() < deadline:
        st = _read_json(STATUS)
        if not shown_conn:
            if st.get("connected"):
                sys.stdout.write(("\r\033[K" if tty else "") + f"{G}✓{N} Панель подключилась ({host})\n")
                shown_conn = True
            else:
                if tty:
                    sys.stdout.write(f"\r{Y}{frames[i % len(frames)]}{N} Ожидание панели...")
                elif i == 0:
                    sys.stdout.write("Ожидание панели...\n")
                sys.stdout.flush()
                i += 1
                time.sleep(0.12)
                continue
        inst = st.get("install") or {}
        if inst.get("domain") and inst.get("domain") != shown_domain:
            shown_domain = inst["domain"]
            print(f"→ Домен: {W}{shown_domain}{N}")
            print(f"{Y}Установка...{N}", flush=True)
        for s in inst.get("done") or []:
            if s not in shown_steps:
                shown_steps.add(s)
                print(f"{G}✓{N} {s}", flush=True)
        if inst.get("state") == "done":
            print(f"{G}Готово:{N} {W}https://{inst.get('domain')}{N}")
            print("Дальше — в панели: бот, оплата, сквады проекта.")
            return 0
        if inst.get("state") == "error":
            print(f"{R}✗ {inst.get('error') or 'Установка не удалась'}{N}", file=sys.stderr)
            print("Исправьте причину и нажмите «Повторить» в панели — команду запускать заново не нужно.")
            return 1
        time.sleep(0.5)
    print("Установка продолжается в фоне — следите за ней в панели.")
    return 0


# ───────────────────────── Caddy ─────────────────────────

def caddy_version() -> str:
    if not shutil.which("caddy"):
        return ""
    rc, out = sh("caddy version 2>/dev/null | head -n1", 20)
    return out.strip().split(" ")[0] if rc == 0 else ""


CADDY_INSTALL = r"""
set -e
export DEBIAN_FRONTEND=noninteractive
if apt-get install -y -qq --no-install-recommends debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null 2>&1 \
   && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
   && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list \
   && chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list \
   && apt-get update -qq >/dev/null 2>&1 \
   && apt-get install -y -qq caddy >/dev/null 2>&1; then
    exit 0
fi
rm -f /etc/apt/sources.list.d/caddy-stable.list
ver=__VER__
case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo "архитектура $(uname -m) не поддерживается"; exit 1 ;; esac
tmp="$(mktemp -d)"
base="https://github.com/caddyserver/caddy/releases/download/v${ver}"
curl -fsSL -o "$tmp/caddy.tgz" "${base}/caddy_${ver}_linux_${arch}.tar.gz"
curl -fsSL -o "$tmp/sums.txt" "${base}/caddy_${ver}_checksums.txt"
want="$(awk -v f="caddy_${ver}_linux_${arch}.tar.gz" '$2==f {print $1}' "$tmp/sums.txt")"
got="$(sha512sum "$tmp/caddy.tgz" | awk '{print $1}')"
[ -n "$want" ] && [ "$want" = "$got" ] || { echo "контрольная сумма Caddy не совпала"; rm -rf "$tmp"; exit 1; }
tar -xzf "$tmp/caddy.tgz" -C "$tmp" caddy
install -m 755 -o root -g root "$tmp/caddy" /usr/bin/caddy
rm -rf "$tmp"
getent group caddy >/dev/null || groupadd --system caddy
id caddy >/dev/null 2>&1 || useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
mkdir -p /etc/caddy
cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
"""


def install_caddy() -> None:
    rc, out = sh(CADDY_INSTALL.replace("__VER__", CADDY_FALLBACK), 900)
    if rc != 0 or not caddy_version():
        raise RuntimeError("Не удалось установить Caddy: " + (out.strip().splitlines() or ["нет вывода"])[-1][:200])


def ensure_caddy_main() -> None:
    os.makedirs(SITES, exist_ok=True)
    sh(f"chown root:caddy {SITES} 2>/dev/null; chmod 750 {SITES}", 10)
    try:
        with open(CADDYFILE, encoding="utf-8") as fh:
            cur = fh.read()
    except OSError:
        cur = ""
    default_pkg = "/usr/share/caddy" in cur and ":80" in cur
    if not cur.strip() or default_pkg:
        with open(CADDYFILE, "w", encoding="utf-8") as fh:
            fh.write("# listvpn: сайты мини-приложений — /etc/caddy/blin/*.caddy (их пишет служба blin-agent)\n"
                     f"{IMPORT_LINE}\n")
    elif IMPORT_LINE not in cur:
        with open(CADDYFILE, "a", encoding="utf-8") as fh:
            fh.write(f"\n# listvpn: сайты мини-приложений (blin-agent)\n{IMPORT_LINE}\n")


def site_text(p: dict) -> str:
    pid, dom = p["project"], p["domain"]
    addrs = dom + (f", {p['site_domain']}" if p.get("site_domain") else "")
    panel = p["panel_url"].rstrip("/")
    host = panel.split("://", 1)[-1]
    sni = p.get("panel_host") or host.split(":", 1)[0]
    return f"""# listvpn: мини-приложение {p.get('name') or pid} ({pid}) — файл пишет blin-agent, правки затрутся
{addrs} {{
	encode zstd gzip
	header {{
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
		defer
	}}
	request_body {{
		max_size 55MB
	}}
	route {{
		handle /api/internal* {{
			respond 404
		}}
		handle /api/panel* {{
			respond 404
		}}
		handle /api/agent* {{
			respond 404
		}}
		# API, вебхуки ЮKassa → главный сервер (там бот и база)
		@main path /api /api/* /yookassa* /webhooks/payments/*
		handle @main {{
			reverse_proxy {panel} {{
				header_up Host {host}
				header_up X-Project {pid}
				header_up X-Miniapp-Gateway {p['gateway']}
				header_up X-Real-IP {{client_ip}}
				header_up X-Forwarded-For {{client_ip}}
				header_up -CF-Connecting-IP
				header_up -True-Client-IP
				flush_interval -1
				transport http {{
					tls_server_name {sni}
				}}
			}}
		}}
		@static path *.js *.css *.woff *.woff2 *.png *.jpg *.jpeg *.svg *.ico *.webp *.gif *.mp4 *.webm
		header @static Cache-Control "public, max-age=604800"
		handle {{
			root * {WWW}/{pid}
			try_files {{path}} {{path}}/ /index.html
			file_server
		}}
	}}
}}
"""


def site_path(pid: str) -> str:
    return os.path.join(SITES, f"{pid}.caddy")


def apply_caddy(pid: str, text: str | None) -> None:
    """записать (или удалить при text=None) сайт проекта и перечитать Caddy; при ошибке — вернуть как было."""
    path = site_path(pid)
    old = None
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            old = fh.read()
    if text is None:
        if os.path.isfile(path):
            os.remove(path)
    else:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        sh(f"chown root:caddy {path} 2>/dev/null; chmod 640 {path}", 10)
    rc, out = sh(f"caddy validate --config {CADDYFILE} --adapter caddyfile 2>&1 | tail -n 5", 60)
    if rc != 0 or "Valid configuration" not in out:
        if old is None:
            if os.path.isfile(path):
                os.remove(path)
        else:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(old)
        raise RuntimeError("Конфиг Caddy не прошёл проверку: " + out.strip()[-300:])
    rc, _ = sh("systemctl is-active --quiet caddy", 10)
    if rc == 0:
        rc, out = sh("systemctl reload caddy 2>&1 || systemctl restart caddy 2>&1", 90)
    else:
        rc, out = sh("systemctl enable caddy >/dev/null 2>&1; systemctl restart caddy 2>&1", 90)
    if rc != 0:
        raise RuntimeError("Caddy не перезапустился: " + out.strip()[-300:])


def wait_cert(dom: str, timeout: int = 240) -> None:
    ctx = ssl.create_default_context()
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", 443), timeout=5) as s:
                with ctx.wrap_socket(s, server_hostname=dom):
                    return
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
        time.sleep(4)
    _, j = sh("journalctl -u caddy --no-pager -n 80 2>/dev/null | grep -iE 'error|acme|challenge' | tail -n 3", 20)
    hint = (" · " + j.strip().splitlines()[-1][-220:]) if j.strip() else ""
    raise RuntimeError(f"Caddy не получил сертификат для {dom}: проверьте, что A-запись указывает на этот сервер "
                       f"и порты 80/443 открыты{hint or (' · ' + last[:160] if last else '')}")


# ───────────────────────── сборка мини-приложения ─────────────────────────

_bundle_lock = threading.Lock()


def fetch_bundle(conf: dict, pid: str, tries: int = 10) -> str:
    with _bundle_lock:
        data, hdrs = b"", {}
        for i in range(tries):
            try:
                data, hdrs = _request(f"{conf['panel']}/api/agent/bundle/{pid}", token=conf["token"], timeout=120, raw=True)
                break
            except ApiError as e:
                if e.status == 503 and i < tries - 1:
                    time.sleep(6)
                    continue
                raise RuntimeError(f"Сборка мини-приложения: {e.message}")
        os.makedirs(WWW, exist_ok=True)
        new = os.path.join(WWW, f".{pid}.new")
        shutil.rmtree(new, ignore_errors=True)
        os.makedirs(new)
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            for m in tar.getmembers():
                name = m.name
                if name.startswith("/") or ".." in name.split("/") or not (m.isfile() or m.isdir()):
                    raise RuntimeError(f"Сборка мини-приложения: недопустимый путь {name!r}")
            for m in tar.getmembers():
                target = os.path.join(new, m.name)
                if m.isdir():
                    os.makedirs(target, exist_ok=True)
                    continue
                os.makedirs(os.path.dirname(target), exist_ok=True)
                src = tar.extractfile(m)
                if src is None:
                    continue
                with open(target, "wb") as out:
                    shutil.copyfileobj(src, out)
                os.chmod(target, 0o644)
        if not os.path.isfile(os.path.join(new, "index.html")):
            shutil.rmtree(new, ignore_errors=True)
            raise RuntimeError("Сборка мини-приложения пустая (нет index.html)")
        sh(f"find {new} -type d -exec chmod 755 {{}} +", 30)
        cur = os.path.join(WWW, pid)
        old = os.path.join(WWW, f".{pid}.old")
        shutil.rmtree(old, ignore_errors=True)
        if os.path.isdir(cur):
            os.replace(cur, old)
        os.replace(new, cur)
        shutil.rmtree(old, ignore_errors=True)
        # хэш сборки — как его считает панель (X-Bundle-Hash): по нему агент понимает, что пора обновиться
        h = next((v for k, v in hdrs.items() if k.lower() == "x-bundle-hash"), "")
        b = _read_json(BUNDLES)
        b[pid] = h
        _write_json(BUNDLES, b, 0o600)
        return h


def placeholder(pid: str) -> None:
    d = os.path.join(WWW, pid)
    if os.path.isfile(os.path.join(d, "index.html")):
        return
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as fh:
        fh.write("<!doctype html><meta charset=utf-8><title>Скоро</title><p style='font:16px system-ui;text-align:center;"
                 "margin-top:40vh;color:#888'>Мини-приложение устанавливается…</p>")
    os.chmod(d, 0o755)


def check_site(dom: str) -> None:
    ctx = ssl.create_default_context()
    for path, what in (("/", "Мини-приложение"), ("/api/health", "API через главный сервер")):
        last = ""
        for _ in range(5):
            try:
                req = urllib.request.Request(f"https://{dom}{path}", headers={"User-Agent": f"blin-agent/{VERSION}"})
                with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                    if resp.status == 200:
                        last = ""
                        break
                    last = f"HTTP {resp.status}"
            except urllib.error.HTTPError as e:
                last = f"HTTP {e.code}"
            except Exception as e:  # noqa: BLE001
                last = f"{type(e).__name__}: {e}"
            time.sleep(3)
        if last:
            if path == "/":
                raise RuntimeError(f"https://{dom} не открывается ({last[:160]}) — проверьте A-запись домена")
            raise RuntimeError(f"{what} не отвечает ({last[:160]}): https://{dom}/api не доходит до панели. "
                               "Обновите главный сервер (install.sh → обновление), чтобы он принимал мини-приложения.")


# ───────────────────────── задачи ─────────────────────────

class Agent:
    def __init__(self) -> None:
        self.conf = load_conf()
        self.q: "queue.Queue[dict]" = queue.Queue()
        self.busy: set[str] = set()
        self.status = _read_json(STATUS) or {}

    def api(self, path: str, data: dict | None = None, timeout: float = 30):
        return _request(f"{self.conf['panel']}{path}", data=data, token=self.conf["token"], timeout=timeout)

    def save_status(self) -> None:
        self.status["ts"] = time.time()
        try:
            _write_json(STATUS, self.status, 0o644)
        except OSError:
            pass

    # ── установка ──
    def progress(self, tid: int, step: str, label: str) -> dict:
        inst = self.status.get("install") or {}
        if inst.get("current"):
            inst.setdefault("done", []).append(inst["current"])
        inst["current"] = label
        self.status["install"] = inst
        self.save_status()
        try:
            return self.api("/api/agent/progress", {"task": tid, "step": step, "label": label})
        except Exception as e:  # noqa: BLE001
            log(f"progress {step}: {e}")
            return {}

    def result(self, tid: int, ok: bool, error: str = "", result: dict | None = None) -> None:
        for i in range(5):
            try:
                self.api("/api/agent/result", {"task": tid, "ok": ok, "error": error[:1900], "result": result or {}})
                return
            except Exception as e:  # noqa: BLE001
                log(f"result {tid}: {e}")
                time.sleep(3 * (i + 1))

    def do_install(self, task: dict) -> None:
        tid, p = task["id"], task["payload"]
        pid, dom = p["project"], p["domain"]
        self.busy.add(pid)
        self.status["install"] = {"project": pid, "domain": dom, "state": "running", "done": [], "current": ""}
        self.save_status()
        try:
            self.progress(tid, "domain", f"Получен домен {dom}")
            if caddy_version():
                self.progress(tid, "caddy", "Caddy уже стоит — добавляем сайт")
            else:
                self.progress(tid, "caddy", "Установка Caddy")
                install_caddy()
            ensure_caddy_main()
            self.progress(tid, "cert", "Выпуск сертификата Let’s Encrypt")
            placeholder(pid)
            apply_caddy(pid, site_text(p))
            wait_cert(dom)
            if p.get("site_domain"):
                wait_cert(p["site_domain"])
            self.progress(tid, "bundle", "Загрузка мини-приложения")
            fetch_bundle(self.conf, pid)
            r = self.progress(tid, "dkim", "Настройка почты: DKIM-ключ для домена")
            if r.get("dkim_error"):
                log(f"DKIM: {r['dkim_error']}")
            self.progress(tid, "check", f"Проверка https://{dom}")
            check_site(dom)
            inst = self.status["install"]
            inst.setdefault("done", []).append(inst.get("current") or "")
            inst["current"] = ""
            inst["state"] = "done"
            self.save_status()
            self.result(tid, True)
        except Exception as e:  # noqa: BLE001
            msg = str(e) or type(e).__name__
            log(f"установка {pid}: {msg}")
            self.status["install"].update(state="error", error=msg)
            self.save_status()
            self.result(tid, False, msg)
        finally:
            self.busy.discard(pid)

    def do_remove(self, task: dict) -> None:
        pid = task["payload"].get("project", "")
        try:
            if os.path.isfile(site_path(pid)):
                apply_caddy(pid, None)
            shutil.rmtree(os.path.join(WWW, pid), ignore_errors=True)
            b = _read_json(BUNDLES)
            b.pop(pid, None)
            _write_json(BUNDLES, b, 0o600)
            self.result(task["id"], True)
        except Exception as e:  # noqa: BLE001
            self.result(task["id"], False, str(e))

    # ── почта: письмо уже подписано DKIM на главном, здесь только доставка на MX ──
    def do_mail(self, task: dict) -> None:
        p = task["payload"]
        raw = base64.b64decode(p["raw"])
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        last, blocked = "нет MX", False
        for ip in p.get("mx") or []:
            try:
                srv = smtplib.SMTP(ip, 25, timeout=20, local_hostname=p.get("ehlo") or None)
                try:
                    srv.ehlo()
                    if srv.has_extn("starttls"):
                        try:
                            srv.starttls(context=ctx)
                            srv.ehlo()
                        except (smtplib.SMTPException, ssl.SSLError):
                            pass
                    srv.mail(p["from"])
                    code, msg = srv.rcpt(p["to"])
                    if code >= 400:
                        last = f"MX {ip}: {code} {msg.decode('utf-8', 'replace')[:160]}"
                        continue
                    code, msg = srv.data(raw)
                    if 200 <= code < 300:
                        self.result(task["id"], True)
                        return
                    last = f"MX {ip}: {code} {msg.decode('utf-8', 'replace')[:160]}"
                finally:
                    try:
                        srv.quit()
                    except Exception:  # noqa: BLE001
                        pass
            except smtplib.SMTPException as e:
                last = f"MX {ip}: {e}"[:200]
            except OSError as e:
                last, blocked = f"MX {ip}: {type(e).__name__}: {e}"[:200], True
        if blocked:
            last += " — похоже, хостинг сервера мини-приложения закрыл исходящий порт 25 (откройте его в поддержке хостинга)"
        self.result(task["id"], False, last)

    def worker(self) -> None:
        while True:
            t = self.q.get()
            try:
                if t["kind"] == "install":
                    self.do_install(t)
                elif t["kind"] == "remove":
                    self.do_remove(t)
            except Exception as e:  # noqa: BLE001
                log(f"задача {t.get('id')}: {e}")

    def sync_bundles(self, want: dict) -> None:
        have = _read_json(BUNDLES)
        for pid, h in (want or {}).items():
            if pid in self.busy or not os.path.isfile(site_path(pid)):
                continue
            if have.get(pid) != h:
                try:
                    fetch_bundle(self.conf, pid, tries=1)
                    log(f"мини-приложение {pid} обновлено")
                except Exception as e:  # noqa: BLE001
                    log(f"обновление {pid}: {e}")

    def run(self) -> None:
        threading.Thread(target=self.worker, daemon=True).start()
        backoff = 3
        log(f"агент {VERSION} → {self.conf['panel']}")
        while True:
            try:
                r = self.api("/api/agent/poll", {"version": VERSION, "caddy": caddy_version(), "hostname": socket.gethostname(),
                                                 "bundles": _read_json(BUNDLES)}, timeout=45)
                backoff = 3
                if not self.status.get("connected"):
                    self.status["connected"] = True
                    self.save_status()
                for t in r.get("tasks") or []:
                    if t["kind"] == "mail":
                        threading.Thread(target=self.do_mail, args=(t,), daemon=True).start()
                    else:
                        self.q.put(t)
                want = r.get("want") or {}
                if want:
                    threading.Thread(target=self.sync_bundles, args=(want,), daemon=True).start()
            except ApiError as e:
                log(f"панель: {e.message}")
                time.sleep(60 if e.status in (401, 403) else backoff)
                backoff = min(backoff * 2, 60)
            except Exception as e:  # noqa: BLE001
                log(f"нет связи с панелью: {type(e).__name__}: {e}")
                time.sleep(backoff)
                backoff = min(backoff * 2, 60)


def main(argv: list[str]) -> int:
    if os.geteuid() != 0:
        print("Нужен root.", file=sys.stderr)
        return 1
    if len(argv) >= 4 and argv[1] == "register":
        return cmd_register(argv[2], argv[3])
    if len(argv) >= 2 and argv[1] == "watch":
        try:
            return cmd_watch()
        except KeyboardInterrupt:
            print("\nУстановка продолжается в фоне — следите за ней в панели.")
            return 0
    if len(argv) >= 2 and argv[1] == "run":
        Agent().run()
        return 0
    print(__doc__ or "agent.py register <панель> <код> | watch | run")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
