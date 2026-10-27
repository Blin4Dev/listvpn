"""
Зашифрованные ссылки для добавления подписки в Incy / Happ.

Happ — happ://crypt5/<…>
  Официальная документация: https://www.happ.su/main/dev-docs/crypto-link
  Шифрование делает API Happ: POST https://crypto.happ.su/api-v2.php
  с телом {"url": "<ссылка подписки>"}; ответ {"encrypted_link": "happ://crypt5/…"}
  (при ошибке — {"error": "…"}). Принимаем только happ://crypt5/.
  .env: HAPP_CRYPTO_API — свой список эндпоинтов через запятую (по умолч. api-v2, затем api-v3).

Incy — incy://crypt1/<base64url(iv | ciphertext | tag)>
  Официальная документация: https://docs.incy.cc/en/deep-links/
  Шифрование локально (AES-256-GCM) официальной библиотекой INCY
  github.com/INCY-DEV/incy-link-encoder (Python-порт лежит рядом: incy_link_encoder/).

Открытая ссылка подписки в incy:// / happ:// больше не уходит — только зашифрованная.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request

APP_SCHEMES = ("incy", "happ")

HAPP_PREFIX = "happ://crypt5/"
INCY_PREFIX = "incy://crypt1/"

_HAPP_DEFAULT_ENDPOINTS = (
    "https://crypto.happ.su/api-v2.php",  # из документации Happ
    "https://crypto.happ.su/api-v3.php",  # запасной
)
_HAPP_TIMEOUT = 8.0
_HAPP_MAX_RESPONSE = 64 * 1024
# ссылка подписки у юзера не меняется — не дёргаем API Happ на каждое нажатие
_HAPP_CACHE_TTL = 6 * 3600
_HAPP_CACHE_MAX = 5000
_happ_cache: dict[str, tuple[str, float]] = {}
_happ_lock = threading.Lock()


class AppLinkError(Exception):
    pass


def _check_url(url: str) -> str:
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        raise AppLinkError("bad url")
    return url


def _happ_endpoints() -> list[str]:
    raw = (os.environ.get("HAPP_CRYPTO_API") or "").strip()
    items = [x.strip() for x in raw.split(",") if x.strip()] if raw else list(_HAPP_DEFAULT_ENDPOINTS)
    return [x for x in items if x.startswith("https://")]


def _valid_happ_link(link: str) -> bool:
    if not isinstance(link, str) or not link.startswith(HAPP_PREFIX) or len(link) <= len(HAPP_PREFIX):
        return False
    return not any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in link)


def _parse_happ_response(body: bytes) -> str:
    text = body.decode("utf-8", "replace").strip()
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    if isinstance(data, dict):
        if data.get("error"):
            raise AppLinkError(f"happ api error: {str(data.get('error'))[:120]}")
        link = data.get("encrypted_link") or data.get("link") or data.get("url") or ""
    elif isinstance(data, str):
        link = data
    else:
        link = text  # на случай ответа простым текстом
    link = str(link).strip()
    if not _valid_happ_link(link):
        raise AppLinkError("happ api: в ответе нет ссылки happ://crypt5/")
    return link


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D401
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def _happ_request(endpoint: str, url: str) -> str:
    req = urllib.request.Request(
        endpoint,
        data=json.dumps({"url": url}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json",
                 "User-Agent": "BatmanVPN/1.0"},
        method="POST",
    )
    try:
        with _opener.open(req, timeout=_HAPP_TIMEOUT) as resp:
            if not (200 <= resp.status < 300):
                raise AppLinkError(f"happ api: http {resp.status}")
            body = resp.read(_HAPP_MAX_RESPONSE + 1)
    except urllib.error.HTTPError as exc:
        raise AppLinkError(f"happ api: http {exc.code}") from None
    except (urllib.error.URLError, OSError) as exc:
        raise AppLinkError(f"happ api: {type(exc).__name__}") from None
    if len(body) > _HAPP_MAX_RESPONSE:
        raise AppLinkError("happ api: слишком большой ответ")
    return _parse_happ_response(body)


def happ_crypt5(url: str) -> str:
    """ссылка подписки → happ://crypt5/… через официальный API Happ (с кэшем)."""
    url = _check_url(url)
    now = time.time()
    with _happ_lock:
        hit = _happ_cache.get(url)
        if hit and now - hit[1] < _HAPP_CACHE_TTL:
            return hit[0]
    errors: list[str] = []
    for endpoint in _happ_endpoints():
        try:
            link = _happ_request(endpoint, url)
        except AppLinkError as exc:
            errors.append(f"{endpoint.rsplit('/', 1)[-1]}: {exc}")
            continue
        with _happ_lock:
            if len(_happ_cache) >= _HAPP_CACHE_MAX:
                _happ_cache.clear()
            _happ_cache[url] = (link, now)
        return link
    # сам url подписки в лог не пишем
    print(f"[applinks] happ crypt5 не получен: {'; '.join(errors) or 'нет эндпоинтов'}", flush=True)
    raise AppLinkError("не удалось зашифровать ссылку для Happ")


def incy_crypt1(url: str, name: str | None = None) -> str:
    """ссылка подписки → incy://crypt1/… (официальный incy-link-encoder, локально)."""
    url = _check_url(url)
    try:
        from incy_link_encoder import encrypt_link  # type: ignore
    except ImportError:  # запуск не из src/api
        from .incy_link_encoder import encrypt_link  # type: ignore
    try:
        link = encrypt_link(url, name=name or None)
    except Exception as exc:  # noqa: BLE001
        print(f"[applinks] incy crypt1: {type(exc).__name__}: {exc}", flush=True)
        raise AppLinkError("не удалось зашифровать ссылку для Incy") from None
    if not link.startswith(INCY_PREFIX):
        raise AppLinkError("incy: неожиданный формат ссылки")
    return link


def build_link(app: str, url: str, name: str | None = None) -> str:
    """incy → incy://crypt1/…, happ → happ://crypt5/…; other / plain / link → сама ссылка подписки."""
    a = (app or "incy").lower()
    if a in ("other", "plain", "link"):
        return url
    if a == "happ":
        return happ_crypt5(url)
    return incy_crypt1(url, name)
