"""
Ссылки для добавления подписки в Incy / Happ — без шифрования:
  incy://add/<ссылка подписки>
  happ://add/<ссылка подписки>
Оба формата понимают все версии приложений.
"""

from __future__ import annotations

APP_SCHEMES = ("incy", "happ")


class AppLinkError(Exception):
    pass


def add_link(app: str, url: str) -> str:
    """<app>://add/<url> для incy / happ."""
    a = (app or "").lower()
    if a not in APP_SCHEMES:
        raise AppLinkError(f"unknown app {app!r}")
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        raise AppLinkError("bad url")
    return f"{a}://add/{url}"


def build_link(app: str, url: str, name: str | None = None) -> str:
    """incy / happ → <app>://add/<url>; other / plain / link → сама ссылка подписки."""
    a = (app or "incy").lower()
    if a in ("other", "plain", "link"):
        return url
    return add_link(a if a in APP_SCHEMES else "incy", url)
