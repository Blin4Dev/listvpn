# Подмена домена ссылки подписки — у каждого проекта своя (панель → Настройки → «Проект»).
#   VPN_SUB_DOMAIN     — домен, на который меняем (sub.vpn.cc)
#   VPN_SUB_DOMAIN_ON  — "1" подмена включена, "0" выключена; не задано — включена, если домен указан
#                        (так работали установки до появления переключателя)
# Меняется только хост, путь остаётся: https://sub.vpn.ru/abcd → https://sub.vpn.cc/abcd
#
# В базе (subscriptions.key_config) храним ссылку как её отдал Remnawave, подмену делаем только при выдаче
# (vpn(url, project=…)) — тогда включение/выключение и смена домена сразу действуют на все ссылки.
# Старые записи, сохранённые уже с подменённым доменом, при выключенной подмене возвращаются на домен
# Remnawave: его запоминаем по живым ответам Remnawave (remember_origin).
from __future__ import annotations

import os
import re
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

try:
    import projects as _projects  # type: ignore
except ImportError:  # pragma: no cover
    _projects = None  # type: ignore

_HOST_RE = re.compile(r"^[A-Za-z0-9.-]+(:[0-9]{1,5})?$")
_ORIGIN_KEY = "rw_sub_origin_host"
_origin_cache: Optional[str] = None


def normalize_domain(raw: Optional[str]) -> str:
    """«domain.com», «https://domain.com/», «domain.com:8443» → «domain.com[:порт]»; мусор → ""."""
    raw = re.sub(r"^[a-z]+://", "", (raw or "").strip(), flags=re.I).split("/", 1)[0].strip().lower()
    return raw if _HOST_RE.match(raw) else ""


def _env(name: str, project: Optional[str]) -> str:
    if _projects is not None:
        return _projects.env(name, project=project).strip()
    return (os.getenv(name) or "").strip()


def config(project: Optional[str] = None) -> tuple[bool, str]:
    """(подмена включена, домен) для проекта (по умолчанию — текущего)."""
    domain = normalize_domain(_env("VPN_SUB_DOMAIN", project))
    flag = _env("VPN_SUB_DOMAIN_ON", project)
    on = bool(domain) and (flag != "0" if flag else True)
    return on, domain


def _swap_domains() -> set[str]:
    """все домены подмены сети (в т.ч. выключенные) — чтобы узнать подменённые ссылки в базе."""
    if _projects is None:
        d = normalize_domain(os.getenv("VPN_SUB_DOMAIN"))
        return {d} if d else set()
    out = set()
    for p in _projects.all_projects():
        d = normalize_domain(_projects.env("VPN_SUB_DOMAIN", project=p.id))
        if d:
            out.add(d)
    return out


def _db():
    return _projects._db() if _projects is not None else None  # type: ignore[attr-defined]


def origin_host() -> str:
    """домен ссылок подписки Remnawave (без подмены)."""
    global _origin_cache
    if _origin_cache:
        return _origin_cache
    env_base = normalize_domain(os.getenv("REMWAVE_SUB_PUBLIC_URL"))
    if env_base:
        return env_base
    try:
        db = _db()
        v = normalize_domain(db.get_setting(_ORIGIN_KEY, "")) if db else ""
    except Exception:  # noqa: BLE001
        v = ""
    if v:
        _origin_cache = v
    return v


def remember_origin(url: Optional[str]) -> None:
    """запомнить домен ссылки, которую только что отдал Remnawave."""
    global _origin_cache
    host = normalize_domain(urlsplit(str(url or "")).netloc)
    if not host or host == _origin_cache or host in _swap_domains():
        return
    _origin_cache = host
    try:
        db = _db()
        if db:
            db.set_setting(_ORIGIN_KEY, host)
    except Exception:  # noqa: BLE001
        pass


def swap(url: Optional[str], domain: str) -> Optional[str]:
    """заменить схему+хост в ссылке на https://domain, путь/параметры не трогать."""
    if not url or not domain:
        return url
    parts = urlsplit(str(url))
    if not parts.netloc:
        return url
    return urlunsplit(("https", domain, parts.path, parts.query, parts.fragment))


def vpn(url: Optional[str], project: Optional[str] = None) -> Optional[str]:
    """ссылка подписки для выдачи пользователю проекта project (по умолчанию — текущего)."""
    if not url:
        return url
    on, domain = config(project)
    if on:
        return swap(url, domain)
    # подмена выключена: ссылка, сохранённая когда-то с подменённым доменом, — обратно на домен Remnawave
    host = normalize_domain(urlsplit(str(url)).netloc)
    if host and host in _swap_domains():
        orig = origin_host()
        if orig and orig != host:
            return swap(url, orig)
    return url
