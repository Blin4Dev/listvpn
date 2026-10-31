"""
listvpn — сеть VPN-проектов на одном бэкенде.

Проект (BatmanVPN, FGN, …) — это свой бренд: свой бот и канал, своя платёжка ЮKassa, свои цены
и тарифы, своё мини-приложение. Общее у всех: бэкенд, база, панель, Remnawave, сотрудники.

Где что лежит
  projects/<id>/project.json — несекретное: имя, канал, тексты бота, фичи (в git)
  projects/<id>/app/        — мини-приложение: бренд, свои картинки и переопределённые файлы
  панель → Настройки → «Проект» — бот, канал, ЮKassa, домены подписки (в базе, секреты зашифрованы)
  .env                      — только инфраструктура (домен мини-приложения проекта: ID__MINIAPP_DOMAIN …);
                              бот/ЮKassa из .env (как раньше) — запасной вариант, панель важнее

Текущий проект — contextvar: middleware ставит его на запрос (заголовок X-Project / домен),
фоновые задачи — через `with projects.use(user["project_id"]):`.
"""

from __future__ import annotations

import contextvars
import functools
import json
import os
import re
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator, Optional
from urllib.parse import urlparse

ID_RE = re.compile(r"^[a-z][a-z0-9]{0,23}$")


def _find_projects_dir() -> str:
    env_dir = (os.getenv("PROJECTS_DIR") or "").strip()
    if env_dir:
        return env_dir
    here = os.path.dirname(os.path.abspath(__file__))
    for up in ("../../projects", "../projects", "../../../projects"):
        cand = os.path.abspath(os.path.join(here, up))
        if os.path.isdir(cand):
            return cand
    return os.path.abspath(os.path.join(here, "..", "..", "projects"))


PROJECTS_DIR = _find_projects_dir()

# env, которые у каждого проекта обязаны быть свои: без префикса берём ТОЛЬКО для проекта по умолчанию
# (иначе FGN тихо ушёл бы в бота / магазин ЮKassa BatmanVPN)
STRICT_ENV = frozenset({
    "TELEGRAM_BOT_TOKEN", "BOT_USERNAME", "VITE_BOT_USERNAME",
    "MINIAPP_URL", "MINIAPP_DOMAIN", "SITE_DOMAIN", "SITE_URL", "TELEGRAM_MINIAPP_LINK", "SUPPORT_URL",
    "YOOKASSA_SHOP_ID", "YOOKASSA_SECRET_KEY", "YOOKASSA_RETURN_URL",
    "APP_LINK_NAME", "MAIL_FROM_NAME",
})

# настройки (таблица settings), которые у каждого проекта свои: цены, тарифы, пробный, канал, оплата, документы.
# Остальное (сквады, анти-абуз, бэкапы, мониторинг, почта, хранилище…) — общее для сети.
PROJECT_SETTING_KEYS = frozenset({
    "offer_text", "privacy_text",
    "base_price", "extra_device_price", "extra_device_stars", "tariff_devices", "device_prices", "device_stars",
    "trial_enabled", "trial_miniapp_enabled", "trial_web_enabled", "trial_days", "trial_traffic_gb",
    "trial_devices", "trial_hwid_enabled", "trial_hwid_max",
    "paid_traffic_gb", "traffic_reset_price", "channel_required", "pay_methods",
    "apiv1_tasks_seeded",
    # семейная подписка: сколько человек в семье вместе с владельцем
    "family_max_members",
    # сквады Remnawave: у проекта свои (FGN — свои обходы); не задано — берутся общие сети
    "squad_mapping_vpn", "squad_mapping_trial",
    # внешний сквад Remnawave (панель → Сквады): у каждого проекта свой
    "squad_external",
    # фишки проекта (features в project.json): напоминания и подарки
    "notconn_hours", "winback_after_days", "winback_gift_days",
    # сайт проекта (features.site): приложения для компьютера
    "desktop_windows_url", "desktop_macos_url", "desktop_version",
    # мобильное приложение (API v1): панель → Настройки → «Приложение (API)»
    "app_api_enabled", "app_key_required", "app_payment_return_url", "app_invite_url", "app_whitelist_included",
})
PROJECT_SETTING_PREFIXES = ("period_price_", "period_stars_")


def is_project_setting(key: str) -> bool:
    return key in PROJECT_SETTING_KEYS or key.startswith(PROJECT_SETTING_PREFIXES)


# ── настройки проекта из панели (бот, канал, ЮKassa…): settings, ключ @<id>/cfg:<ИМЯ> ──
# значение: True — секрет (хранится зашифрованным MONITOR_SECRET_KEY), False — открыто
PANEL_CONFIG: dict[str, bool] = {
    "TELEGRAM_BOT_TOKEN": True, "BOT_USERNAME": False, "BOT_ID": False,
    "YOOKASSA_SHOP_ID": False, "YOOKASSA_SECRET_KEY": True,
    "CHANNEL_ID": False, "CHANNEL_URL": False,
    "SUPPORT_URL": False, "TELEGRAM_MINIAPP_LINK": False,
    "VPN_SUB_DOMAIN": False,
    # мини-приложение проекта на своём сервере (ставится из панели, см. miniapps.py)
    "MINIAPP_DOMAIN": False, "MINIAPP_URL": False, "SITE_DOMAIN": False, "MINIAPP_SERVER": False,
    # проект включён в панели: "1" / "0"; не задано — работает, если бот подключён (старые установки)
    "PROJECT_ACTIVE": False,
}
_CFG_TTL = 5.0
_cfg_cache: dict[str, tuple[float, dict[str, str]]] = {}
_cfg_lock = threading.Lock()


def _db():
    try:
        from . import database as _d  # type: ignore
    except ImportError:  # pragma: no cover
        import database as _d  # type: ignore
    return _d


def _crypto():
    try:
        from . import monitoring as _m  # type: ignore
    except ImportError:  # pragma: no cover
        import monitoring as _m  # type: ignore
    return _m


def panel_config(pid: str, *, fresh: bool = False) -> dict[str, str]:
    """настройки проекта из панели (секреты расшифрованы); кэш на несколько секунд — их читают на каждый вызов бота."""
    now = time.monotonic()
    with _cfg_lock:
        hit = _cfg_cache.get(pid)
        if hit and not fresh and now - hit[0] < _CFG_TTL:
            return hit[1]
    out: dict[str, str] = {}
    try:
        rows = _db().fetchall("SELECT key, value FROM settings WHERE key LIKE ?", (f"@{pid}/cfg:%",))
    except Exception:  # noqa: BLE001  (база ещё не готова)
        rows = []
    for r in rows:
        name = str(r["key"]).split("/cfg:", 1)[-1]
        if name not in PANEL_CONFIG:
            continue
        val = r["value"] or ""
        if PANEL_CONFIG[name] and val:
            val = _crypto().decrypt(val) or ""
        if val:
            out[name] = val
    with _cfg_lock:
        _cfg_cache[pid] = (now, out)
    return out


def set_panel_config(pid: str, updates: dict[str, Optional[str]]) -> None:
    """сохранить настройки проекта; пустое значение / None — удалить (вернётся значение из .env, если есть)."""
    d = _db()
    for name, val in updates.items():
        if name not in PANEL_CONFIG:
            raise KeyError(name)
        key = f"@{pid}/cfg:{name}"
        val = (val or "").strip()
        if not val:
            d.execute("DELETE FROM settings WHERE key = ?", (key,))
            continue
        stored = _crypto().encrypt(val) if PANEL_CONFIG[name] else val
        d.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                  (key, stored))
    with _cfg_lock:
        _cfg_cache.pop(pid, None)


def config_source(pid: str, name: str) -> str:
    """откуда значение: panel | env | '' (не задано)."""
    if panel_config(pid).get(name):
        return "panel"
    return "env" if _env_only(name, pid) else ""


class Project:
    """проект сети; адреса и секреты — из env (ID__ИМЯ), остальное — из project.json."""

    def __init__(self, pid: str, cfg: dict[str, Any]):
        self.id = pid
        self.cfg = cfg

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Project {self.id}>"

    # ── env ──
    def env(self, *names: str, default: str = "") -> str:
        for name in names:
            v = env(name, project=self.id)
            if v:
                return v
        return default

    # ── из project.json ──
    @property
    def name(self) -> str:
        return str(self.cfg.get("name") or self.id)

    @property
    def is_default(self) -> bool:
        return self.id == DEFAULT

    def feature(self, key: str, default: Any = False) -> Any:
        return (self.cfg.get("features") or {}).get(key, default)

    def bot_text(self, key: str, default: str = "") -> str:
        return str((self.cfg.get("bot") or {}).get(key) or default)

    @property
    def channel_id(self) -> str:
        # канал: панель → «Проект», иначе projects/<id>/project.json
        return panel_config(self.id).get("CHANNEL_ID") or str((self.cfg.get("channel") or {}).get("id") or "").strip()

    @property
    def channel_url(self) -> str:
        url = panel_config(self.id).get("CHANNEL_URL") or \
            ("" if panel_config(self.id).get("CHANNEL_ID") else str((self.cfg.get("channel") or {}).get("url") or "").strip())
        if not url and self.channel_id.startswith("@"):
            url = f"https://t.me/{self.channel_id[1:]}"
        return url

    # ── адреса и секреты ──
    @property
    def bot_token(self) -> str:
        return self.env("TELEGRAM_BOT_TOKEN")

    @property
    def bot_id(self) -> str:
        t = self.bot_token
        return t.split(":", 1)[0] if ":" in t else ""

    @property
    def active(self) -> bool:
        """проект включён (начальное меню панели): выключенный — бот молчит."""
        flag = panel_config(self.id).get("PROJECT_ACTIVE", "")
        if flag:
            return flag == "1"
        return bool(self.bot_token)

    @property
    def payments_configured(self) -> bool:
        return bool(self.env("YOOKASSA_SHOP_ID") and self.env("YOOKASSA_SECRET_KEY"))

    @property
    def bot_username(self) -> str:
        return self.env("BOT_USERNAME", "VITE_BOT_USERNAME").lstrip("@")

    @property
    def webhook_secret(self) -> str:
        return self.env("TELEGRAM_WEBHOOK_SECRET")

    @property
    def miniapp_url(self) -> str:
        return self.env("MINIAPP_URL").rstrip("/")

    @property
    def site_url(self) -> str:
        return self.env("SITE_URL").rstrip("/")

    @property
    def support_url(self) -> str:
        return self.env("SUPPORT_URL")

    @property
    def miniapp_link(self) -> str:
        return self.env("TELEGRAM_MINIAPP_LINK")

    @property
    def yookassa_return_url(self) -> str:
        return self.env("YOOKASSA_RETURN_URL") or (f"{self.miniapp_url}/payment/success" if self.miniapp_url else "")

    @property
    def app_link_name(self) -> str:
        return self.env("APP_LINK_NAME") or self.name

    @property
    def hosts(self) -> set[str]:
        """домены проекта (мини-приложение / сайт) — по ним узнаём проект запроса."""
        out: set[str] = set()
        for url in (self.miniapp_url, self.site_url):
            h = (urlparse(url).hostname or "").lower() if url else ""
            if h:
                out.add(h)
        # SITE_DOMAIN — сайт проекта в браузере (features.site), тот же контейнер мини-приложения
        for key in ("MINIAPP_DOMAIN", "SITE_DOMAIN"):
            d = self.env(key).lower()
            if d:
                out.add(d)
        return out

    def public(self) -> dict[str, Any]:
        """для панели: без секретов."""
        return {
            "id": self.id,
            "name": self.name,
            "is_default": self.is_default,
            "bot_username": self.bot_username,
            "miniapp_url": self.miniapp_url,
            "channel_url": self.channel_url,
            "configured": bool(self.bot_token),
            "active": self.active,
            "payments_configured": self.payments_configured,
            "features": dict(self.cfg.get("features") or {}),
        }


def _load_registry() -> dict[str, Project]:
    reg: dict[str, Project] = {}
    if os.path.isdir(PROJECTS_DIR):
        for name in sorted(os.listdir(PROJECTS_DIR)):
            path = os.path.join(PROJECTS_DIR, name, "project.json")
            if not os.path.isfile(path):
                continue
            try:
                with open(path, encoding="utf-8") as fh:
                    cfg = json.load(fh)
            except (OSError, ValueError) as exc:
                print(f"[projects] {path}: {exc}", flush=True)
                continue
            pid = str(cfg.get("id") or name).strip().lower()
            if pid != name or not ID_RE.match(pid):
                print(f"[projects] пропуск {name}: id должен совпадать с папкой и быть [a-z][a-z0-9]*", flush=True)
                continue
            if cfg.get("enabled") is False:
                continue
            reg[pid] = Project(pid, cfg)
    # порядок в панели и списках — поле "order" в project.json, без него — в конце по алфавиту
    def _order(pid: str) -> tuple:
        try:
            return (int(reg[pid].cfg.get("order")), pid)
        except (TypeError, ValueError):
            return (10**6, pid)
    reg = {pid: reg[pid] for pid in sorted(reg, key=_order)}
    if not reg:  # без папки projects/ — один проект, как было до сети
        reg["batman"] = Project("batman", {"id": "batman", "name": "BatmanVPN",
                                           "channel": {"id": "@BATMANNETWORK", "url": "https://t.me/BATMANNETWORK"}})
    return reg


_REGISTRY = _load_registry()
DEFAULT = (os.getenv("DEFAULT_PROJECT") or "batman").strip().lower()
if DEFAULT not in _REGISTRY:
    DEFAULT = next(iter(_REGISTRY))

_current: contextvars.ContextVar[str] = contextvars.ContextVar("listvpn_project", default=DEFAULT)


def env(name: str, default: str = "", *, project: Optional[str] = None) -> str:
    """настройка проекта: панель («Проект»: бот, ЮKassa…) → .env ID__NAME → .env без префикса
    (только для проекта по умолчанию и для общих переменных)."""
    pid = project or _current.get()
    if name in PANEL_CONFIG:
        v = panel_config(pid).get(name, "")
        if v:
            return v
    return _env_only(name, pid) or default


def _env_only(name: str, pid: str) -> str:
    v = (os.getenv(f"{pid.upper()}__{name}") or "").strip()
    if v:
        return v
    if pid == DEFAULT or name not in STRICT_ENV:
        v = (os.getenv(name) or "").strip()
        if v:
            return v
    return ""


def ids() -> list[str]:
    return list(_REGISTRY)


def all_projects() -> list[Project]:
    return list(_REGISTRY.values())


def exists(pid: Any) -> bool:
    return isinstance(pid, str) and pid in _REGISTRY


def get(pid: Optional[str] = None) -> Project:
    if pid and pid in _REGISTRY:
        return _REGISTRY[pid]
    return _REGISTRY[_current.get()] if pid is None else _REGISTRY[DEFAULT]


def current_id() -> str:
    return _current.get()


def current() -> Project:
    return _REGISTRY.get(_current.get()) or _REGISTRY[DEFAULT]


def normalize(pid: Any) -> Optional[str]:
    s = str(pid or "").strip().lower()
    return s if s in _REGISTRY else None


@contextmanager
def use(pid: Optional[str]) -> Iterator[Project]:
    """временно работать от имени проекта (фоновые задачи, действия над чужим пользователем)."""
    p = normalize(pid) or DEFAULT
    token = _current.set(p)
    try:
        yield _REGISTRY[p]
    finally:
        _current.reset(token)


def set_current(pid: Optional[str]) -> contextvars.Token:
    return _current.set(normalize(pid) or DEFAULT)


def reset(token: contextvars.Token) -> None:
    _current.reset(token)


def bind(fn):
    """функция для потока / пула с проектом вызывающего (новые потоки контекст не наследуют)."""
    ctx = contextvars.copy_context()

    def _run(*a, **kw):
        return ctx.copy().run(fn, *a, **kw)

    _run.__name__ = getattr(fn, "__name__", "bound")
    return _run


def scoped(resolver):
    """декоратор: выполнять функцию от имени проекта записи; resolver(*args, **kwargs) -> id проекта | None.
    Так платёж / выдача подписки идут ботом и ценами своего проекта, откуда бы их ни вызвали
    (вебхук, фоновая сверка, панель)."""
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*a, **kw):
            try:
                pid = resolver(*a, **kw)
            except Exception:  # noqa: BLE001
                pid = None
            if not pid or pid == _current.get():
                return fn(*a, **kw)
            with use(pid):
                return fn(*a, **kw)
        return wrapper
    return deco


def of_user(user: Any) -> Optional[str]:
    """проект пользователя по dict (с project_id или id) или по id."""
    if isinstance(user, dict):
        if user.get("project_id"):
            return normalize(user["project_id"])
        uid = user.get("id")
    else:
        uid = user
    if uid in (None, ""):
        return None
    try:
        import database as _db  # type: ignore
    except ImportError:  # pragma: no cover
        from . import database as _db  # type: ignore
    row = _db.fetchone("SELECT project_id FROM users WHERE id = ?", (int(uid),))
    return normalize((row or {}).get("project_id")) if row else None


def of(row: Optional[dict[str, Any]]) -> str:
    """проект записи (пользователь, платёж…); старые записи без поля — проект по умолчанию."""
    if not row:
        return DEFAULT
    return normalize(row.get("project_id")) or DEFAULT


def by_host(host: Optional[str]) -> Optional[str]:
    h = (host or "").split(":", 1)[0].strip().lower()
    if not h:
        return None
    for p in _REGISTRY.values():
        if h in p.hosts:
            return p.id
    return None


def setting_key(key: str, project: Optional[str] = None) -> str:
    """ключ settings: у проекта по умолчанию — как раньше, у остальных — @<id>/<key>."""
    pid = project or _current.get()
    if pid == DEFAULT or not is_project_setting(key):
        return key
    return f"@{pid}/{key}"
