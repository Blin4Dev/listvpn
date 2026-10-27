# sqlite: пользователи, подписки, платежи, сущности панели
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

try:
    from . import projects  # type: ignore
except ImportError:
    import projects  # type: ignore

DB_PATH = os.getenv("DB_PATH", "data/data.db")

_local = threading.local()
_init_lock = threading.Lock()
_initialized = False


def get_db_path() -> str:
    return DB_PATH


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_dir() -> None:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)


def connect() -> sqlite3.Connection:
    global _initialized
    conn: Optional[sqlite3.Connection] = getattr(_local, "conn", None)
    if conn is None:
        _ensure_dir()
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        # busy_timeout: ждать до 5с вместо database is locked
        conn.execute("PRAGMA busy_timeout = 5000")
        # проект текущего запроса/задачи — для триггеров, проставляющих project_id новым записям
        conn.create_function("current_project", 0, projects.current_id)
        _local.conn = conn
    if not _initialized:
        with _init_lock:
            if not _initialized:
                _create_schema(conn)
                _migrate(conn)
                _seed_defaults(conn)
                _initialized = True
    return conn


def init_db() -> None:
    connect()


def close() -> None:
    global _initialized
    conn: Optional[sqlite3.Connection] = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
        _local.conn = None
    _initialized = False


@contextmanager
def cursor() -> Iterator[sqlite3.Cursor]:
    conn = connect()
    cur = conn.cursor()
    try:
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    conn = connect()
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def execute(sql: str, params: tuple | list = ()) -> sqlite3.Cursor:
    conn = connect()
    try:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur
    except Exception:
        # rollback, чтобы упавшая запись не держала соединение
        conn.rollback()
        raise


def executemany(sql: str, seq: list) -> None:
    conn = connect()
    try:
        conn.executemany(sql, seq)
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def fetchone(sql: str, params: tuple | list = ()) -> Optional[dict[str, Any]]:
    row = connect().execute(sql, params).fetchone()
    return dict(row) if row else None


def fetchall(sql: str, params: tuple | list = ()) -> list[dict[str, Any]]:
    rows = connect().execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def last_id() -> int:
    row = connect().execute("SELECT last_insert_rowid() AS id").fetchone()
    return int(row["id"]) if row else 0


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[dict[str, Any]]:
    return dict(row) if row else None


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- уникален внутри проекта: один человек в BatmanVPN и FGN — два разных аккаунта
    telegram_id INTEGER,
    project_id TEXT,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    balance REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Trial',
    is_banned INTEGER NOT NULL DEFAULT 0,
    referral_code TEXT UNIQUE,
    referred_by INTEGER,
    is_partner INTEGER NOT NULL DEFAULT 0,
    partner_balance REAL NOT NULL DEFAULT 0,
    partner_rate REAL NOT NULL DEFAULT 25,
    autopay_enabled INTEGER NOT NULL DEFAULT 0,
    autopay_method TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    rw_id TEXT,
    key_uuid TEXT,
    short_uuid TEXT,
    key_config TEXT,
    status TEXT NOT NULL DEFAULT 'Active',
    expires_at TEXT,
    devices_limit INTEGER NOT NULL DEFAULT 1,
    devices_used INTEGER NOT NULL DEFAULT 0,
    traffic_used INTEGER NOT NULL DEFAULT 0,
    traffic_limit INTEGER NOT NULL DEFAULT 0,
    custom_name TEXT,
    type TEXT NOT NULL DEFAULT 'vpn',
    squads_json TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_method TEXT,
    hash TEXT,
    payment_id TEXT,
    description TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL DEFAULT 'yookassa',
    method TEXT,
    provider_payment_id TEXT,
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'RUB',
    stars INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    purpose TEXT NOT NULL DEFAULT 'subscription',
    plan_devices INTEGER,
    months INTEGER NOT NULL DEFAULT 1,
    extra_devices INTEGER NOT NULL DEFAULT 0,
    subscription_id INTEGER,
    pay_url TEXT,
    invoice_link TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    paid_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- докупленные устройства со своим сроком: по истечении лимит подписки уменьшается
CREATE TABLE IF NOT EXISTS device_addons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subscription_id INTEGER NOT NULL,
    payment_id TEXT,
    count INTEGER NOT NULL DEFAULT 1,
    months INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ended_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_device_addons_active ON device_addons(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_device_addons_sub ON device_addons(subscription_id, status);

CREATE TABLE IF NOT EXISTS promocodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT,
    type TEXT NOT NULL DEFAULT 'discount',
    value REAL NOT NULL DEFAULT 0,
    uses_limit INTEGER,
    uses_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promocode_activations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    promocode_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    discount_percent REAL NOT NULL DEFAULT 0,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (promocode_id) REFERENCES promocodes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mailings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    message_text TEXT NOT NULL,
    target_users TEXT NOT NULL DEFAULT 'all',
    status TEXT NOT NULL DEFAULT 'Completed',
    sent_count INTEGER NOT NULL DEFAULT 0,
    button_type TEXT,
    button_value TEXT,
    image_url TEXT,
    created_at TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS support_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    assigned_admin TEXT,                 -- кто нажал «Начать»
    started_at TEXT,
    last_message_at TEXT,
    last_preview TEXT,
    last_sender TEXT,
    unread_admin INTEGER NOT NULL DEFAULT 0,
    unread_user INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_support_chats_last ON support_chats(last_message_at);
CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    sender TEXT NOT NULL,                -- user | admin | system
    author TEXT,                         -- логин админа
    text TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (chat_id) REFERENCES support_chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_support_messages_chat ON support_messages(chat_id, id);
-- обращения (тикеты) внутри переписки: открывает пользователь, закрывает админ
CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    number INTEGER NOT NULL,             -- №1, №2… в пределах переписки
    status TEXT NOT NULL DEFAULT 'open', -- open | closed
    opened_by TEXT,                      -- user | admin
    opened_at TEXT NOT NULL,
    assigned_admin TEXT,
    closed_at TEXT,
    closed_by TEXT,
    FOREIGN KEY (chat_id) REFERENCES support_chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_chat ON support_tickets(chat_id, id);
CREATE TABLE IF NOT EXISTS support_files (
    id TEXT PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    message_id INTEGER,                  -- NULL - загружен, но ещё не отправлен
    uploader TEXT NOT NULL,              -- user | admin
    uploader_id TEXT NOT NULL,
    kind TEXT NOT NULL,                  -- image | video | file (по содержимому)
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_files_msg ON support_files(message_id);


CREATE TABLE IF NOT EXISTS panel_staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,       -- логин (нижний регистр)
    name TEXT,                           -- имя для показа («Анна»)
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    telegram_id INTEGER NOT NULL,        -- куда приходит код 2FA
    permissions TEXT NOT NULL DEFAULT '{}',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    last_login_at TEXT,
    last_login_ip TEXT,
    -- шаблон смены: подставляется при заполнении графика
    default_pay REAL NOT NULL DEFAULT 0,
    default_intervals TEXT               -- JSON [["10:00","19:00"],...]
);
-- график работы сотрудника: один день (по Москве) = интервалы работы (перерывы
-- делят день на части) и оплата за день. Нет строки - выходной.
CREATE TABLE IF NOT EXISTS staff_days (
    staff_id INTEGER NOT NULL,
    day TEXT NOT NULL,                   -- YYYY-MM-DD (Москва)
    intervals TEXT NOT NULL,             -- JSON [["10:00","14:00"],["15:00","19:00"]]
    pay REAL NOT NULL DEFAULT 0,         -- ₽ за день
    updated_at TEXT,
    PRIMARY KEY (staff_id, day),
    FOREIGN KEY (staff_id) REFERENCES panel_staff(id) ON DELETE CASCADE
);
-- штрафы (выдают владелец и кураторы) и выплаты зарплаты (отмечает владелец)
CREATE TABLE IF NOT EXISTS staff_fines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    reason TEXT NOT NULL,
    issued_by TEXT NOT NULL,             -- owner | staff:<id>
    issued_name TEXT,
    created_at TEXT NOT NULL,
    cancelled_at TEXT,
    cancelled_by TEXT,
    FOREIGN KEY (staff_id) REFERENCES panel_staff(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_staff_fines ON staff_fines(staff_id, id);
-- премии (начисляет только владелец); отменённая премия в баланс не идёт
CREATE TABLE IF NOT EXISTS staff_bonuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    reason TEXT NOT NULL,
    issued_by TEXT NOT NULL,
    issued_name TEXT,
    created_at TEXT NOT NULL,
    cancelled_at TEXT,
    cancelled_by TEXT,
    FOREIGN KEY (staff_id) REFERENCES panel_staff(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_staff_bonuses ON staff_bonuses(staff_id, id);
CREATE TABLE IF NOT EXISTS staff_payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    note TEXT,
    paid_on TEXT NOT NULL,               -- YYYY-MM-DD
    created_at TEXT NOT NULL,
    FOREIGN KEY (staff_id) REFERENCES panel_staff(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_staff_payouts ON staff_payouts(staff_id, id);
-- автоштрафы за обращения без ответа: одна запись на (обращение, ожидание, сотрудник, вид)
-- msg_id — первое сообщение клиента без ответа; kind: warn | fine
CREATE TABLE IF NOT EXISTS support_autofines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    msg_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    fine_id INTEGER,
    amount REAL,
    created_at TEXT NOT NULL,
    UNIQUE (ticket_id, msg_id, staff_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_support_autofines_staff ON support_autofines(staff_id, id);
-- push-подписки браузеров панели (Web Push)
-- общий чат сотрудников панели (владелец, кураторы, операторы)
CREATE TABLE IF NOT EXISTS team_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,                 -- owner | staff:<id>
    author_name TEXT,
    author_role TEXT,                    -- owner | curator | operator
    text TEXT NOT NULL,
    reply_to INTEGER,
    created_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS team_reads (
    actor TEXT PRIMARY KEY,
    last_id INTEGER NOT NULL DEFAULT 0
);
-- журнал модерации пользователя: блокировки/разблокировки аккаунта и подписок,
-- предупреждения и баны анти-абуза, чарджбеки. Не очищается при разблокировке.
CREATE TABLE IF NOT EXISTS moderation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    sub_id INTEGER,
    kind TEXT NOT NULL,        -- ban | unban | key_block | key_unblock | aa_warn | aa_ban | blacklist
    reason TEXT,
    details TEXT,              -- JSON
    actor TEXT,                -- owner | staff:<id> | antiabuse | blacklist | system
    actor_name TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moderation_user ON moderation_events(user_id, id);
-- HWID устройств, подключавшихся к пробным подпискам (анти-абуз пробного периода)
CREATE TABLE IF NOT EXISTS trial_hwids (
    hwid TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    seen_at TEXT NOT NULL,
    PRIMARY KEY (hwid, user_id)
);
CREATE INDEX IF NOT EXISTS idx_trial_hwids_user ON trial_hwids(user_id);
-- кого уже банили за пробные по HWID: после разбана вручную повторно не баним
CREATE TABLE IF NOT EXISTS trial_hwid_bans (
    user_id INTEGER PRIMARY KEY,
    hwid TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,                 -- owner | staff:<id>
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_ok_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_subs_actor ON push_subs(actor);
-- кто уже брал пробный период (по Telegram ID, навсегда): смена Telegram у
-- аккаунта и объединение аккаунтов не дают взять пробный ещё раз
CREATE TABLE IF NOT EXISTS trial_claims (
    project_id TEXT NOT NULL,
    telegram_id INTEGER NOT NULL,
    user_id INTEGER,
    claimed_at TEXT NOT NULL,
    PRIMARY KEY (project_id, telegram_id)
);
-- журнал действий в панели (кто, что, когда)
CREATE TABLE IF NOT EXISTS panel_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL,                 -- owner | staff:<id> | anon
    actor_name TEXT,
    action TEXT NOT NULL,                -- «POST /api/panel/…» или login_ok / login_fail …
    status INTEGER,
    ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_panel_audit_ts ON panel_audit(ts);
CREATE INDEX IF NOT EXISTS idx_panel_audit_actor ON panel_audit(actor, id);

-- отправленные сообщения рассылки: нужны, чтобы удалить их у пользователей.
CREATE TABLE IF NOT EXISTS mailing_messages (
    mailing_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    sent_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mailing_messages_m ON mailing_messages(mailing_id);

CREATE TABLE IF NOT EXISTS promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0,
    min_amount REAL,
    max_amount REAL,
    uses_limit INTEGER,
    uses_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    promocode TEXT,
    welcome_message TEXT,
    url TEXT,
    clicks INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    unique_users INTEGER NOT NULL DEFAULT 0,
    new_users INTEGER NOT NULL DEFAULT 0,
    total_revenue REAL NOT NULL DEFAULT 0,
    paid_users INTEGER NOT NULL DEFAULT 0,
    active_subscriptions INTEGER NOT NULL DEFAULT 0,
    total_keys INTEGER NOT NULL DEFAULT 0,
    conversion_rate REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_link_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER NOT NULL,
    user_id INTEGER,
    telegram_id INTEGER,
    username TEXT,
    full_name TEXT,
    is_new_user INTEGER NOT NULL DEFAULT 1,
    visited_at TEXT NOT NULL,
    trial_used INTEGER NOT NULL DEFAULT 0,
    total_spent REAL NOT NULL DEFAULT 0,
    keys_count INTEGER NOT NULL DEFAULT 0,
    active_keys INTEGER NOT NULL DEFAULT 0,
    has_paid INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (link_id) REFERENCES tracking_links(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    address TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'usdt_ton',
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
    tx_link TEXT,
    forum_chat_id TEXT,
    forum_message_id INTEGER,
    created_at TEXT NOT NULL,
    processed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ожидание ссылки на транзакцию от админа после нажатия «Одобрить» в форуме.
CREATE TABLE IF NOT EXISTS pending_tx_input (
    admin_chat_id INTEGER PRIMARY KEY,
    withdrawal_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

-- rate-limiting (фиксированное окно).
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    window_start REAL NOT NULL DEFAULT 0
);

-- онбординг-цепочка (напоминания тем, кто запустил бота, но не купил).
CREATE TABLE IF NOT EXISTS onboarding_reminders (
    user_id INTEGER NOT NULL,
    stage TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (user_id, stage),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trial_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    telegram_id INTEGER,
    granted_at TEXT NOT NULL,
    checked INTEGER NOT NULL DEFAULT 0
);


CREATE TABLE IF NOT EXISTS squads (
    squad_uuid TEXT PRIMARY KEY,
    squad_name TEXT NOT NULL,
    squad_type TEXT NOT NULL DEFAULT 'vpn',
    max_users INTEGER NOT NULL DEFAULT 0,
    current_users INTEGER NOT NULL DEFAULT 0,
    inbounds_count INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    devices INTEGER NOT NULL UNIQUE,
    price_rub REAL NOT NULL,
    price_stars REAL NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    plaintext_once TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS app_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_codes (
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires_at REAL NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent_at REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS temp_2fa (
    token TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    username TEXT NOT NULL,
    expires_at REAL NOT NULL
);

-- отметки об отправленных напоминаниях об окончании подписки.
-- stage: '3d' | '2d' | '1d' | 'expired'. cycle_expires_at - то значение
-- expires_at, для которого отправлено напоминание: при продлении подписки оно
-- меняется, и напоминания рассылаются заново для нового срока.
-- общий чёрный список Telegram ID (скачивается из BLACKLIST_URL, см. blacklist.py)
CREATE TABLE IF NOT EXISTS blacklist (
    telegram_id INTEGER PRIMARY KEY,
    reason TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sub_reminders (
    subscription_id INTEGER NOT NULL,
    stage TEXT NOT NULL,
    cycle_expires_at TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (subscription_id, stage),
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS mon_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ip TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 5055,
    secret_enc TEXT NOT NULL,              -- ключ агента, зашифрован (MONITOR_SECRET_KEY)
    enabled INTEGER NOT NULL DEFAULT 0,    -- 0 - ещё не запущен / остановлен
    created_at TEXT NOT NULL,
    started_at TEXT,
    last_seen TEXT,                        -- последний успешный ответ агента
    last_error TEXT,
    fail_count INTEGER NOT NULL DEFAULT 0,
    agent_version TEXT,
    boot_id TEXT,
    cursor INTEGER NOT NULL DEFAULT 0,
    speed_cursor INTEGER NOT NULL DEFAULT 0,
    uptime INTEGER,
    cores INTEGER,
    live_json TEXT,
    speed_running INTEGER NOT NULL DEFAULT 0,
    vless_enc TEXT,                        -- VLESS-ключ для проверки, зашифрован
    vless_ok INTEGER,
    vless_checked_at TEXT,
    vless_fail_count INTEGER NOT NULL DEFAULT 0,
    vless_error TEXT,
    pay_date TEXT,
    pay_url TEXT,
    pay_notified TEXT                      -- какие напоминания уже отправлены для pay_date
);

CREATE TABLE IF NOT EXISTS mon_metrics (
    node_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    cpu REAL, cpu_max REAL,
    ram_used INTEGER, ram_total INTEGER,
    disk_used INTEGER, disk_total INTEGER,
    disk_read INTEGER, disk_write INTEGER,
    net_rx INTEGER, net_tx INTEGER,
    load1 REAL,
    PRIMARY KEY (node_id, ts)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS mon_pings (
    node_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    sent INTEGER NOT NULL,
    lost INTEGER NOT NULL,
    rtt_ms REAL,
    agent_ok INTEGER,
    PRIMARY KEY (node_id, ts)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS mon_speed (
    node_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    ok INTEGER NOT NULL,
    down REAL, up REAL, ping_ms REAL,
    manual INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    PRIMARY KEY (node_id, ts)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS mon_vless (
    node_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    ok INTEGER NOT NULL,
    ms REAL,
    error TEXT,
    PRIMARY KEY (node_id, ts)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS mon_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,               -- critical | warning | info
    title TEXT NOT NULL,
    details TEXT,
    started_at TEXT NOT NULL,
    resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mon_inc_node ON mon_incidents(node_id, started_at);
CREATE INDEX IF NOT EXISTS idx_mon_inc_open ON mon_incidents(node_id, kind, resolved_at);

-- ── API v1 (см. docs/API_V1.md) ──
-- сессии токенов API v1: access-токен подписан (HMAC), refresh хранится только как sha-256
CREATE TABLE IF NOT EXISTS api_sessions (
    id TEXT PRIMARY KEY,                      -- sid внутри access-токена
    user_id INTEGER NOT NULL,
    refresh_hash TEXT NOT NULL UNIQUE,
    prev_refresh_hash TEXT,                   -- прошлый refresh: повторное предъявление = кража → отзыв
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL,                 -- refresh (скользящий, но не дольше абсолютного предела)
    last_used_at REAL,
    revoked_at REAL,
    revoke_reason TEXT,
    ip TEXT,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_api_sessions_user ON api_sessions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_api_sessions_prev ON api_sessions(prev_refresh_hash);

-- очередь выдачи/пересинхронизации ссылки в Remnawave (обрабатывает воркер в сервисе api)
CREATE TABLE IF NOT EXISTS provisioning_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subscription_id INTEGER,
    reason TEXT NOT NULL DEFAULT 'resync',    -- resync | payment | task_reward
    status TEXT NOT NULL DEFAULT 'queued',    -- queued | running | done | failed
    attempts INTEGER NOT NULL DEFAULT 0,
    run_after TEXT NOT NULL,
    payment_id TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_prov_jobs_queue ON provisioning_jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_prov_jobs_user ON provisioning_jobs(user_id, status);

-- тарифы по периодам; цена синхронизируется с настройками панели (period_price_N)
CREATE TABLE IF NOT EXISTS tariffs (
    project_id TEXT NOT NULL,
    code TEXT NOT NULL,                       -- m1 | m3 | m6 | m12
    title TEXT NOT NULL,
    price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RUB',
    period_days INTEGER NOT NULL,
    months INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (project_id, code)
);

-- факт покупки (одна строка на оплаченный платёж); без FK — история не теряется при удалении юзера
CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    tariff_code TEXT,
    purpose TEXT,
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'RUB',
    provider TEXT,
    provider_payment_id TEXT,
    subscription_id INTEGER,
    expires_at TEXT,                          -- срок подписки после покупки
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id, id);

-- журнал реферального баланса: SUM(amount) по юзеру = users.partner_balance
CREATE TABLE IF NOT EXISTS referral_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,                       -- accrual | reversal | withdrawal | withdrawal_refund | adjustment | opening_balance
    amount REAL NOT NULL,                     -- со знаком
    ref_user_id INTEGER,
    payment_id TEXT,
    withdrawal_id INTEGER,
    note TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ref_ledger_user ON referral_ledger(user_id, id);

-- задания за бонусные дни
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    kind TEXT NOT NULL DEFAULT 'manual',      -- channel | vpn_minutes | referrals | manual
    target INTEGER NOT NULL DEFAULT 1,        -- минут / приглашённых
    channel_id TEXT,                          -- для kind=channel (пусто = REQUIRED_CHANNEL_ID)
    url TEXT,
    reward_days INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_tasks (
    user_id INTEGER NOT NULL,
    task_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',    -- active | completed | claimed
    checked_at TEXT,
    completed_at TEXT,
    claimed_at TEXT,
    PRIMARY KEY (user_id, task_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- телеметрия VPN-сессий (heartbeat от клиента) — для заданий «проведи N минут в VPN»
CREATE TABLE IF NOT EXISTS vpn_sessions (
    user_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    node_name TEXT,
    started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    active_seconds INTEGER NOT NULL DEFAULT 0,
    heartbeats INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, session_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vpn_sessions_seen ON vpn_sessions(user_id, last_seen_at);

-- подарочные дни «нажмите Забрать» (промокод на дни, подарок вернувшимся) — features проекта
CREATE TABLE IF NOT EXISTS day_gifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    project_id TEXT,
    days INTEGER NOT NULL,
    source TEXT NOT NULL,                     -- promo | winback
    promocode_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | claimed
    created_at TEXT NOT NULL,
    expires_at TEXT,                          -- до когда можно забрать
    claimed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_day_gifts_user ON day_gifts(user_id, status);
-- семейная подписка: участники семьи (см. src/core/family.py)
--   member_id NULL — приглашение по логину/почте, аккаунт ещё не найден;
--   status pending — приглашён, active — пользуется подпиской владельца
CREATE TABLE IF NOT EXISTS family_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT,
    owner_id INTEGER NOT NULL,
    member_id INTEGER,
    invite_query TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    accepted_at TEXT,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_family_owner ON family_members(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_family_member ON family_members(member_id, status);
CREATE INDEX IF NOT EXISTS idx_family_query ON family_members(invite_query, status);
-- один аккаунт — одна семья (только среди принятых приглашений)
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_member_active
    ON family_members(member_id) WHERE member_id IS NOT NULL AND status = 'active';
-- код семьи владельца (общий для проекта владельца)
CREATE TABLE IF NOT EXISTS family_codes (
    owner_id INTEGER PRIMARY KEY,
    project_id TEXT,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
-- разовые уведомления пользователю (не подключил подписку и т.п.)
CREATE TABLE IF NOT EXISTS user_notices (
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL DEFAULT '',
    sent_at TEXT NOT NULL,
    PRIMARY KEY (user_id, kind, ref),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_tg ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subs_expiry ON subscriptions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
-- реферальная программа: приглашённые и реф. начисления без полного прохода по таблицам
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
CREATE INDEX IF NOT EXISTS idx_tx_user_method ON transactions(user_id, payment_method, created_at);
CREATE INDEX IF NOT EXISTS idx_promo_code ON promocodes(code);
CREATE INDEX IF NOT EXISTS idx_payments_pid ON payments(payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_pid ON payments(provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status, id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
"""


def _create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def _column_names(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {r["name"] for r in rows}


# ── сеть проектов (listvpn) ──
# таблицы, чьи строки принадлежат пользователю: project_id = проект пользователя
PROJECT_USER_TABLES = ("subscriptions", "payments", "transactions", "purchases", "support_chats", "withdrawals",
                       "day_gifts")
# сущности проекта, которые создаёт панель: project_id = проект запроса (current_project())
PROJECT_OWN_TABLES = ("promocodes", "promotions", "tracking_links", "mailings", "tasks")


def _rebuild_table(conn: sqlite3.Connection, table: str, create_sql: str, post: tuple[str, ...] = (),
                   select_map: Optional[dict[str, str]] = None) -> None:
    """пересоздать таблицу (sqlite не умеет менять ограничения): create_sql создаёт <table>__new.
    Данные переносятся по общим колонкам; select_map — выражение для колонки, которой в старой нет."""
    old_cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("PRAGMA legacy_alter_table = ON")
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(f"DROP TABLE IF EXISTS {table}__new")
        conn.execute(create_sql)
        new_cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table}__new)").fetchall()]
        cols = [c for c in new_cols if c in old_cols or (select_map and c in select_map)]
        exprs = [c if c in old_cols else select_map[c] for c in cols]  # type: ignore[index]
        conn.execute(f"INSERT INTO {table}__new ({', '.join(cols)}) SELECT {', '.join(exprs)} FROM {table}")
        conn.execute(f"DROP TABLE {table}")
        conn.execute(f"ALTER TABLE {table}__new RENAME TO {table}")
        for s in post:
            conn.execute(s)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("PRAGMA legacy_alter_table = OFF")
        conn.execute("PRAGMA foreign_keys = ON")


def _users_tg_unique_alone(conn: sqlite3.Connection) -> bool:
    """старая схема: telegram_id UNIQUE на всю базу (до сети проектов)."""
    for idx in conn.execute("PRAGMA index_list(users)").fetchall():
        if not idx["unique"]:
            continue
        cols = [r["name"] for r in conn.execute(f"PRAGMA index_info({idx['name']})").fetchall()]
        if cols == ["telegram_id"]:
            return True
    return False


def _migrate_projects(conn: sqlite3.Connection) -> None:
    default = projects.DEFAULT
    q = "'" + default.replace("'", "''") + "'"

    # 1) колонка project_id
    for table in ("users",) + PROJECT_USER_TABLES + PROJECT_OWN_TABLES:
        try:
            if "project_id" not in _column_names(conn, table):
                conn.execute(f"ALTER TABLE {table} ADD COLUMN project_id TEXT")
        except sqlite3.Error:
            pass
    conn.execute(f"UPDATE users SET project_id = {q} WHERE project_id IS NULL")
    for table in PROJECT_USER_TABLES:
        conn.execute(f"UPDATE {table} SET project_id = COALESCE("
                     f"(SELECT u.project_id FROM users u WHERE u.id = {table}.user_id), {q}) WHERE project_id IS NULL")
    for table in PROJECT_OWN_TABLES:
        conn.execute(f"UPDATE {table} SET project_id = {q} WHERE project_id IS NULL")
    conn.commit()

    # 2) users: telegram_id уникален внутри проекта, а не во всей базе
    if _users_tg_unique_alone(conn):
        row = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").fetchone()
        sql = str(row["sql"])
        sql = re.sub(r"(?i)^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?[\"`\[]?users[\"`\]]?", "CREATE TABLE users__new", sql)
        sql = re.sub(r"(?i)(\btelegram_id\s+INTEGER)\s+UNIQUE", r"\1", sql)
        _rebuild_table(conn, "users", sql, post=(
            "CREATE INDEX IF NOT EXISTS idx_users_tg ON users(telegram_id)",
            "CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by)",
        ))
        print("[db] users: telegram_id теперь уникален внутри проекта", flush=True)
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_project_tg ON users(project_id, telegram_id) "
                 "WHERE telegram_id IS NOT NULL")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_users_project ON users(project_id, id)")

    # 3) trial_claims: «брал пробный» — в рамках проекта
    if "project_id" not in _column_names(conn, "trial_claims"):
        _rebuild_table(conn, "trial_claims", (
            "CREATE TABLE trial_claims__new (project_id TEXT NOT NULL, telegram_id INTEGER NOT NULL, "
            "user_id INTEGER, claimed_at TEXT NOT NULL, PRIMARY KEY (project_id, telegram_id))"
        ), select_map={"project_id": q})

    # 4) tariffs: у каждого проекта свои
    if "project_id" not in _column_names(conn, "tariffs"):
        _rebuild_table(conn, "tariffs", (
            "CREATE TABLE tariffs__new (project_id TEXT NOT NULL, code TEXT NOT NULL, title TEXT NOT NULL, "
            "price REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'RUB', period_days INTEGER NOT NULL, months INTEGER, "
            "is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT, "
            "PRIMARY KEY (project_id, code))"
        ), select_map={"project_id": q})

    # 5) новые строки получают project_id автоматически
    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS trg_users_project AFTER INSERT ON users WHEN NEW.project_id IS NULL "
        "BEGIN UPDATE users SET project_id = current_project() WHERE id = NEW.id; END"
    )
    for table in PROJECT_USER_TABLES:
        conn.execute(
            f"CREATE TRIGGER IF NOT EXISTS trg_{table}_project AFTER INSERT ON {table} WHEN NEW.project_id IS NULL "
            f"BEGIN UPDATE {table} SET project_id = COALESCE((SELECT project_id FROM users WHERE id = NEW.user_id), "
            f"current_project()) WHERE rowid = NEW.rowid; END"
        )
        # перенос записи другому пользователю (объединение / перенос подписки) — проект следует за ним
        conn.execute(
            f"CREATE TRIGGER IF NOT EXISTS trg_{table}_project_upd AFTER UPDATE OF user_id ON {table} "
            f"WHEN NEW.user_id IS NOT NULL BEGIN UPDATE {table} SET project_id = "
            f"(SELECT project_id FROM users WHERE id = NEW.user_id) WHERE rowid = NEW.rowid "
            f"AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id); END"
        )
        conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_project ON {table}(project_id)")
    for table in PROJECT_OWN_TABLES:
        conn.execute(
            f"CREATE TRIGGER IF NOT EXISTS trg_{table}_project AFTER INSERT ON {table} WHEN NEW.project_id IS NULL "
            f"BEGIN UPDATE {table} SET project_id = current_project() WHERE rowid = NEW.rowid; END"
        )
    conn.commit()


def _seed_projects(conn: sqlite3.Connection) -> None:
    """новый проект стартует копией настроек проекта по умолчанию (цены, тарифы, пробный, документы)."""
    default = projects.get(projects.DEFAULT)
    rows = conn.execute("SELECT key, value FROM settings WHERE key NOT LIKE '@%'").fetchall()
    base = {r["key"]: r["value"] for r in rows if projects.is_project_setting(r["key"])}
    for p in projects.all_projects():
        if p.id == projects.DEFAULT:
            continue
        flag = f"@{p.id}/__seeded"
        if conn.execute("SELECT 1 FROM settings WHERE key = ?", (flag,)).fetchone():
            continue
        for k, v in base.items():
            if k == "apiv1_tasks_seeded":
                continue
            if k in ("offer_text", "privacy_text"):
                v = (v or "").replace(default.name, p.name)
            conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (f"@{p.id}/{k}", v))
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (flag, utcnow_iso()))
        print(f"[db] проект {p.id}: настройки скопированы из {default.id}", flush=True)
    conn.commit()


def _migrate(conn: sqlite3.Connection) -> None:
    _migrate_projects(conn)
    add_columns = {
        "promocodes": {
            "name": "ALTER TABLE promocodes ADD COLUMN name TEXT",
        },
        "promocode_activations": {
            "discount_percent": "ALTER TABLE promocode_activations ADD COLUMN discount_percent REAL NOT NULL DEFAULT 0",
            "expires_at": "ALTER TABLE promocode_activations ADD COLUMN expires_at TEXT",
        },
        "users": {
            "tracking_code": "ALTER TABLE users ADD COLUMN tracking_code TEXT",
            # белые списки (анти-ключ FURK, как в старом боте): ссылка и срок
            "anti_key": "ALTER TABLE users ADD COLUMN anti_key TEXT",
            "anti_expires_at": "ALTER TABLE users ADD COLUMN anti_expires_at TEXT",
            "anti_key_id": "ALTER TABLE users ADD COLUMN anti_key_id TEXT",
            # платёж, по которому анти-ключ уже выдан (повторная обработка не спишет у FURK второй раз)
            "anti_last_idem": "ALTER TABLE users ADD COLUMN anti_last_idem TEXT",
            # админ сбросил пробный: можно взять снова, даже если раньше была платная подписка
            "trial_reset": "ALTER TABLE users ADD COLUMN trial_reset INTEGER NOT NULL DEFAULT 0",
            # когда принял оферту и политику
            "terms_accepted_at": "ALTER TABLE users ADD COLUMN terms_accepted_at TEXT",
            "first_start_at": "ALTER TABLE users ADD COLUMN first_start_at TEXT",
            # кэш проверки подписки на канал
            "channel_ok": "ALTER TABLE users ADD COLUMN channel_ok INTEGER NOT NULL DEFAULT 0",
            "channel_checked_at": "ALTER TABLE users ADD COLUMN channel_checked_at TEXT",
            # текст причины бана
            "ban_reason": "ALTER TABLE users ADD COLUMN ban_reason TEXT",
            "banned_at": "ALTER TABLE users ADD COLUMN banned_at TEXT",
            # ручной разбан: чёрный список не банит снова
            "blacklist_ignored": "ALTER TABLE users ADD COLUMN blacklist_ignored INTEGER NOT NULL DEFAULT 0",
        },
        "mailings": {
            "channel": "ALTER TABLE mailings ADD COLUMN channel TEXT NOT NULL DEFAULT 'telegram'",
        },
        "support_chats": {
            "open_ticket_id": "ALTER TABLE support_chats ADD COLUMN open_ticket_id INTEGER",
            "last_email_at": "ALTER TABLE support_chats ADD COLUMN last_email_at TEXT",
            "assigned_name": "ALTER TABLE support_chats ADD COLUMN assigned_name TEXT",
        },
        "support_tickets": {
            # отображаемое имя назначенного агента
            "assigned_name": "ALTER TABLE support_tickets ADD COLUMN assigned_name TEXT",
            # id и время сообщения с вопросом о закрытии
            "close_prompt_id": "ALTER TABLE support_tickets ADD COLUMN close_prompt_id INTEGER",
            "prompt_at": "ALTER TABLE support_tickets ADD COLUMN prompt_at TEXT",
            # эскалировано в очередь админа
            "escalated": "ALTER TABLE support_tickets ADD COLUMN escalated INTEGER NOT NULL DEFAULT 0",
            "escalate_note": "ALTER TABLE support_tickets ADD COLUMN escalate_note TEXT",
            # порядок очереди (ответ двигает вниз)
            "queue_at": "ALTER TABLE support_tickets ADD COLUMN queue_at TEXT",
        },
        "panel_staff": {
            "role": "ALTER TABLE panel_staff ADD COLUMN role TEXT NOT NULL DEFAULT 'operator'",  # curator | operator
            "default_pay": "ALTER TABLE panel_staff ADD COLUMN default_pay REAL NOT NULL DEFAULT 0",
            "default_intervals": "ALTER TABLE panel_staff ADD COLUMN default_intervals TEXT",
        },
        "panel_sessions": {
            # null = владелец, иначе id сотрудника
            "staff_id": "ALTER TABLE panel_sessions ADD COLUMN staff_id INTEGER",
            "created_at": "ALTER TABLE panel_sessions ADD COLUMN created_at REAL",
        },
        "temp_2fa": {
            "staff_id": "ALTER TABLE temp_2fa ADD COLUMN staff_id INTEGER",
        },
        "support_files": {
            "storage": "ALTER TABLE support_files ADD COLUMN storage TEXT NOT NULL DEFAULT 'local'",  # local | s3
            "deleted_at": "ALTER TABLE support_files ADD COLUMN deleted_at TEXT",  # удалён при заполнении хранилища
        },
        "support_messages": {
            "ticket_id": "ALTER TABLE support_messages ADD COLUMN ticket_id INTEGER",
            "reply_to": "ALTER TABLE support_messages ADD COLUMN reply_to INTEGER",
            "kind": "ALTER TABLE support_messages ADD COLUMN kind TEXT",  # null | close_prompt | wait
            # служебная заметка только для панели (пользователю скрыта)
            "internal": "ALTER TABLE support_messages ADD COLUMN internal INTEGER NOT NULL DEFAULT 0",
            # автор для правки/удаления своих сообщений
            "author_actor": "ALTER TABLE support_messages ADD COLUMN author_actor TEXT",
            "edited_at": "ALTER TABLE support_messages ADD COLUMN edited_at TEXT",
            "deleted_at": "ALTER TABLE support_messages ADD COLUMN deleted_at TEXT",
            # id сообщения в telegram (правка/удаление вместе)
            "tg_msg_id": "ALTER TABLE support_messages ADD COLUMN tg_msg_id INTEGER",
            # подпись события в панели; '' = скрыть
            "panel_text": "ALTER TABLE support_messages ADD COLUMN panel_text TEXT",
        },
        "team_messages": {
            "edited_at": "ALTER TABLE team_messages ADD COLUMN edited_at TEXT",
        },
        "mon_incidents": {
            # состояние аварии + timeline json
            "state": "ALTER TABLE mon_incidents ADD COLUMN state TEXT",
            "timeline": "ALTER TABLE mon_incidents ADD COLUMN timeline TEXT",
        },
        "mon_nodes": {
            # перезагрузка из панели: короткий простой ожидаем
            "reboot_at": "ALTER TABLE mon_nodes ADD COLUMN reboot_at TEXT",
            # connect_since: опрос, пока агент не ответит
            "connect_since": "ALTER TABLE mon_nodes ADD COLUMN connect_since TEXT",
            # запрос/результат самообновления агента
            "update_target": "ALTER TABLE mon_nodes ADD COLUMN update_target TEXT",
            "update_requested_at": "ALTER TABLE mon_nodes ADD COLUMN update_requested_at TEXT",
            "update_state": "ALTER TABLE mon_nodes ADD COLUMN update_state TEXT",
            "allow_reboot": "ALTER TABLE mon_nodes ADD COLUMN allow_reboot INTEGER",
        },
        "payments": {
            # опция «белые списки» в заказе
            "whitelist": "ALTER TABLE payments ADD COLUMN whitelist INTEGER NOT NULL DEFAULT 0",
            # реф. баланс, замороженный при создании
            "referral_applied": "ALTER TABLE payments ADD COLUMN referral_applied REAL NOT NULL DEFAULT 0",
            # возвраты (refund через провайдера)
            "refunded_at": "ALTER TABLE payments ADD COLUMN refunded_at TEXT",
            "refund_info": "ALTER TABLE payments ADD COLUMN refund_info TEXT",
            # время claim для разбора зависших processing
            "processing_at": "ALTER TABLE payments ADD COLUMN processing_at TEXT",
            # куда вернуться после оплаты + показан ли итог
            "return_to": "ALTER TABLE payments ADD COLUMN return_to TEXT",
            # флаги чарджбека (откат в панели; reported = сообщение провайдера)
            "chargeback_at": "ALTER TABLE payments ADD COLUMN chargeback_at TEXT",
            "chargeback_info": "ALTER TABLE payments ADD COLUMN chargeback_info TEXT",
            "chargeback_reported_at": "ALTER TABLE payments ADD COLUMN chargeback_reported_at TEXT",
            "result_seen_at": "ALTER TABLE payments ADD COLUMN result_seen_at TEXT",
            # payload отката выдачи для возвратов
            "grant_info": "ALTER TABLE payments ADD COLUMN grant_info TEXT",
        },
        "withdrawals": {
            "forum_chat_id": "ALTER TABLE withdrawals ADD COLUMN forum_chat_id TEXT",
            "forum_message_id": "ALTER TABLE withdrawals ADD COLUMN forum_message_id INTEGER",
            # статусы: pending → approved → completed | rejected
            "approved_at": "ALTER TABLE withdrawals ADD COLUMN approved_at TEXT",
            "reject_reason": "ALTER TABLE withdrawals ADD COLUMN reject_reason TEXT",
            "refunded": "ALTER TABLE withdrawals ADD COLUMN refunded INTEGER NOT NULL DEFAULT 0",
        },
        "subscriptions": {
            # до какого момента подключены белые списки (отдельный сквад)
            # устарело: белые списки теперь анти-ключом FURK (users.anti_key), колонка оставлена для совместимости
            "whitelist_until": "ALTER TABLE subscriptions ADD COLUMN whitelist_until TEXT",
            # заморозка (пауза отсчёта дней)
            "frozen_at": "ALTER TABLE subscriptions ADD COLUMN frozen_at TEXT",
            "frozen_remaining": "ALTER TABLE subscriptions ADD COLUMN frozen_remaining INTEGER",
            # последняя заморозка (не чаще раза в день)
            "last_freeze_at": "ALTER TABLE subscriptions ADD COLUMN last_freeze_at TEXT",
            # мягкое удаление после неоплаченного истечения (в истории Deleted)
            "deleted_at": "ALTER TABLE subscriptions ADD COLUMN deleted_at TEXT",
            # админ: без продления (устройства/сброс трафика можно)
            "no_renew": "ALTER TABLE subscriptions ADD COLUMN no_renew INTEGER NOT NULL DEFAULT 0",
            # время предупреждения анти-абуза
            "aa_warned_at": "ALTER TABLE subscriptions ADD COLUMN aa_warned_at TEXT",
            # причина/время бана подписки
            "ban_reason": "ALTER TABLE subscriptions ADD COLUMN ban_reason TEXT",
            "banned_at": "ALTER TABLE subscriptions ADD COLUMN banned_at TEXT",
            # ключ цикла grace + until (null = неактивен)
            "grace_cycle": "ALTER TABLE subscriptions ADD COLUMN grace_cycle TEXT",
            "grace_until": "ALTER TABLE subscriptions ADD COLUMN grace_until TEXT",
            # снимок remnawave до grace (для ui)
            "grace_snapshot": "ALTER TABLE subscriptions ADD COLUMN grace_snapshot TEXT",
            # API v1: NULL | provisioning (есть задача в provisioning_jobs) | failed
            "sync_state": "ALTER TABLE subscriptions ADD COLUMN sync_state TEXT",
        },
    }
    for table, cols in add_columns.items():
        try:
            existing = _column_names(conn, table)
        except sqlite3.Error:
            continue
        for col, ddl in cols.items():
            if col not in existing:
                try:
                    conn.execute(ddl)
                except sqlite3.Error:
                    pass
    # одна активация промо на пользователя
    try:
        conn.execute(
            "DELETE FROM promocode_activations WHERE id NOT IN "
            "(SELECT MIN(id) FROM promocode_activations GROUP BY promocode_id, user_id)"
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_act_unique "
            "ON promocode_activations(promocode_id, user_id)"
        )
    except sqlite3.Error:
        pass
    # одноразово: стереть plaintext токены сессий (теперь хеш)
    try:
        done = conn.execute("SELECT value FROM settings WHERE key = 'sessions_hashed'").fetchone()
        if done is None:
            for t in ("app_sessions", "panel_sessions", "temp_2fa"):
                conn.execute(f"DELETE FROM {t}")
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('sessions_hashed', '1')")
    except sqlite3.Error:
        pass
    # скрыть системный промо DRIP10; убрать длинные фейковые активации
    try:
        row = conn.execute("SELECT id FROM promocodes WHERE code = 'DRIP10'").fetchone()
        if row is not None:
            conn.execute("UPDATE promocodes SET is_active = 0 WHERE id = ?", (row["id"],))
            conn.execute(
                "DELETE FROM promocode_activations WHERE promocode_id = ? "
                "AND julianday(expires_at) - julianday(created_at) > 2",
                (row["id"],),
            )
    except sqlite3.Error:
        pass
    # миграция assigned_admin login → owner|staff:<id>
    try:
        for t in ("support_tickets", "support_chats"):
            conn.execute(f"UPDATE {t} SET assigned_admin = 'owner', assigned_name = COALESCE(assigned_name, 'Администратор') "
                         f"WHERE assigned_admin IS NOT NULL AND assigned_admin != 'owner' AND assigned_admin NOT LIKE 'staff:%'")
    except sqlite3.Error:
        pass
    # одноразово: support full → curator, иначе operator
    try:
        done = conn.execute("SELECT value FROM settings WHERE key = 'staff_roles_v2'").fetchone()
        if done is None:
            for r in conn.execute("SELECT id, permissions FROM panel_staff").fetchall():
                try:
                    perms = json.loads(r["permissions"] or "{}")
                except ValueError:
                    perms = {}
                role = "curator" if perms.get("support") == "full" else "operator"
                conn.execute("UPDATE panel_staff SET role = ? WHERE id = ?", (role, r["id"]))
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('staff_roles_v2', '1')")
    except sqlite3.Error:
        pass
    # одноразово: стереть имя/фамилию telegram
    try:
        done = conn.execute("SELECT value FROM settings WHERE key = 'names_wiped'").fetchone()
        if done is None:
            conn.execute("UPDATE users SET first_name = NULL, last_name = NULL")
            try:
                conn.execute("UPDATE tracking_link_users SET full_name = NULL")
            except sqlite3.Error:
                pass
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('names_wiped', '1')")
    except sqlite3.Error:
        pass
    # реф. бонус привязан к pay:<id> с этого момента
    try:
        conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('ref_hash_since', ?)", (utcnow_iso(),))
    except sqlite3.Error:
        pass
    try:
        conn.execute("INSERT OR IGNORE INTO trial_claims (project_id, telegram_id, user_id, claimed_at) "
                     "SELECT u.project_id, u.telegram_id, MIN(u.id), COALESCE(MIN(s.created_at), CURRENT_TIMESTAMP) "
                     "FROM subscriptions s JOIN users u ON u.id = s.user_id "
                     "WHERE s.type = 'trial' AND u.telegram_id IS NOT NULL GROUP BY u.project_id, u.telegram_id")
    except sqlite3.Error:
        pass
    try:
        conn.execute("UPDATE support_tickets SET queue_at = opened_at WHERE queue_at IS NULL")
    except sqlite3.Error:
        pass
    # система опросов удалена: её таблицы больше не нужны
    try:
        for t in ("survey_answers", "survey_state", "survey_invites"):
            conn.execute(f"DROP TABLE IF EXISTS {t}")
        conn.execute("DELETE FROM settings WHERE key LIKE 'survey%'")
    except sqlite3.Error:
        pass
    # тариф по умолчанию — 2 устройства + доплата за каждое следующее (раньше было 3); один раз
    try:
        done = conn.execute("SELECT value FROM settings WHERE key = 'tariff_devices_v2'").fetchone()
        if not done:
            conn.execute("UPDATE settings SET value = '2' WHERE key = 'tariff_devices' AND value = '3'")
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('tariff_devices_v2', '1')")
    except sqlite3.Error:
        pass
    # пометки «брал пробный» от удалённых через панель аккаунтов: вернувшийся человек — как новый (один раз)
    try:
        done = conn.execute("SELECT value FROM settings WHERE key = 'trial_claims_orphans_v1'").fetchone()
        if not done:
            conn.execute("DELETE FROM trial_claims WHERE user_id IS NOT NULL "
                         "AND user_id NOT IN (SELECT id FROM users)")
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('trial_claims_orphans_v1', '1')")
    except sqlite3.Error:
        pass
    # источник сессии мини-приложения: miniapp (Telegram) / web (сайт) — для пробного отдельно
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(app_sessions)").fetchall()]
        if "source" not in cols:
            conn.execute("ALTER TABLE app_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'web'")
    except sqlite3.Error:
        pass
    # канал для проверки подписки сменился: задание «Подпишись на канал» — на новый канал
    try:
        conn.execute("UPDATE tasks SET channel_id = '@BATMANNETWORK', url = 'https://t.me/BATMANNETWORK' "
                     "WHERE code = 'channel' AND kind = 'channel'")
    except sqlite3.Error:
        pass
    # уникальный provider_payment_id (защита от повторного callback)
    try:
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_pid "
            "ON payments(provider_payment_id) WHERE provider_payment_id IS NOT NULL"
        )
    except sqlite3.Error:
        pass
    conn.commit()


DEFAULT_OFFER = """1. Общие положения
Это договор на доступ к BatmanVPN. Если вы оплатили тариф или включили пробный, вы согласны с этими условиями.

2. Что вы получаете
Мы даём ссылку подписки. Её вставляют в хаб. Само приложение сеть не включает.

3. Оплата
Цена видна до оплаты. Комиссии за оплату нет. Пробный период короткий.

4. Устройства
Ссылка рассчитана на то число устройств, которое вы выбрали при покупке.

5. Сбои
Стараемся держать доступ, но конкретный оператор может резать сеть. По возврату пишите в поддержку.
"""

DEFAULT_PRIVACY = """1. Какие данные мы храним
Telegram ID, имя и username из Telegram, данные об оплатах и подписке.

2. Зачем
Чтобы выдать доступ, принять оплату и ответить в поддержке.

3. Кому передаём
Платёжным сервисам — только то, что нужно для оплаты.

4. Вопросы
По вопросам о ваших данных пишите в поддержку.
"""


def _seed_defaults(conn: sqlite3.Connection) -> None:
    defaults = {
        "offer_text": DEFAULT_OFFER,
        "privacy_text": DEFAULT_PRIVACY,
        "extra_device_price": "40",
        # базовая цена = 1 устройство/мес; дальше extra_device_price
        "base_price": "99",
        # дефолты пробного периода
        "trial_days": "3",
        "trial_traffic_gb": "5",
        "trial_devices": "1",
        # трафик платной подписки, гб/мес
        "paid_traffic_gb": "100",
        "backup_enabled": "0",
        "backup_interval_hours": "12",
        "backup_last": "",
        "squad_mapping_vpn": "[]",
        "squad_mapping_trial": "[]",
        # цена досрочного сброса трафика; 0 = выкл
        "traffic_reset_price": "0",
        # анти-абуз вкл/выкл
        "antiabuse_enabled": "1",
        # grace: резервный сквад + небольшой трафик после окончания; 0 = выкл
        "grace_enabled": "0",
        "grace_squads": "[]",
        "grace_traffic_gb": "1",
        "grace_trial": "0",
    }
    # миграция base_price со старого тарифа на 1 устройство
    try:
        old_one = conn.execute("SELECT price_rub FROM plans WHERE devices = 1").fetchone()
        if old_one is not None:
            defaults["base_price"] = str(int(float(old_one["price_rub"])) if float(old_one["price_rub"]).is_integer() else float(old_one["price_rub"]))
    except sqlite3.Error:
        pass
    for k, v in defaults.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (k, v),
        )

    plan_count = conn.execute("SELECT COUNT(*) AS c FROM plans").fetchone()["c"]
    if plan_count == 0:
        plans = [
            (1, 99, 99, 1, 1),
            (2, 169, 169, 1, 2),
            (3, 229, 229, 1, 3),
            (5, 349, 349, 1, 4),
        ]
        conn.executemany(
            "INSERT INTO plans (devices, price_rub, price_stars, is_active, sort_order) VALUES (?, ?, ?, ?, ?)",
            plans,
        )
    conn.commit()
    _seed_projects(conn)


def get_setting(key: str, default: str = "", *, project: Optional[str] = None) -> str:
    """цены, тарифы, пробный и т.п. — свои у каждого проекта (projects.PROJECT_SETTING_KEYS), остальное общее."""
    row = fetchone("SELECT value FROM settings WHERE key = ?", (projects.setting_key(key, project),))
    return row["value"] if row else default


def set_setting(key: str, value: str, *, project: Optional[str] = None) -> None:
    execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (projects.setting_key(key, project), value),
    )


def get_settings(keys: list[str], *, project: Optional[str] = None) -> dict[str, str]:
    if not keys:
        return {}
    real = {projects.setting_key(k, project): k for k in keys}
    placeholders = ",".join("?" * len(real))
    rows = fetchall(f"SELECT key, value FROM settings WHERE key IN ({placeholders})", list(real))
    return {real[r["key"]]: r["value"] for r in rows}


def pid() -> str:
    """проект текущего запроса / задачи."""
    return projects.current_id()


def dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def loads(raw: Optional[str], default: Any = None) -> Any:
    if not raw:
        return default if default is not None else None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default if default is not None else None
