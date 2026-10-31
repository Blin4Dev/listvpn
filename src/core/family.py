# семейная подписка: одна оплаченная подписка на несколько аккаунтов проекта
"""
Семья — это аккаунт-владелец с активной подпиской и приглашённые участники.
Участники пользуются тем же ключом (подписка одна), но своими аккаунтами:
  • владелец приглашает по @username / почте / ID / ссылке на профиль → приглашение «ждёт»,
  • участник принимает по коду семьи (появляется в /me как family_invite),
  • пока участник в семье и у владельца живая подписка, его /subscription, /devices,
    трафик и главный экран показывают подписку владельца (family.role = member),
  • своя оплаченная подписка всегда важнее семейной: пока она активна, семья не применяется.

Все записи привязаны к проекту (family_members.project_id / family_codes.project_id),
поэтому семья BatmanVPN и семья FGN — разные семьи, участники не пересекаются.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

try:
    from . import database as db  # type: ignore
    from . import projects  # type: ignore
except ImportError:  # pragma: no cover
    import database as db  # type: ignore
    import projects  # type: ignore

CODE_LEN = 8
# без похожих символов: 0/O, 1/I/L
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
DEFAULT_MAX_MEMBERS = 5  # владелец + 4 участника
MAX_MEMBERS_CAP = 20
NOT_FOUND_BY_ID = "Не нашли пользователя с таким ID — пригласите по @username или почте"
INVITE_TTL_DAYS = 30  # непринятое приглашение столько висит и держит место, потом снимается само


class FamilyError(Exception):
    """ошибка с текстом для пользователя (уходит в detail.message)"""

    def __init__(self, message: str, status: int = 400, code: str = "family_error") -> None:
        super().__init__(message)
        self.message = message
        self.status = int(status)
        self.code = code  # машинный код для API v1 (already_in_family, family_full …)


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _parse(raw: Any) -> Optional[datetime]:
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _label(u: Optional[dict[str, Any]]) -> str:
    """имя участника как в приложении: @username, имя, id…, почта"""
    if not u:
        return "Пользователь"
    if u.get("username"):
        return f"@{u['username']}"
    full = " ".join(str(x) for x in (u.get("first_name"), u.get("last_name")) if x).strip()
    if full:
        return full
    if u.get("telegram_id"):
        return f"id{u['telegram_id']}"
    return str(u.get("email") or f"#{u.get('id')}")


def max_members(project_id: Optional[str]) -> int:
    """сколько человек может быть в семье вместе с владельцем (настройка проекта)"""
    try:
        n = int(float(db.get_setting("family_max_members", str(DEFAULT_MAX_MEMBERS), project=project_id)))
    except (TypeError, ValueError):
        n = DEFAULT_MAX_MEMBERS
    return max(2, min(MAX_MEMBERS_CAP, n))


# ── код семьи ──
def normalize_code(raw: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(raw or "").upper())[:32]


def _rand_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))


def _save_code(owner_id: int, project_id: str) -> str:
    for _ in range(10):
        code = _rand_code()
        if db.fetchone("SELECT 1 FROM family_codes WHERE code = ?", (code,)):
            continue
        db.execute(
            "INSERT INTO family_codes (owner_id, project_id, code, created_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(owner_id) DO UPDATE SET code = excluded.code, created_at = excluded.created_at",
            (int(owner_id), project_id, code, _now()),
        )
        return code
    raise FamilyError("Не удалось создать код семьи. Попробуйте ещё раз.", 500)


def code_for(owner_id: int, project_id: Optional[str] = None) -> str:
    """постоянный код семьи владельца (создаётся при первом обращении)"""
    row = db.fetchone("SELECT code, project_id FROM family_codes WHERE owner_id = ?", (int(owner_id),))
    if row and row.get("code"):
        return str(row["code"])
    return _save_code(int(owner_id), str(project_id or projects.DEFAULT))


def rotate_code(owner_id: int, project_id: Optional[str] = None) -> str:
    """«Заменить код семьи»: старый код перестаёт работать"""
    return _save_code(int(owner_id), str(project_id or projects.DEFAULT))


# ── персональный токен приглашения ──
# Мастер-код семьи — секрет владельца: он даёт вход кому угодно и до конца мест.
# Приглашённому отдаём одноразовый токен, привязанный к его записи: по нему входят только он
# (чужой аккаунт тот же токен использовать не сможет, потому что `join` сверяет токен со СВОИМИ
# приглашениями), и мастер-код при этом не утекает.
INVITE_PREFIX = "IV"
INVITE_LEN = 10


_INVITE_KEYS: dict[str, tuple[str, bytes]] = {}


def _invite_seed(project_id: str) -> str:
    try:
        seed = projects.get(project_id).bot_token or ""
    except Exception:  # noqa: BLE001
        seed = ""
    return seed or os.getenv("INTERNAL_API_SECRET") or ""


def _invite_key(project_id: str) -> bytes:
    """ключ HMAC: токен бота проекта (стабилен, пока бот не заменён), иначе секрет установки.

    Без секрета токен был бы предсказуем — тогда персональный вход в семью не выдаём вовсе.
    """
    pid = str(project_id or projects.DEFAULT)
    seed = _invite_seed(pid)
    if not seed:
        raise FamilyError("Приглашения в семью временно недоступны", 503)
    cached = _INVITE_KEYS.get(pid)
    # seed сверяем: сменили бота в панели — старые токены перестают действовать
    if cached is not None and cached[0] == seed:
        return cached[1]
    key = hashlib.sha256(b"listvpn:family-invite:" + seed.encode("utf-8")).digest()
    _INVITE_KEYS[pid] = (seed, key)
    return key


def invite_available(project_id: Optional[str] = None) -> bool:
    """можно ли выдавать персональные токены приглашений (нужен секрет проекта)"""
    try:
        _invite_key(str(project_id or projects.DEFAULT))
        return True
    except FamilyError:
        return False


def invite_token(row_id: int, project_id: str, subject: Any) -> str:
    """токен приглашения для записи family_members (не хранится: считается из id записи)."""
    msg = f"{int(row_id)}|{str(subject or '').strip().lower()}".encode("utf-8")
    digest = hmac.new(_invite_key(str(project_id or projects.DEFAULT)), msg, hashlib.sha256).digest()
    body = base64.b32encode(digest).decode("ascii").rstrip("=")[:INVITE_LEN]
    return INVITE_PREFIX + body


def _invite_subject(row: dict[str, Any]) -> str:
    """к чему привязан токен: id аккаунта, а для приглашения по почте/@username — сам запрос."""
    if row.get("member_id"):
        return str(int(row["member_id"]))
    return str(row.get("invite_query") or "").strip().lower()


def _token_owner_id(user: dict[str, Any], token: str, project_id: str) -> Optional[int]:
    """владелец по персональному токену приглашения этого аккаунта (None — не наш токен)."""
    uid = int(user["id"])
    cands = [c.lower() for c in _candidates(user)]
    marks = ", ".join("?" for _ in cands)
    rows = db.fetchall(
        "SELECT id, owner_id, member_id, invite_query, project_id FROM family_members "
        "WHERE status = 'pending' AND created_at >= ? AND project_id = ? AND "
        f"(member_id = ? OR (member_id IS NULL AND lower(invite_query) IN ({marks})))",
        (_stale_before(), project_id, uid, *cands),
    )
    for row in rows:
        expected = invite_token(int(row["id"]), str(row.get("project_id") or project_id),
                                _invite_subject(row))
        if hmac.compare_digest(expected, token):
            return int(row["owner_id"])
    return None


# ── кто есть кто ──
def _stale_before() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=INVITE_TTL_DAYS)).replace(microsecond=0).isoformat()


def purge_stale(owner_id: Optional[int] = None) -> int:
    """снять истёкшие непринятые приглашения (чтобы не держали место); активных не трогаем."""
    sql = "DELETE FROM family_members WHERE status = 'pending' AND created_at < ?"
    params: tuple = (_stale_before(),)
    if owner_id is not None:
        sql += " AND owner_id = ?"
        params += (int(owner_id),)
    return int(db.execute(sql, params).rowcount or 0)


def cleanup_orphans(owner_id: Optional[int] = None) -> int:
    """удалить записи удалённых аккаунтов (у member_id нет внешнего ключа)."""
    sql = ("DELETE FROM family_members WHERE member_id IS NOT NULL "
           "AND member_id NOT IN (SELECT id FROM users)")
    params: tuple = ()
    if owner_id is not None:
        sql += " AND owner_id = ?"
        params = (int(owner_id),)
    return int(db.execute(sql, params).rowcount or 0)


def has_members(owner_id: int) -> bool:
    """у аккаунта есть своя семья (участники или непринятые приглашения)."""
    return _seats_taken(owner_id) > 0


# ── подписки ──
def has_live_sub(user_id: int) -> bool:
    """есть ли у аккаунта своя действующая подписка (та же логика, что в /subscription)"""
    rows = db.fetchall(
        "SELECT expires_at FROM subscriptions WHERE user_id = ? AND status = 'Active'",
        (int(user_id),),
    )
    now = datetime.now(timezone.utc)
    for r in rows:
        exp = _parse(r.get("expires_at"))
        if not exp or exp > now:
            return True
    return False


def has_paid_sub(user_id: int) -> bool:
    """действующая ПЛАТНАЯ подписка — только её можно раздать семье (пробную не делим)."""
    rows = db.fetchall(
        "SELECT expires_at, type FROM subscriptions WHERE user_id = ? AND status = 'Active'",
        (int(user_id),),
    )
    now = datetime.now(timezone.utc)
    for r in rows:
        if str(r.get("type") or "vpn") == "trial":
            continue
        exp = _parse(r.get("expires_at"))
        if not exp or exp > now:
            return True
    return False


def member_ids(owner_id: int) -> list[int]:
    """активные участники семьи владельца"""
    rows = db.fetchall(
        "SELECT member_id FROM family_members WHERE owner_id = ? AND status = 'active' AND member_id IS NOT NULL",
        (int(owner_id),),
    )
    return [int(r["member_id"]) for r in rows]


def active_owner_id(member_id: int) -> Optional[int]:
    """владелец семьи, в которой состоит аккаунт (None — не в семье)"""
    row = db.fetchone(
        "SELECT owner_id FROM family_members WHERE member_id = ? AND status = 'active' LIMIT 1",
        (int(member_id),),
    )
    return int(row["owner_id"]) if row else None


# ── участники ──
def _member_name(row: dict[str, Any]) -> str:
    if row.get("member_id"):
        return _label(row)
    raw = str(row.get("invite_query") or "").strip()
    if not raw:
        return "Приглашение"
    if "@" in raw[1:] or re.fullmatch(r"[A-Za-z0-9_]{3,}", raw):
        return raw if raw.startswith("@") or "@" in raw else f"@{raw}"
    return raw


def members(owner_id: int) -> list[dict[str, Any]]:
    """участники и живые приглашения (протухшие не показываем)"""
    rows = db.fetchall(
        "SELECT f.id, f.member_id, f.status, f.invite_query, f.created_at, "
        "       u.username, u.first_name, u.last_name, u.email, u.telegram_id "
        "FROM family_members f LEFT JOIN users u ON u.id = f.member_id "
        "WHERE f.owner_id = ? AND (f.status != 'pending' OR f.created_at >= ?) "
        "ORDER BY CASE f.status WHEN 'active' THEN 0 ELSE 1 END, f.id",
        (int(owner_id), _stale_before()),
    )
    return [
        {
            "id": int(r["id"]),
            "name": _member_name(r),
            "status": "active" if str(r.get("status")) == "active" else "pending",
        }
        for r in rows
    ]


def _seats_taken(owner_id: int) -> int:
    """сколько мест занято; протухшие приглашения мест уже не держат"""
    row = db.fetchone(
        "SELECT COUNT(*) AS n FROM family_members WHERE owner_id = ? "
        "AND NOT (status = 'pending' AND created_at < ?)",
        (int(owner_id), _stale_before()),
    )
    return int(row["n"]) if row else 0


def _room(project_id: Optional[str]) -> int:
    return max_members(project_id) - 1  # одно место — владельцу


def _no_room(limit: int) -> FamilyError:
    return FamilyError(f"В семье уже максимум участников ({limit}). Удалите кого-нибудь, чтобы добавить нового.",
                       code="family_full")


def _insert_member(project_id: str, owner_id: int, member_id: Optional[int], invite_query: Optional[str],
                   status: str, accepted_at: Optional[str] = None) -> bool:
    """вставка с проверкой свободного места в одном запросе: False — мест нет.

    Отдельная проверка + INSERT гоняются на разных соединениях, поэтому условие
    встроено в сам INSERT: место проверяется и занимается атомарно.
    """
    limit = _room(project_id)
    cur = db.execute(
        "INSERT INTO family_members (project_id, owner_id, member_id, invite_query, status, created_at, accepted_at) "
        "SELECT ?, ?, ?, ?, ?, ?, ? WHERE ("
        "  SELECT COUNT(*) FROM family_members WHERE owner_id = ? "
        "  AND NOT (status = 'pending' AND created_at < ?)"
        ") < ?",
        (project_id, int(owner_id), member_id, invite_query, status, _now(), accepted_at,
         int(owner_id), _stale_before(), limit),
    )
    return int(cur.rowcount or 0) > 0


def _candidates(user: dict[str, Any]) -> list[str]:
    out = [str(user.get("id"))]
    if user.get("telegram_id"):
        out.append(str(user["telegram_id"]))
    if user.get("username"):
        uname = str(user["username"]).lower()
        out += [uname, f"@{uname}", f"https://t.me/{uname}"]
    if user.get("email"):
        out.append(str(user["email"]).lower())
    return list(dict.fromkeys(x for x in out if x))


def _find_user(project_id: str, query: str) -> Optional[dict[str, Any]]:
    q = query.strip()
    if not q:
        return None
    if q.isdigit():
        row = db.fetchone("SELECT * FROM users WHERE id = ? AND project_id = ?", (int(q), project_id))
        if row:
            return row
        return db.fetchone("SELECT * FROM users WHERE telegram_id = ? AND project_id = ?", (int(q), project_id))
    low = q.lower()
    if re.fullmatch(r"https?://(t\.me|telegram\.me)/[A-Za-z0-9_]+/?", low):
        uname = low.rstrip("/").rsplit("/", 1)[-1]
        return db.fetchone("SELECT * FROM users WHERE lower(username) = ? AND project_id = ?", (uname, project_id))
    if "@" in low[1:] and "." in low.rsplit("@", 1)[-1]:
        return db.fetchone("SELECT * FROM users WHERE lower(email) = ? AND project_id = ?", (low, project_id))
    uname = low.lstrip("@")
    return db.fetchone("SELECT * FROM users WHERE lower(username) = ? AND project_id = ?", (uname, project_id))


def _check_owner(owner_id: int) -> dict[str, Any]:
    """владелец может звать в семью: не забанен, есть живая подписка, сам не участник чужой семьи."""
    owner = db.fetchone("SELECT * FROM users WHERE id = ?", (int(owner_id),))
    if not owner:
        raise FamilyError("Пользователь не найден", 404)
    if owner.get("is_banned"):
        raise FamilyError("Аккаунт заблокирован", 403)
    if active_owner_id(int(owner_id)) is not None:
        raise FamilyError("Вы сами участник семьи — сначала выйдите из неё")
    if not has_paid_sub(int(owner_id)):
        raise FamilyError("Сначала оформите подписку — приглашать можно при активной подписке")
    return owner


def add_member(owner_id: int, project_id: str, query: str) -> Optional[dict[str, Any]]:
    """пригласить в семью: @username, почта, ID, telegram id или ссылка на профиль.

    Возвращает аккаунт приглашённого (если он уже есть) — чтобы отправить ему сообщение.
    """
    q = str(query or "").strip()
    if len(q) < 2:
        raise FamilyError("Укажите @username, почту или ID пользователя")
    if len(q) > 120:
        raise FamilyError("Слишком длинный запрос")
    _check_owner(int(owner_id))
    target = _find_user(project_id, q)
    if target is not None:
        tid = int(target["id"])
        if tid == int(owner_id):
            raise FamilyError("Это вы — пригласите другого пользователя")
        in_family = active_owner_id(tid)
        if in_family == int(owner_id):
            raise FamilyError("Этот пользователь уже в вашей семье")
        # статус чужого аккаунта (бан, своя подписка, другая семья) не раскрываем:
        # такой аккаунт обрабатываем как «не найден» — приглашение по запросу, без сообщения
        if target.get("is_banned") or in_family is not None or has_members(tid) or has_live_sub(tid):
            target = None
    if target is None and q.isdigit():
        # приглашение по номеру, которого нет, досталось бы случайному будущему аккаунту
        raise FamilyError(NOT_FOUND_BY_ID)
    if target is not None:
        tid = int(target["id"])
        code_for(int(owner_id), project_id)  # у владельца с участниками всегда есть код
        with db.transaction():
            row = db.fetchone(
                "SELECT id, status FROM family_members WHERE owner_id = ? AND member_id = ?",
                (int(owner_id), tid),
            )
            if row:
                # уже приглашён — продлеваем срок, чтобы приглашение не протухло
                db.execute("UPDATE family_members SET invite_query = ?, created_at = ? WHERE id = ?",
                           (q, _now(), row["id"]))
                return target
            if not _insert_member(project_id, int(owner_id), tid, q, "pending"):
                raise _no_room(_room(project_id))
        return target

    # такого аккаунта ещё нет: приглашение «по логину/почте» — подхватится при входе
    code_for(int(owner_id), project_id)
    with db.transaction():
        dup = db.fetchone(
            "SELECT id FROM family_members WHERE owner_id = ? AND member_id IS NULL AND lower(invite_query) = ?",
            (int(owner_id), q.lower()),
        )
        if dup:
            db.execute("UPDATE family_members SET created_at = ? WHERE id = ?", (_now(), dup["id"]))
            return None
        if not _insert_member(project_id, int(owner_id), None, q, "pending"):
            raise _no_room(_room(project_id))
    return None


def remove_member(owner_id: int, key: Any) -> Optional[dict[str, Any]]:
    """убрать участника или отменить приглашение (key — id записи или id пользователя).

    Возвращает аккаунт убранного участника (для сообщения), иначе None.
    """
    raw = str(key or "").strip()
    if not raw.isdigit():
        raise FamilyError("Не указан участник")
    num = int(raw)
    # id записи приоритетнее: иначе id строки может совпасть с чужим member_id
    # и удалится не тот участник
    row = db.fetchone(
        "SELECT id, member_id, status FROM family_members WHERE owner_id = ? AND (id = ? OR member_id = ?) "
        "ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1",
        (int(owner_id), num, num, num),
    )
    if not row:
        raise FamilyError("Участник не найден", 404)
    db.execute("DELETE FROM family_members WHERE id = ?", (int(row["id"]),))
    cleanup_orphans(int(owner_id))
    if not row.get("member_id"):
        return None
    member = db.fetchone("SELECT * FROM users WHERE id = ?", (int(row["member_id"]),))
    if member is not None:
        # был ли он уже участником (тогда у него есть ссылка на подписку — её надо отозвать)
        member["family_was_active"] = str(row.get("status")) == "active"
    return member


def leave(member_id: int) -> Optional[int]:
    """выйти из семьи (подписка владельца больше не действует для этого аккаунта).

    Возвращает id владельца (None — аккаунт не был в семье).
    """
    row = db.fetchone(
        "SELECT id, owner_id FROM family_members WHERE member_id = ? AND status = 'active' LIMIT 1",
        (int(member_id),),
    )
    if not row:
        return None
    db.execute("DELETE FROM family_members WHERE id = ?", (int(row["id"]),))
    return int(row["owner_id"])


def join(user: dict[str, Any], raw_code: Any) -> dict[str, Any]:
    """войти в семью по коду владельца или по персональному токену приглашения.

    Возвращает {owner_id, owner_name, code}.
    """
    code = normalize_code(raw_code)
    if len(code) < 4:
        raise FamilyError("Введите код семьи", code="code_required")
    project_id = projects.of(user)
    uid = int(user["id"])
    row = db.fetchone("SELECT owner_id, project_id FROM family_codes WHERE code = ?", (code,))
    if row and str(row.get("project_id") or projects.DEFAULT) == project_id:
        owner_id = int(row["owner_id"])
    else:
        # не мастер-код: возможно, это персональный токен из приглашения
        found = _token_owner_id(user, code, project_id)
        if found is None:
            raise FamilyError("Код не найден. Проверьте, что он введён верно", 404, "code_not_found")
        owner_id = found
    if owner_id == uid:
        raise FamilyError("Это ваш код — вы уже владелец семьи", 409, "already_in_family")
    owner = db.fetchone("SELECT * FROM users WHERE id = ?", (owner_id,))
    if not owner or owner.get("is_banned") or projects.of(owner) != project_id:
        raise FamilyError("Семья недоступна", code="family_unavailable")
    if not has_paid_sub(owner_id):
        raise FamilyError("У владельца семьи сейчас нет активной подписки", code="owner_no_subscription")

    current = active_owner_id(uid)
    if current == owner_id:
        return {"owner_id": owner_id, "owner_name": _label(owner), "code": code}
    if current is not None:
        raise FamilyError("Вы уже состоите в семье — сначала выйдите из неё", 409, "in_other_family")
    if has_members(uid):
        raise FamilyError("У вас своя семья — сначала удалите из неё участников", 409, "has_own_family")
    if has_live_sub(uid):
        raise FamilyError("У вас есть своя активная подписка — она важнее семейной", 409, "has_own_subscription")

    cands = _candidates(user)
    low = [c.lower() for c in cands]
    marks = ", ".join("?" for _ in cands)
    try:
        with db.transaction():
            # приглашение этого владельца (по id или по логину/почте) превращаем в участие
            invite = db.fetchone(
                "SELECT id FROM family_members WHERE owner_id = ? AND status = 'pending' AND created_at >= ? AND "
                f"(member_id = ? OR (member_id IS NULL AND lower(invite_query) IN ({marks}))) "
                "ORDER BY CASE WHEN member_id = ? THEN 0 ELSE 1 END, id LIMIT 1",
                (owner_id, _stale_before(), uid, *low, uid),
            )
            if invite:
                db.execute(
                    "UPDATE family_members SET member_id = ?, status = 'active', accepted_at = ? WHERE id = ?",
                    (uid, _now(), int(invite["id"])),
                )
            else:
                # место проверяется и занимается одним запросом: иначе два одновременных
                # входа оба увидят свободное место
                if not _insert_member(project_id, owner_id, uid, None, "active", _now()):
                    raise _no_room(_room(project_id))
            # прочие непринятые приглашения этому аккаунту больше не нужны
            db.execute(
                "DELETE FROM family_members WHERE status = 'pending' AND owner_id != ? AND "
                f"(member_id = ? OR (member_id IS NULL AND lower(invite_query) IN ({marks})))",
                (owner_id, uid, *low),
            )
    except sqlite3.IntegrityError:
        # параллельный вход того же аккаунта уже создал активную запись
        raise FamilyError("Вы уже в семье", 409, "already_in_family") from None
    return {"owner_id": owner_id, "owner_name": _label(owner), "code": code}


def pending_invite(user: dict[str, Any]) -> Optional[dict[str, Any]]:
    """непринятое приглашение в семью для этого аккаунта: {code, from_name, family_id}.

    В `code` — персональный токен приглашения (не мастер-код семьи): его хватает, чтобы войти,
    но поделиться им с третьим лицом нельзя — токен привязан к этому аккаунту/запросу.
    """
    if active_owner_id(int(user["id"])) is not None:
        return None  # уже в семье
    if has_live_sub(int(user["id"])):
        return None  # своя подписка важнее — приглашение не предлагаем
    project_id = projects.of(user)
    cands = [c.lower() for c in _candidates(user)]
    marks = ", ".join("?" for _ in cands)
    row = db.fetchone(
        "SELECT f.id, f.owner_id, f.project_id, f.member_id, f.invite_query, "
        "       u.username, u.first_name, u.last_name, u.email, u.telegram_id, u.id AS uid "
        "FROM family_members f JOIN users u ON u.id = f.owner_id "
        f"WHERE f.status = 'pending' AND f.created_at >= ? AND f.project_id = ? AND (f.member_id = ? OR "
        f"(f.member_id IS NULL AND lower(f.invite_query) IN ({marks}))) AND COALESCE(u.is_banned, 0) = 0 "
        "ORDER BY f.id DESC LIMIT 1",
        (_stale_before(), project_id, int(user["id"]), *cands),
    )
    if not row:
        return None
    owner_id = int(row["owner_id"])
    if not has_paid_sub(owner_id):
        return None  # владелец без платной подписки — приглашение не показываем
    if not invite_available(str(row.get("project_id") or project_id)):
        return None  # нечем подписать токен — не показываем битое приглашение
    return {
        "code": invite_token(int(row["id"]), str(row.get("project_id") or project_id), _invite_subject(row)),
        "from_name": _label(row),
        "family_id": int(row["id"]),
        "owner_id": owner_id,
    }