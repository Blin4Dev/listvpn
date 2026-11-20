# Амбассадоры: у пользователя вместо стандартных реф. ссылок — свои, заданные в панели.
#   • Telegram: любой deep-link бота — t.me/<бот>?start=<что угодно> (или мини-приложение ?startapp=<что угодно>);
#   • сайт: любая ссылка на сайт проекта — путь и/или параметры (fgn.best/blogger, fgn.best/?promo=blog …).
# Кто пришёл по такой ссылке — реферал амбассадора (как по обычной реф. ссылке): процент — индивидуальный
# (partner_rate_custom, «Процент реферала» в панели), вывод — обычный вывод реф. баланса.
# Стандартные ссылки ref_<id> / ?ref=<id> у амбассадора продолжают работать.
from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit

try:
    from . import database as db  # type: ignore
    from . import projects  # type: ignore
except ImportError:
    import database as db  # type: ignore
    import projects  # type: ignore

# Telegram передаёт в бота/мини-приложение только такие start-параметры (ограничение Telegram, не наше)
TG_PAYLOAD_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# страницы сайта: голый путь занят ими (с параметрами — можно: /tariffs?from=blog)
SITE_RESERVED = ("/", "/login", "/support", "/tariffs", "/download", "/rules", "/cabinet", "/gifts", "/checkout",
                 "/payment", "/assets", "/api", "/favicon.ico", "/robots.txt", "/sitemap.xml", "/manifest.json")

_schema_ok = False


class AmbassadorError(ValueError):
    pass


def ensure_schema() -> None:
    global _schema_ok
    if _schema_ok:
        return
    cols = {r["name"] for r in db.fetchall("PRAGMA table_info(users)")}
    for col, typ in (("amb_tg", "TEXT"), ("amb_tg_mode", "TEXT"), ("amb_site", "TEXT")):
        if col not in cols:
            try:
                db.execute(f"ALTER TABLE users ADD COLUMN {col} {typ}")
            except Exception as exc:  # noqa: BLE001 — другой процесс успел
                if "duplicate column" not in str(exc).lower():
                    raise
    _schema_ok = True


# ── разбор того, что ввели в панели ──

def parse_tg(raw: Optional[str]) -> Optional[tuple[str, str]]:
    """'test' | 't.me/bot?start=test' | 'https://t.me/bot/app?startapp=test' → (payload, 'start'|'startapp');
    пусто → None."""
    v = str(raw or "").strip()
    if not v:
        return None
    mode = "start"
    if "?" in v or "/" in v or "t.me" in v.lower():
        u = urlsplit(v if "://" in v else "https://" + v.lstrip("/"))
        q = dict(parse_qsl(u.query, keep_blank_values=True))
        if "startapp" in q:
            mode, v = "startapp", q["startapp"]
        elif "start" in q:
            v = q["start"]
        else:
            raise AmbassadorError("В ссылке нет ?start=… — укажите, например, t.me/бот?start=blogger")
    v = unquote(v).strip()
    if not TG_PAYLOAD_RE.fullmatch(v):
        raise AmbassadorError("Telegram пропускает в ссылке после start= только латиницу, цифры, _ и - "
                              "(до 64 символов). Другие символы бот просто не получит.")
    return v, mode


def _norm_path(path: str) -> str:
    p = "/" + unquote(path or "").strip().strip("/")
    return re.sub(r"/{2,}", "/", p).lower()


def site_key(path: str, query: str) -> str:
    """ключ ссылки сайта: путь (без регистра и концевого /) + параметры в порядке имени."""
    pairs = sorted((k, v) for k, v in parse_qsl(query or "", keep_blank_values=True) if k)
    return _norm_path(path) + (("?" + urlencode(pairs)) if pairs else "")


def parse_site(raw: Optional[str]) -> Optional[str]:
    """'blogger' | '/blogger' | 'fgn.best/blogger?x=1' | '?promo=blog' → ключ ('/blogger', '/?promo=blog'); пусто → None."""
    v = str(raw or "").strip()
    if not v:
        return None
    if v.startswith("?"):
        v = "/" + v
    if "://" in v:
        u = urlsplit(v)
    elif v.startswith("/"):
        u = urlsplit("https://x" + v)
    elif re.match(r"^[^/?#]+\.[a-z]{2,}([/?#]|$)", v, re.I):  # домен без https://
        u = urlsplit("https://" + v)
    else:
        u = urlsplit("https://x/" + v)
    key = site_key(u.path, u.query)
    path = key.split("?", 1)[0]
    if "?" not in key and (path in SITE_RESERVED or any(path.startswith(r + "/") for r in SITE_RESERVED if r != "/")):
        raise AmbassadorError(f"Адрес {path} занят страницей сайта — выберите другой "
                              "(или добавьте параметр, например ?from=blog)")
    if len(key) > 300:
        raise AmbassadorError("Слишком длинная ссылка")
    return key


# ── поиск ──

def by_tg(payload: str, pid: str) -> Optional[dict[str, Any]]:
    if not payload:
        return None
    ensure_schema()
    return db.fetchone("SELECT * FROM users WHERE amb_tg = ? AND project_id = ? LIMIT 1", (payload, pid))


def by_site(path: str, query: str, pid: str) -> Optional[dict[str, Any]]:
    """амбассадор, чья ссылка совпадает с открытой страницей: путь тот же, все его параметры есть в адресе
    (лишние параметры — utm и т.п. — не мешают). Несколько подходят — у кого параметров больше."""
    ensure_schema()
    want_path = _norm_path(path)
    have = set(parse_qsl(query or "", keep_blank_values=True))
    best, best_n = None, -1
    for r in db.fetchall("SELECT * FROM users WHERE amb_site IS NOT NULL AND amb_site != '' AND project_id = ?", (pid,)):
        kp, _, kq = str(r["amb_site"]).partition("?")
        if kp != want_path:
            continue
        need = set(parse_qsl(kq, keep_blank_values=True))
        if need <= have and len(need) > best_n:
            best, best_n = r, len(need)
    if best is None or (want_path == "/" and best_n == 0):
        return None
    return best


# ── ссылки ──

def tg_link(user: dict[str, Any]) -> Optional[str]:
    payload = user.get("amb_tg")
    if not payload:
        return None
    P = projects.get(projects.of(user))
    if (user.get("amb_tg_mode") or "start") == "startapp":
        link = (P.miniapp_link or "").strip().rstrip("/")
        if re.fullmatch(r"https://t\.me/[A-Za-z0-9_]{4,32}/[A-Za-z0-9_]{3,64}", link):
            return f"{link}?startapp={payload}"
        return f"https://t.me/{P.bot_username}?startapp={payload}"
    return f"https://t.me/{P.bot_username}?start={payload}"


def site_base(user: dict[str, Any]) -> str:
    P = projects.get(projects.of(user))
    base = (P.site_url or "").strip().rstrip("/")
    if not base:
        dom = (P.env("SITE_DOMAIN") or "").strip().strip("/")
        base = f"https://{dom}" if dom else ""
    return base


def site_link(user: dict[str, Any]) -> Optional[str]:
    key = user.get("amb_site")
    if not key:
        return None
    base = site_base(user)
    if not base:
        return None
    path, _, q = str(key).partition("?")
    return base + (path if path != "/" else "/") + (("?" + q) if q else "")


def info(user: dict[str, Any]) -> dict[str, Any]:
    ensure_schema()
    return {
        "active": bool(user.get("amb_tg") or user.get("amb_site")),
        "tg": user.get("amb_tg"),
        "tg_mode": user.get("amb_tg_mode") or "start",
        "tg_link": tg_link(user),
        "site": user.get("amb_site"),
        "site_link": site_link(user),
        "site_base": site_base(user),
        "rate": user.get("partner_rate", 25),
        "rate_custom": bool(user.get("partner_rate_custom")),
    }


# ── изменение из панели ──

def update(user: dict[str, Any], tg: Optional[str], site: Optional[str]) -> dict[str, Any]:
    """задать/убрать ссылки амбассадора. Пустое значение — убрать эту ссылку."""
    ensure_schema()
    pid = projects.of(user)
    uid = int(user["id"])
    t = parse_tg(tg)
    s = parse_site(site)
    if t:
        other = db.fetchone("SELECT id FROM users WHERE amb_tg = ? AND project_id = ? AND id != ?", (t[0], pid, uid))
        if other:
            raise AmbassadorError(f"Ссылка Telegram «{t[0]}» уже у пользователя #{other['id']}")
        # стандартные ссылки бота: ref_<id>, trk_, promo_, gift_ … — амбассадор их перехватил бы у других
        if re.match(r"(?i)^(ref|trk|promo|gift|giftn|pay|payfail)_", t[0]):
            raise AmbassadorError("Начало ref_ / trk_ / promo_ / gift_ / pay_ занято стандартными ссылками бота — "
                                  "выберите другое")
        tl = db.fetchone("SELECT id FROM tracking_links WHERE code = ? AND project_id = ?", (t[0], pid))
        if tl:
            raise AmbassadorError(f"«{t[0]}» уже используется трекинговой ссылкой")
    if s:
        other = db.fetchone("SELECT id FROM users WHERE amb_site = ? AND project_id = ? AND id != ?", (s, pid, uid))
        if other:
            raise AmbassadorError(f"Ссылка на сайт уже у пользователя #{other['id']}")
    db.execute("UPDATE users SET amb_tg = ?, amb_tg_mode = ?, amb_site = ? WHERE id = ?",
               (t[0] if t else None, t[1] if t else None, s, uid))
    fresh = db.fetchone("SELECT * FROM users WHERE id = ?", (uid,)) or user
    return info(fresh)


def list_for(pid: Optional[str]) -> list[dict[str, Any]]:
    ensure_schema()
    where = "(amb_tg IS NOT NULL AND amb_tg != '') OR (amb_site IS NOT NULL AND amb_site != '')"
    params: tuple = ()
    if pid:
        where = f"({where}) AND project_id = ?"
        params = (pid,)
    return db.fetchall(f"SELECT * FROM users WHERE {where} ORDER BY id", params)
