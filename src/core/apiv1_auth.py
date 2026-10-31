# API v1: токены доступа.
#   access  — «bv1.<payload>.<подпись>», HMAC-SHA256, живёт ACCESS_TTL (15 мин), без хранения в БД;
#             при каждом запросе ещё проверяется, что сессия не отозвана (logout, бан, кража refresh).
#   refresh — случайные 48 байт, в БД только sha-256; одноразовый: каждый /auth/refresh выдаёт новый,
#             повторное предъявление старого = утечка → сессия отзывается целиком.
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from typing import Any, Optional

try:
    from . import database as db  # type: ignore
except ImportError:  # pragma: no cover
    import database as db  # type: ignore

TOKEN_PREFIX = "bv1"
AUDIENCE = "api-v1"
ACCESS_TTL = 15 * 60
REFRESH_TTL = 30 * 86400          # скользящий: продлевается при каждом refresh…
REFRESH_ABSOLUTE = 90 * 86400     # …но не дольше 90 дней с входа
MAX_SESSIONS_PER_USER = 10
CLOCK_LEEWAY = 30
MIN_SECRET_LEN = 32


class AuthError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


# ── секрет подписи ──

_key: Optional[bytes] = None
_key_lock = threading.Lock()


def _signing_key() -> bytes:
    """API_TOKEN_SECRET из .env; если не задан — генерируется один раз и хранится в БД (settings)."""
    global _key
    if _key is not None:
        return _key
    with _key_lock:
        if _key is not None:
            return _key
        secret = (os.getenv("API_TOKEN_SECRET") or "").strip()
        if secret and len(secret) < MIN_SECRET_LEN:
            raise RuntimeError(f"API_TOKEN_SECRET короче {MIN_SECRET_LEN} символов")
        if not secret:
            db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('apiv1_token_secret', ?)",
                       (secrets.token_urlsafe(48),))
            secret = db.get_setting("apiv1_token_secret")
            print("[api-v1] API_TOKEN_SECRET не задан в .env — используется секрет из БД", flush=True)
        # отдельный ключ под access-токены (секрет можно переиспользовать под другие цели)
        _key = hmac.new(secret.encode(), b"api-v1/access", hashlib.sha256).digest()
        return _key


def _sign(data: str) -> str:
    return _b64e(hmac.new(_signing_key(), data.encode(), hashlib.sha256).digest())


# ── access-токен ──

def make_access(user_id: int, sid: str, now: Optional[float] = None) -> str:
    now = int(now or time.time())
    payload = _b64e(json.dumps({"u": int(user_id), "s": sid, "aud": AUDIENCE, "iat": now,
                                "exp": now + ACCESS_TTL}, separators=(",", ":")).encode())
    head = f"{TOKEN_PREFIX}.{payload}"
    return f"{head}.{_sign(head)}"


def verify_access(token: str) -> dict[str, Any]:
    """подпись + срок + сессия не отозвана. Возвращает {"user_id", "sid"}."""
    parts = (token or "").split(".")
    if len(parts) != 3 or parts[0] != TOKEN_PREFIX or len(token) > 1024:
        raise AuthError(401, "token_invalid", "Неверный токен")
    head = f"{parts[0]}.{parts[1]}"
    if not hmac.compare_digest(_sign(head), parts[2]):
        raise AuthError(401, "token_invalid", "Неверный токен")
    try:
        p = json.loads(_b64d(parts[1]))
        uid, sid, exp = int(p["u"]), str(p["s"]), int(p["exp"])
    except (ValueError, KeyError, TypeError):
        raise AuthError(401, "token_invalid", "Неверный токен")
    if p.get("aud") != AUDIENCE:
        raise AuthError(401, "token_invalid", "Неверный токен")
    if exp + CLOCK_LEEWAY < time.time():
        raise AuthError(401, "token_expired", "Токен истёк — обновите его через /auth/refresh")
    row = db.fetchone("SELECT user_id, expires_at, revoked_at FROM api_sessions WHERE id = ?", (sid,))
    if not row or row.get("revoked_at") or int(row["user_id"]) != uid or float(row["expires_at"]) < time.time():
        raise AuthError(401, "session_revoked", "Сессия завершена — войдите заново")
    return {"user_id": uid, "sid": sid}


# ── сессии / refresh ──

def _pair(user_id: int, sid: str, refresh: str, now: float, refresh_exp: float) -> dict[str, Any]:
    return {
        "access_token": make_access(user_id, sid, now),
        "token_type": "Bearer",
        "expires_in": ACCESS_TTL,
        "refresh_token": refresh,
        "refresh_expires_in": int(refresh_exp - now),
    }


def create_session(user_id: int, ip: str = "", user_agent: str = "", app_key_id: Optional[int] = None) -> dict[str, Any]:
    now = time.time()
    sid = secrets.token_urlsafe(18)
    refresh = secrets.token_urlsafe(48)
    exp = now + REFRESH_TTL
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO api_sessions (id, user_id, refresh_hash, created_at, expires_at, last_used_at, ip, user_agent) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (sid, int(user_id), _sha(refresh), now, exp, now, (ip or "")[:64], (user_agent or "")[:256]),
        )
        if app_key_id:
            # каким ключом приложения выдана сессия (колонку добавляет apiv1_app.ensure_schema)
            conn.execute("UPDATE api_sessions SET app_key_id = ? WHERE id = ?", (int(app_key_id), sid))
        # не больше MAX_SESSIONS_PER_USER живых сессий: старые отзываем
        conn.execute(
            "UPDATE api_sessions SET revoked_at = ?, revoke_reason = 'too_many_sessions' "
            "WHERE user_id = ? AND revoked_at IS NULL AND id NOT IN "
            "(SELECT id FROM api_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT ?)",
            (now, int(user_id), int(user_id), MAX_SESSIONS_PER_USER),
        )
        # мусор: давно истёкшие / отозванные
        conn.execute("DELETE FROM api_sessions WHERE expires_at < ? OR revoked_at < ?", (now - 86400, now - 7 * 86400))
    return _pair(user_id, sid, refresh, now, exp)


def refresh_session(refresh: str) -> dict[str, Any]:
    if not refresh or len(refresh) > 256:
        raise AuthError(401, "refresh_invalid", "Неверный refresh-токен")
    h, now = _sha(refresh), time.time()
    new_refresh = secrets.token_urlsafe(48)
    outcome: dict[str, Any] = {}
    with db.transaction() as conn:
        row = conn.execute("SELECT * FROM api_sessions WHERE refresh_hash = ?", (h,)).fetchone()
        if row is None:
            stolen = conn.execute("SELECT id FROM api_sessions WHERE prev_refresh_hash = ? AND revoked_at IS NULL",
                                  (h,)).fetchone()
            if stolen:
                # старый refresh предъявлен повторно: кто-то из двоих — не владелец
                conn.execute("UPDATE api_sessions SET revoked_at = ?, revoke_reason = 'refresh_reuse' WHERE id = ?",
                             (now, stolen["id"]))
                outcome["reused"] = True
            outcome["error"] = True
        elif row["revoked_at"] or float(row["expires_at"]) < now:
            outcome["error"] = True
        else:
            exp = min(now + REFRESH_TTL, float(row["created_at"]) + REFRESH_ABSOLUTE)
            cur = conn.execute(
                "UPDATE api_sessions SET prev_refresh_hash = refresh_hash, refresh_hash = ?, expires_at = ?, "
                "last_used_at = ? WHERE id = ? AND refresh_hash = ?",
                (_sha(new_refresh), exp, now, row["id"], h),
            )
            if cur.rowcount != 1:
                outcome["error"] = True
            else:
                outcome.update(user_id=int(row["user_id"]), sid=row["id"], exp=exp)
    if outcome.get("error"):
        if outcome.get("reused"):
            raise AuthError(401, "refresh_reused", "Токен уже использован — сессия завершена, войдите заново")
        raise AuthError(401, "refresh_invalid", "Сессия истекла — войдите заново")
    return _pair(outcome["user_id"], outcome["sid"], new_refresh, now, outcome["exp"])


def revoke(sid: str, reason: str = "logout") -> None:
    db.execute("UPDATE api_sessions SET revoked_at = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL",
               (time.time(), reason, sid))


def revoke_user(user_id: int, reason: str = "logout_all") -> int:
    cur = db.execute("UPDATE api_sessions SET revoked_at = ?, revoke_reason = ? "
                     "WHERE user_id = ? AND revoked_at IS NULL", (time.time(), reason, int(user_id)))
    return cur.rowcount or 0
