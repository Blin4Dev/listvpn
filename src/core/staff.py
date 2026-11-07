from __future__ import annotations

import json
import re
from typing import Any, Optional

try:
    from . import database as db
except ImportError:  # pragma: no cover
    import database as db  # type: ignore


ROLES = {"admin": "Администратор", "curator": "Куратор", "operator": "Оператор"}

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
PASSWORD_MIN = 10
PASSWORD_MAX = 128

# оператору нельзя даже на «своём»: деньги, merge, удаление
OPERATOR_FORBIDDEN_ACTIONS = {
    "ADD_BALANCE", "SUB_BALANCE", "SET_PARTNER_RATE", "SET_PARTNER_BALANCE", "ADD_PARTNER_BALANCE",
    "SUB_PARTNER_BALANCE", "SET_TELEGRAM_ID", "SET_EMAIL", "DELETE_USER",
}


class StaffError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


# доступ: any / curator / manage (оператор с тикетом этого uid); иначе владелец

R = "GET"
_USER_VIEW = r"/users/\d+(?:/detail|/payments|/subscriptions|/referrals|/remnawave)?"

ROUTES: list[tuple[set[str], re.Pattern, str]] = [
    (set(m.split()), re.compile(f"^{p}$"), rule) for m, p, rule in [
        (R, r"/auth/me", "any"),

        (R, r"/users", "any"),
        (R, _USER_VIEW, "any"),
        (R, r"/users/(?P<uid>\d+)/exchange", "manage"),
        ("POST", r"/users/(?P<uid>\d+)/(?:action|exchange|hwid/unlink|referrals/\d+/unlink)", "manage"),
        # компенсация: одному — любой сотрудник (и поддержка), всем — куратор (и владелец)
        ("POST", r"/users/\d+/compensate", "any"),
        ("POST", r"/users/mass-compensate", "curator"),
        (R, r"/users/\d+/transfer", "curator"),
        ("POST", r"/users/\d+/transfer", "curator"),
        (R, r"/users/(?P<uid>\d+)/can-manage", "any"),
        (R, r"/keys", "curator"),                 # ключи с uuid: не операторам
        ("POST", r"/keys(?:/\d+/block)?", "curator"),

        (R, r"/support/chats", "any"),
        (R, r"/support/unread", "any"),
        (R, r"/support/chats/\d+", "any"),
        ("POST", r"/support/chats/\d+/(?:read|start|close|upload|messages|pool|escalate|wait)", "any"),
        ("POST", r"/support/chats/\d+/reopen", "curator"),   # переоткрыть — куратор (и владелец)
        # своё сообщение (своё+48ч внутри)
        ("POST", r"/support/chats/\d+/messages/\d+/edit", "any"),
        ("DELETE", r"/support/chats/\d+/messages/\d+", "any"),

        (R, r"/team-chat", "any"),                 # team chat
        (R, r"/team-chat/unread", "any"),
        (R, r"/team-chat/members", "any"),         # список для @упоминаний
        ("POST", r"/team-chat/(?:messages|read|messages/\d+/edit)", "any"),
        ("DELETE", r"/team-chat/messages/\d+", "any"),  # своё; чужое - владелец

        (R, r"/staff", "curator"),                 # кураторам краткий список
        (R, r"/staff/\d+/schedule", "curator"),
        (R, r"/staff/\d+/fines", "curator"),
        ("POST", r"/staff/\d+/fines", "curator"),
        ("DELETE", r"/staff/fines/\d+", "curator"),  # только свой штраф

        (R, r"/me/salary", "any"),
        (R, r"/push/key", "any"),
        ("POST", r"/push/(?:subscribe|unsubscribe|test)", "any"),
    ]
]


def match_route(method: str, sub: str) -> Optional[tuple[str, dict[str, str]]]:
    """(правило, группы из пути) или None, если путь сотрудникам не открыт."""
    method = "GET" if method.upper() == "HEAD" else method.upper()
    for methods, rx, rule in ROUTES:
        if method in methods:
            m = rx.match(sub)
            if m:
                return rule, {k: v for k, v in m.groupdict().items() if v is not None}
    return None


def get(staff_id: int) -> Optional[dict[str, Any]]:
    return db.fetchone("SELECT * FROM panel_staff WHERE id = ?", (int(staff_id),))


def by_username(username: str) -> Optional[dict[str, Any]]:
    return db.fetchone("SELECT * FROM panel_staff WHERE username = ?", (str(username or "").strip().lower(),))


def role_of(s: dict[str, Any]) -> str:
    r = str(s.get("role") or "")
    return r if r in ROLES else "operator"


def public(s: dict[str, Any]) -> dict[str, Any]:
    """Без хэша и соли пароля."""
    iv: list = []
    raw = s.get("default_intervals")
    if raw:
        try:
            parsed = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(parsed, list):
                iv = parsed
        except (TypeError, ValueError):
            iv = []
    return {
        "id": s["id"], "username": s["username"], "name": s.get("name") or "", "telegram_id": s["telegram_id"],
        "role": role_of(s), "is_active": bool(s.get("is_active")),
        "permissions": admin_access(s) if role_of(s) == "admin" else None,
        "default_pay": float(s.get("default_pay") or 0),
        "default_intervals": iv,
        "created_at": s.get("created_at"), "updated_at": s.get("updated_at"),
        "last_login_at": s.get("last_login_at"), "last_login_ip": s.get("last_login_ip"),
    }


def display_name(s: dict[str, Any]) -> str:
    return (s.get("name") or "").strip() or s["username"]


def validate_role(role: Any) -> str:
    r = str(role or "")
    if r not in ROLES:
        raise StaffError("Роль: администратор, куратор или оператор")
    return r


def validate_username(username: str, owner_username: str) -> str:
    u = str(username or "").strip().lower()
    if not USERNAME_RE.fullmatch(u):
        raise StaffError("Логин: 3–32 символа, латиница, цифры, «.», «_», «-»")
    if owner_username and u == str(owner_username).strip().lower():
        raise StaffError("Этот логин занят")
    return u


def validate_password(pw: str) -> str:
    pw = str(pw or "")
    if len(pw) < PASSWORD_MIN:
        raise StaffError(f"Пароль — не короче {PASSWORD_MIN} символов")
    if len(pw) > PASSWORD_MAX:
        raise StaffError("Слишком длинный пароль")
    if pw.strip() != pw:
        raise StaffError("Пароль не должен начинаться или заканчиваться пробелом")
    return pw


def validate_tg(tg: Any) -> int:
    try:
        v = int(str(tg).strip())
    except (TypeError, ValueError):
        raise StaffError("Telegram ID — число (узнать можно у @userinfobot)")
    if not 0 < v < 10 ** 13:
        raise StaffError("Неверный Telegram ID")
    return v


def validate_name(name: Any) -> str:
    try:
        from . import names  # type: ignore
    except ImportError:  # pragma: no cover
        import names  # type: ignore
    n = re.sub(r"[<>&\"]", "", names.display_name(name, 80)).strip()
    if len(n) > 40:
        raise StaffError("Имя — до 40 символов")
    return n



# ── администраторы: доступ по отдельным правам + к выбранным проектам ──
# scope: project — данные открытого проекта (проверяется, что проект разрешён); network — общее на всю сеть.
# routes — пути (без /api/panel), которые открывает право. Путь может открываться несколькими правами.

USER_ACTIONS: list[tuple[str, str]] = [
    ("EXTEND_ALL", "Продлить подписку"),
    ("EXTEND_SUB", "Продлить отдельную подписку"),
    ("REDUCE_SUB", "Уменьшить срок"),
    ("SET_TRAFFIC", "Лимит трафика"),
    ("ADD_TRAFFIC", "Добавить трафик"),
    ("SUB_TRAFFIC", "Убавить трафик"),
    ("SET_DEVICES", "Лимит устройств"),
    ("BAN", "Заблокировать аккаунт"),
    ("UNBAN", "Разблокировать аккаунт"),
    ("BLOCK_KEY", "Заблокировать ключ"),
    ("UNBLOCK_KEY", "Разблокировать ключ"),
    ("SET_NO_RENEW", "Запрет продления"),
    ("RESET_SUB", "Сбросить подписку (новый ключ)"),
    ("NOTIFY", "Написать пользователю"),
    ("SET_PARTNER_RATE", "Процент реферала"),
    ("SET_PARTNER_BALANCE", "Установить реф. баланс"),
    ("ADD_PARTNER_BALANCE", "Начислить на реф. баланс"),
    ("SUB_PARTNER_BALANCE", "Списать с реф. баланса"),
    ("SET_TELEGRAM_ID", "Изменить Telegram ID"),
    ("UNBIND_TELEGRAM", "Отвязать Telegram"),
    ("SET_EMAIL", "Изменить email"),
    ("UNBIND_EMAIL", "Отвязать email"),
    ("RESET_TRIAL", "Сбросить пробный период"),
    ("APPLY_PROMO", "Выдать промокод"),
    ("REMOVE_PROMO", "Снять скидку"),
    ("DELETE_USER", "Удалить аккаунт"),
]
USER_ACTION_KEYS = {a for a, _ in USER_ACTIONS}

_UID = r"/users/\d+"
_NODE = r"/monitoring/nodes/\d+"

# (группа, ключ, название, scope, [(методы, путь[, свой scope])])
ADMIN_PERMS: list[tuple[str, str, str, str, list[tuple]]] = [
    ("Главное", "dashboard.view", "Главная и статистика", "project", [
        ("GET", r"/dashboard"), ("GET", r"/statistics(?:/full)?"), ("GET", r"/stats/summary")]),
    ("Главное", "finance.view", "Финансы: платежи и транзакции", "project", [
        ("GET", r"/finance/stats"), ("GET", r"/payments"), ("GET", r"/transactions"),
        ("GET", r"/payments/[A-Za-z0-9_-]{1,80}/refund-check")]),
    ("Главное", "finance.refund", "Возвраты и чарджбэки", "project", [
        ("POST", r"/payments/[A-Za-z0-9_-]{1,80}/(?:refund|chargeback)")]),

    ("Пользователи", "users.view", "Просмотр пользователей", "project", [
        ("GET", r"/users"), ("GET", _UID + r"(?:/detail|/payments|/subscriptions|/referrals|/remnawave|/can-manage)?")]),
    ("Пользователи", "users.devices", "Устройства: отвязка HWID, обмен устройств на дни", "project", [
        ("POST", _UID + r"/hwid/unlink"), ("GET POST", _UID + r"/exchange")]),
    ("Пользователи", "users.transfer", "Перенос подписки на другой аккаунт", "project", [
        ("GET POST", _UID + r"/transfer"), ("GET", r"/users")]),
    ("Пользователи", "users.compensate", "Компенсация пользователю", "project", [("POST", _UID + r"/compensate")]),
    ("Пользователи", "users.family", "Убрать из семьи", "project", [("DELETE", _UID + r"/family")]),
    ("Пользователи", "users.referrals", "Отвязать реферала", "project", [("POST", _UID + r"/referrals/\d+/unlink")]),
    ("Пользователи", "users.mass", "Массовые действия (всем пользователям)", "project", [
        ("POST", r"/users/mass-action"), ("POST", r"/users/mass-compensate")]),
    ("Пользователи", "users.keys", "Ключи (список, выдача, блокировка)", "project", [
        ("GET POST", r"/keys"), ("POST", r"/keys/\d+/block")]),
    ("Пользователи", "withdrawals.view", "Выводы: просмотр", "project", [("GET", r"/withdrawals")]),
    ("Пользователи", "withdrawals.manage", "Выводы: одобрить, выплатить, отклонить", "project", [
        ("POST", r"/withdrawals/\d+/(?:approve|complete|reject)")]),
    ("Пользователи", "resale.view", "Ресейл: просмотр", "network", [
        ("GET", r"/resale"), ("GET", r"/resale/migrations/\d+/users")]),
    ("Пользователи", "resale.manage", "Ресейл: сканирование и переносы", "network", [
        ("POST", r"/resale/(?:scan|migrate)"), ("POST", r"/resale/migrations/\d+/(?:cancel|info-url)")]),

    # список общий на сеть (фильтруется по проектам администратора), чат — проекта пользователя
    ("Поддержка", "support", "Поддержка: все обращения, ответы, переоткрытие", "network", [
        ("GET", r"/support/(?:chats|unread|storage)"), ("GET", r"/support/chats/\d+", "project"),
        ("POST", r"/support/chats/\d+/(?:read|start|close|upload|messages|pool|escalate|wait|reopen)", "project"),
        ("POST", r"/support/chats/\d+/messages/\d+/edit", "project"),
        ("DELETE", r"/support/chats/\d+/messages/\d+", "project")]),

    ("Маркетинг", "mailing.view", "Рассылка: история и статистика", "project", [
        ("GET", r"/mailing/(?:history|stats)")]),
    ("Маркетинг", "mailing.send", "Рассылка: отправка и удаление", "project", [
        ("POST", r"/mailing"), ("DELETE", r"/mailing/\d+")]),
    ("Маркетинг", "promocodes.view", "Промокоды: просмотр", "project", [("GET", r"/promocodes(?:/stats)?")]),
    ("Маркетинг", "promocodes.manage", "Промокоды: создание и изменение", "project", [
        ("POST", r"/promocodes"), ("PUT DELETE", r"/promocodes/\d+")]),
    ("Маркетинг", "gifts.view", "Подарки: просмотр", "project", [("GET", r"/gifts")]),
    ("Маркетинг", "gifts.manage", "Подарки: выдача и отзыв", "project", [("POST", r"/gifts(?:/revoke)?")]),
    ("Маркетинг", "promotions.view", "Акции: просмотр", "project", [("GET", r"/promotions")]),
    ("Маркетинг", "promotions.manage", "Акции: создание и изменение", "project", [
        ("POST", r"/promotions"), ("PUT DELETE", r"/promotions/\d+")]),
    ("Маркетинг", "links.view", "Ссылки: просмотр", "project", [
        ("GET", r"/tracking-links(?:/stats)?"), ("GET", r"/tracking-links/\d+")]),
    ("Маркетинг", "links.manage", "Ссылки: создание и изменение", "project", [
        ("POST", r"/tracking-links"), ("PUT DELETE", r"/tracking-links/\d+")]),

    ("Мониторинг", "monitoring.view", "Мониторинг: просмотр серверов", "network", [
        ("GET", r"/monitoring"), ("GET", _NODE), ("GET", _NODE + r"/series")]),
    ("Мониторинг", "monitoring.manage", "Мониторинг: добавить, удалить, перезапустить сервер", "network", [
        ("POST", r"/monitoring/nodes"), ("PATCH DELETE", _NODE),
        ("POST", _NODE + r"/(?:reboot|rotate-secret|speedtest|start|stop|update|vless-check)")]),

    ("Настройки", "settings.project", "Проект (бот, канал, ЮKassa)", "project", [("GET PUT", r"/project/config")]),
    ("Настройки", "settings.app", "API приложений", "project", [
        ("GET PUT", r"/app-api"), ("POST", r"/app-api/keys"), ("DELETE", r"/app-api/keys/\d+"),
        ("POST", r"/app-api/sessions/revoke")]),
    ("Настройки", "settings.price", "Цены и тарифы", "project", [("GET PUT", r"/plans"), ("GET", r"/plans/meta")]),
    ("Настройки", "settings.antiabuse", "Антиабуз", "network", [("GET PUT", r"/plans"), ("GET", r"/plans/meta")]),
    ("Настройки", "settings.legal", "Оферта и политика", "project", [("GET PUT", r"/content/(?:offer|privacy)")]),
    ("Настройки", "settings.squads", "Сквады и льготный период", "network", [
        ("GET", r"/squads(?:/external)?"), ("PUT", r"/squads/(?:external|mapping|[0-9a-fA-F-]{8,64})"),
        ("POST", r"/squads/sync"), ("GET PUT", r"/grace"), ("GET", r"/remnawave/squads")]),
    ("Настройки", "settings.mail", "Почта", "network", [
        ("GET PUT", r"/mail"), ("POST", r"/mail/(?:dns|login-test|port25|send-test)")]),
    ("Настройки", "settings.captcha", "Капча", "network", [("GET PUT", r"/settings/captcha")]),
    ("Настройки", "settings.forum", "Форум (ошибки и логи)", "network", [("GET PUT", r"/forum")]),
    ("Настройки", "settings.backups", "Бэкапы (полная копия базы!)", "network", [
        ("GET", r"/backups/(?:status|download)"), ("POST", r"/backups/create"), ("PUT", r"/backups/settings")]),
    ("Настройки", "settings.storage", "Хранилище S3", "network", [
        ("GET PUT", r"/settings/s3"), ("POST", r"/settings/s3/check")]),
]
ADMIN_PERM_KEYS = {k for _, k, _, _, _ in ADMIN_PERMS} | {f"users.action.{a}" for a in USER_ACTION_KEYS}
# право «изменять» включает «смотреть»
PERM_IMPLIES = {
    "finance.refund": "finance.view", "withdrawals.manage": "withdrawals.view", "resale.manage": "resale.view",
    "mailing.send": "mailing.view", "promocodes.manage": "promocodes.view", "gifts.manage": "gifts.view",
    "promotions.manage": "promotions.view", "links.manage": "links.view", "monitoring.manage": "monitoring.view",
    "support": "users.view",  # карточка пользователя в чате поддержки
}

# любому администратору: вход, проекты, push, чат команды
ADMIN_BASE: list[tuple[set[str], re.Pattern]] = [
    (set(m.split()), re.compile(f"^{p}$")) for m, p in [
        ("GET", r"/auth/me"), ("GET", r"/projects"),
        ("GET", r"/push/key"), ("POST", r"/push/(?:subscribe|unsubscribe|test)"),
        ("GET", r"/team-chat(?:/unread|/members)?"), ("POST", r"/team-chat/(?:messages|read|messages/\d+/edit)"),
        ("DELETE", r"/team-chat/messages/\d+"),
    ]
]
_ADMIN_ROUTES: list[tuple[set[str], re.Pattern, str, str]] = [
    (set(r[0].split()), re.compile(f"^{r[1]}$"), key, r[2] if len(r) > 2 else scope)
    for _, key, _, scope, routes in ADMIN_PERMS for r in routes
]
# действия с пользователем: право на конкретное действие проверяет сама ручка
_ACTION_RX = re.compile(r"^/users/\d+/action$")


def admin_access(s: dict[str, Any]) -> dict[str, Any]:
    """{"perms": [...], "projects": ["*"] | [id, ...]} из panel_staff.permissions."""
    raw = s.get("permissions")
    try:
        data = json.loads(raw) if isinstance(raw, str) else (raw or {})
    except (TypeError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    perms = data.get("perms") if isinstance(data.get("perms"), list) else []
    perms = sorted({str(x) for x in perms if str(x) in ADMIN_PERM_KEYS})
    projs = data.get("projects") if isinstance(data.get("projects"), list) else []
    projs = ["*"] if "*" in projs else sorted({str(x) for x in projs})
    return {"perms": perms, "projects": projs}


def effective_perms(perms: list[str]) -> set[str]:
    out = set(perms)
    for k in list(out):
        if k in PERM_IMPLIES:
            out.add(PERM_IMPLIES[k])
        # любое право над пользователями открывает и их просмотр
        if k.startswith("users."):
            out.add("users.view")
    return out


def validate_access(data: Any, known_projects: set[str]) -> str:
    """права администратора из панели → JSON для panel_staff.permissions."""
    if not isinstance(data, dict):
        raise StaffError("Не заданы права администратора")
    perms = data.get("perms") or []
    projs = data.get("projects") or []
    if not isinstance(perms, list) or not isinstance(projs, list):
        raise StaffError("Неверный формат прав")
    bad = [str(x) for x in perms if str(x) not in ADMIN_PERM_KEYS]
    if bad:
        raise StaffError(f"Неизвестное право: {bad[0]}")
    if "*" in projs:
        projs = ["*"]
    else:
        unknown = [str(x) for x in projs if str(x) not in known_projects]
        if unknown:
            raise StaffError(f"Неизвестный проект: {unknown[0]}")
        projs = sorted({str(x) for x in projs})
    if not projs:
        raise StaffError("Выберите хотя бы один проект")
    return json.dumps({"perms": sorted({str(x) for x in perms}), "projects": projs}, ensure_ascii=False)


def admin_route(method: str, sub: str, perms: set[str]) -> Optional[str]:
    """доступ администратора к пути: None — нельзя, иначе scope ('base' | 'project' | 'network')."""
    method = "GET" if method.upper() == "HEAD" else method.upper()
    for methods, rx in ADMIN_BASE:
        if method in methods and rx.match(sub):
            return "base"
    if method == "POST" and _ACTION_RX.match(sub):
        return "project" if any(p.startswith("users.action.") for p in perms) else None
    scopes = [scope for methods, rx, key, scope in _ADMIN_ROUTES if method in methods and key in perms and rx.match(sub)]
    if not scopes:
        return None
    return "project" if "project" in scopes else "network"


def perms_catalog() -> dict[str, Any]:
    """справочник прав для редактора в панели."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for g, key, label, scope, _ in ADMIN_PERMS:
        groups.setdefault(g, []).append({"key": key, "label": label, "scope": scope, "implies": PERM_IMPLIES.get(key)})
    out = [{"group": g, "items": items} for g, items in groups.items()]
    out.insert(2, {"group": "Действия с пользователем", "items": [
        {"key": f"users.action.{a}", "label": label, "scope": "project", "implies": "users.view"} for a, label in USER_ACTIONS]})
    return {"groups": out}
