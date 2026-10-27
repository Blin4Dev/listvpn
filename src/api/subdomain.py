# домены ссылок подписки из .env:
#   VPN_SUB_DOMAIN       — домен обычного VPN (вместо домена из Remnawave)
#   WHITELIST_SUB_DOMAIN — домен белых списков (вместо домена из FurkVPN)
# Путь ссылки остаётся как есть: https://domain1.com/hIeb + VPN_SUB_DOMAIN=domain2.com → https://domain2.com/hIeb
# Пусто — ссылка отдаётся без изменений.
# Сеть проектов: у проекта может быть свой домен — FGN__VPN_SUB_DOMAIN (иначе общий VPN_SUB_DOMAIN).
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


def _domain(env_key: str) -> str:
    raw = (_projects.env(env_key) if _projects is not None else (os.getenv(env_key) or "")).strip()
    if not raw:
        return ""
    # допускаем «domain.com», «https://domain.com», «domain.com:8443», «https://domain.com/»
    raw = re.sub(r"^[a-z]+://", "", raw, flags=re.I).split("/", 1)[0].strip()
    return raw if _HOST_RE.match(raw) else ""


def swap(url: Optional[str], domain: str) -> Optional[str]:
    """заменить схему+хост в ссылке на https://domain, путь/параметры не трогать."""
    if not url or not domain:
        return url
    parts = urlsplit(str(url))
    if not parts.netloc:
        return url
    return urlunsplit(("https", domain, parts.path, parts.query, parts.fragment))


def vpn(url: Optional[str]) -> Optional[str]:
    return swap(url, _domain("VPN_SUB_DOMAIN"))


def whitelist(url: Optional[str]) -> Optional[str]:
    return swap(url, _domain("WHITELIST_SUB_DOMAIN"))
