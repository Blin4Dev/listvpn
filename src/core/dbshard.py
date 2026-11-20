# База по проектам: у каждого бота свой файл data/projects/<id>.db, общее (панель, сотрудники, серверы,
# настройки, мониторинг) — в data/core.db.
#
# Как это работает, не трогая остальной код:
#   • одно соединение: core.db — main, файлы проектов подключены (ATTACH) как p_<id>;
#   • чтение: для каждой таблицы проекта — временное представление с тем же именем, склеивающее строки всех
#     файлов (UNION ALL). Поэтому любой SELECT (по номеру, по проекту, сводный по сети) видит то же, что в одной базе;
#   • запись: INSERT кладёт строку в файл её проекта (project_id → владелец родительской записи → проект запроса),
#     INSERT … SELECT / UPDATE / DELETE выполняются в каждом файле; changes() / rowcount — сумма по файлам;
#   • CREATE / ALTER / DROP таблиц проекта применяются ко всем файлам проектов, остальные — к core.db;
#   • новые номера у каждого проекта из своего диапазона ((№ проекта + 1) × 10⁹), старые номера сохраняются —
#     номер записи однозначен во всей сети, как и раньше.
#
# Переход со старой одной базы data/data.db (split_from_legacy) — один раз, при первом запуске:
# копия старой базы в backups/, раскладка по файлам, сверка каждой таблицы построчно, при любом расхождении —
# откат (остаётся одна база, работа продолжается как раньше). Старая база переименовывается в data.db.pre-split.
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import time
from typing import Any, Callable, Iterable, Optional

# ── какие таблицы чьи ──
# таблицы проекта (строки принадлежат одному боту); всё остальное — общее (core.db)
PROJECT_TABLES: tuple[str, ...] = (
    "users", "subscriptions", "payments", "transactions", "purchases", "withdrawals", "day_gifts", "compensations",
    "support_chats", "support_messages", "support_tickets", "support_files",
    "promocodes", "promocode_activations", "promotions", "tracking_links", "tracking_link_users",
    "mailings", "mailing_messages", "tasks", "user_tasks", "tariffs",
    "family_codes", "family_members", "referral_rewards", "referral_ledger", "device_addons",
    "onboarding_reminders", "sub_reminders", "user_notices", "vpn_sessions", "vpn_network_days",
    "trial_claims", "trial_checks", "trial_hwids", "trial_hwid_bans",
    "app_sessions", "api_sessions", "app_devices", "app_login_tickets", "app_keys",
    "provisioning_jobs", "rw_legacy_users", "moderation_events",
)
PROJECT_SET = frozenset(PROJECT_TABLES)

# чей это ряд, если нет project_id: столбец → таблица-родитель (по порядку важности)
_U = [("user_id", "users")]
LINKS: dict[str, list[tuple[str, str]]] = {
    "users": [],
    "subscriptions": _U, "payments": _U, "transactions": _U, "withdrawals": _U, "day_gifts": _U,
    "compensations": _U, "support_chats": _U, "referral_rewards": _U, "referral_ledger": _U, "device_addons": _U,
    "onboarding_reminders": _U, "user_notices": _U, "vpn_sessions": _U, "vpn_network_days": _U,
    "trial_claims": _U, "trial_hwids": _U, "trial_hwid_bans": _U, "app_sessions": _U, "api_sessions": _U,
    "app_login_tickets": _U, "provisioning_jobs": _U, "rw_legacy_users": _U, "moderation_events": _U,
    "purchases": [("user_id", "users"), ("subscription_id", "subscriptions")],
    "support_messages": [("chat_id", "support_chats")],
    "support_tickets": [("chat_id", "support_chats")],
    "support_files": [("chat_id", "support_chats")],
    "promocode_activations": [("user_id", "users"), ("promocode_id", "promocodes")],
    "tracking_link_users": [("link_id", "tracking_links"), ("user_id", "users")],
    "mailing_messages": [("mailing_id", "mailings")],
    "user_tasks": [("user_id", "users"), ("task_id", "tasks")],
    "family_codes": [("owner_id", "users")],
    "family_members": [("owner_id", "users"), ("member_id", "users")],
    "sub_reminders": [("subscription_id", "subscriptions")],
    "trial_checks": [("user_id", "users"), ("subscription_id", "subscriptions")],
    "app_devices": [("owner_user_id", "users"), ("user_id", "users")],
    "promocodes": [], "promotions": [], "tracking_links": [], "mailings": [], "tasks": [], "tariffs": [],
    "app_keys": [],
}

# уникальные во всей сети значения (в одной базе их держал UNIQUE; теперь файлов несколько — проверяем сами):
# промокод, код ссылки, реф. код… не могут совпасть у двух проектов, как и раньше
GLOBAL_UNIQUE: dict[str, tuple[str, ...]] = {
    "users": ("referral_code",), "payments": ("payment_id",), "purchases": ("payment_id",),
    "promocodes": ("code",), "tracking_links": ("code",), "tasks": ("code",), "family_codes": ("code",),
    "referral_rewards": ("code",), "app_sessions": ("token",), "api_sessions": ("refresh_hash",),
    "app_login_tickets": ("ticket_hash",), "app_keys": ("key_hash",), "rw_legacy_users": ("username", "rw_id"),
}

ID_SPAN = 1_000_000_000  # диапазон номеров проекта: (№ + 1) × ID_SPAN …
MAX_FILES = 10           # sqlite: не больше 10 подключённых файлов

MARKER = "db-split.json"
FAILED = "db-split.failed"


def base_name(name: str) -> str:
    """users__new → users (временные таблицы пересборки относятся к той же таблице)."""
    return name.split("__", 1)[0].lower()


def is_project_table(name: str) -> bool:
    return base_name(name.strip('"`[]')) in PROJECT_SET


def alias_of(pid: str) -> str:
    return "p_" + re.sub(r"[^a-z0-9_]", "_", pid.lower())


def data_dir(db_path: str) -> str:
    return os.path.dirname(os.path.abspath(db_path))


def core_path(db_path: str) -> str:
    return os.path.join(data_dir(db_path), "core.db")


def projects_dir(db_path: str) -> str:
    return os.path.join(data_dir(db_path), "projects")


def project_path(db_path: str, pid: str) -> str:
    return os.path.join(projects_dir(db_path), f"{pid}.db")


def marker_path(db_path: str) -> str:
    return os.path.join(data_dir(db_path), MARKER)


def failed_path(db_path: str) -> str:
    return os.path.join(data_dir(db_path), FAILED)


def read_marker(db_path: str) -> Optional[dict[str, Any]]:
    try:
        with open(marker_path(db_path), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _write_json(path: str, data: dict[str, Any]) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def _chmod(path: str) -> None:
    try:
        os.chmod(path, 0o640)
    except OSError:
        pass


# ───────────────────────── разбор SQL ─────────────────────────

_STR = re.compile(r"'(?:[^']|'')*'|--[^\n]*|/\*.*?(?:\*/|$)", re.S)
_WRITE_HEAD = re.compile(
    r"^\s*(?P<verb>INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+"
    r"(?P<name>[\"`\[]?[A-Za-z_][\w]*[\"`\]]?)(?P<dot>\s*\.\s*[A-Za-z_]\w*)?",
    re.I | re.S)
_FROM_REF = re.compile(r"(\b(?:FROM|JOIN)\s+)([A-Za-z_]\w*)\b(?!\s*\.)", re.I)
_PRAGMA_T = re.compile(r"^\s*PRAGMA\s+(?:(\w+)\s*\.\s*)?(table_info|table_xinfo|index_list|foreign_key_list|index_info|index_xinfo)"
                       r"\s*\(\s*['\"]?([\w]+)['\"]?\s*\)\s*;?\s*$", re.I)


def _mask_strings(sql: str) -> str:
    """строки, идентификаторы в кавычках и комментарии → пробелы той же длины (поиск ключевых слов и ?;
    позиции в тексте не сдвигаются)."""
    return _STR.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), sql)


def split_statements(script: str) -> list[str]:
    out, buf = [], ""
    for part in script.split(";"):
        buf += part + ";"
        if sqlite3.complete_statement(buf):
            st = buf.strip()
            if st.strip(";").strip():
                out.append(st)
            buf = ""
    if buf.strip().strip(";").strip():
        out.append(buf.strip())
    return out


def _split_top(s: str) -> list[tuple[int, int]]:
    """границы элементов списка через запятую верхнего уровня (s — без строк)."""
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(s):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append((start, i))
            start = i + 1
    parts.append((start, len(s)))
    return parts


def _match_paren(s: str, i: int) -> int:
    depth = 0
    for j in range(i, len(s)):
        if s[j] == "(":
            depth += 1
        elif s[j] == ")":
            depth -= 1
            if depth == 0:
                return j
    return -1


def _value_of(raw_sql: str, masked: str, a: int, b: int, params: Any) -> tuple[bool, Any]:
    """значение элемента VALUES: ?, ?NNN или строка/число в SQL. (известно, значение)"""
    tok = masked[a:b].strip()
    raw = raw_sql[a:b].strip()
    if tok == "?":
        if isinstance(params, (list, tuple)):
            idx = masked[:a].count("?")
            # ?NNN выше по тексту сдвигают нумерацию — тогда не угадываем
            if re.search(r"\?\d", masked[:a]):
                return False, None
            if idx < len(params):
                return True, params[idx]
        return False, None
    m = re.fullmatch(r"\?(\d+)", tok)
    if m and isinstance(params, (list, tuple)):
        k = int(m.group(1)) - 1
        return (True, params[k]) if 0 <= k < len(params) else (False, None)
    if raw.startswith("'") and raw.endswith("'") and len(raw) >= 2:
        return True, raw[1:-1].replace("''", "'")
    if re.fullmatch(r"-?\d+", raw):
        return True, int(raw)
    if raw.upper() == "NULL":
        return True, None
    return False, None


# ───────────────────────── соединение с маршрутизацией ─────────────────────────

class _Rows:
    """результат записи сразу в несколько файлов: rowcount — сумма, строки RETURNING — вместе."""

    def __init__(self, rows: list, rowcount: int, lastrowid: Optional[int] = None, description=None):
        self._rows = rows
        self._i = 0
        self.rowcount = rowcount
        self.lastrowid = lastrowid
        self.description = description

    def fetchone(self):
        if self._i < len(self._rows):
            r = self._rows[self._i]
            self._i += 1
            return r
        return None

    def fetchall(self):
        r = self._rows[self._i:]
        self._i = len(self._rows)
        return r

    def fetchmany(self, size: int = 1):
        r = self._rows[self._i:self._i + size]
        self._i += len(r)
        return r

    def __iter__(self):
        while True:
            r = self.fetchone()
            if r is None:
                return
            yield r

    def close(self) -> None:
        pass


class ShardedConnection:
    """обёртка над sqlite3-соединением core.db + файлы проектов; остальной код работает как с одной базой."""

    def __init__(self, raw: sqlite3.Connection, files: dict[str, str], ref: str,
                 current: Callable[[], str]):
        self.raw = raw
        self.files = dict(files)                 # pid → alias
        self.aliases = {a: p for p, a in files.items()}
        self.ref = ref                           # alias файла-образца (проект по умолчанию)
        self._current = current
        self._multi_changes: Optional[int] = None
        self._views_dirty = True
        self._view_sig = None
        self._seq_checked: set[tuple[str, str]] = set()
        self._sig_checked_at = 0.0

    # — проксирование —
    def __getattr__(self, item):
        return getattr(self.raw, item)

    @property
    def row_factory(self):
        return self.raw.row_factory

    @row_factory.setter
    def row_factory(self, v):
        self.raw.row_factory = v

    @property
    def total_changes(self) -> int:
        return self.raw.total_changes

    @property
    def in_transaction(self) -> bool:
        return self.raw.in_transaction

    def commit(self) -> None:
        self.raw.commit()

    def rollback(self) -> None:
        self.raw.rollback()

    def cursor(self):
        return _CursorShim(self)

    def close(self) -> None:
        self.raw.close()

    # — представления (чтение всех файлов как одной таблицы) —
    def _tables_in(self, alias: str) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        for r in self.raw.execute(f"SELECT name FROM {alias}.sqlite_master WHERE type = 'table'").fetchall():
            name = r[0]
            if name in PROJECT_SET:
                out[name] = [c[1] for c in self.raw.execute(f"PRAGMA {alias}.table_info(\"{name}\")").fetchall()]
        return out

    def schema_signature(self) -> tuple:
        sig = []
        for alias in [self.ref] + [a for a in self.aliases if a != self.ref]:
            sig.append(self.raw.execute(f"PRAGMA {alias}.schema_version").fetchone()[0])
        return tuple(sig)

    def rebuild_views(self, force: bool = False) -> None:
        sig = self.schema_signature()
        if not force and not self._views_dirty and sig == self._view_sig:
            return
        per_file = {a: self._tables_in(a) for a in self.aliases}
        ref_tables = per_file.get(self.ref, {})
        existing = {r[0] for r in self.raw.execute("SELECT name FROM temp.sqlite_master WHERE type = 'view'").fetchall()}
        for name in PROJECT_TABLES:
            if name in existing:
                self.raw.execute(f"DROP VIEW temp.\"{name}\"")
            # столбцы: порядок файла-образца, затем те, что есть только в других файлах
            cols: list[str] = list(ref_tables.get(name, []))
            for a, tables in per_file.items():
                for c in tables.get(name, []):
                    if c not in cols:
                        cols.append(c)
            parts = []
            for a in [self.ref] + [x for x in self.aliases if x != self.ref]:
                have = per_file.get(a, {}).get(name)
                if have is None:
                    continue
                sel = ", ".join(f'"{c}"' if c in have else f'NULL AS "{c}"' for c in cols)
                parts.append(f'SELECT {sel} FROM {a}."{name}"')
            if parts:
                self.raw.execute(f'CREATE TEMP VIEW "{name}" AS ' + " UNION ALL ".join(parts))
        self._views_dirty = False
        self._view_sig = self.schema_signature()

    def check_views(self, now: Optional[float] = None) -> None:
        """перед запросом: схема поменялась (этим соединением или другим процессом) — пересобрать представления.
        Чужие изменения проверяются не чаще раза в секунду; если запрос всё же упал на новом столбце — см. _retry."""
        if self._views_dirty:
            if self.schema_signature() != self._view_sig:
                self.rebuild_views(force=True)
            self._views_dirty = False
            return
        now = time.monotonic() if now is None else now
        if now - self._sig_checked_at >= 1.0:
            self._sig_checked_at = now
            if self.schema_signature() != self._view_sig:
                self.rebuild_views(force=True)

    def _retry(self, fn: Callable[[], Any]):
        try:
            return fn()
        except sqlite3.OperationalError as exc:
            msg = str(exc).lower()
            if "no such column" in msg or "no such table" in msg or "has no column" in msg:
                self.rebuild_views(force=True)
                return fn()
            raise

    # — владелец записи —
    def owner_of(self, table: str, rid: Any) -> Optional[str]:
        """в каком файле лежит запись table.id = rid."""
        if rid is None or rid == "":
            return None
        for pid, alias in self.files.items():
            try:
                if self.raw.execute(f'SELECT 1 FROM {alias}."{table}" WHERE id = ? LIMIT 1', (rid,)).fetchone():
                    return pid
            except sqlite3.Error:
                continue
        return None

    def _norm_pid(self, v: Any) -> Optional[str]:
        if v is None:
            return None
        s = str(v).strip().lower()
        return s if s in self.files else None

    def _table_columns(self, table: str) -> list[str]:
        return [c[1] for c in self.raw.execute(f'PRAGMA {self.ref}.table_info("{table}")').fetchall()]

    def parse_insert(self, sql: str, params: Any, table: str) -> Optional[dict[str, tuple[bool, Any]]]:
        """INSERT … VALUES (…): столбец → (значение известно, значение). None — не VALUES."""
        masked = _mask_strings(sql)
        m = _WRITE_HEAD.match(masked)
        pos = m.end() if m else 0
        rest = masked[pos:]
        cols: Optional[list[str]] = None
        mm = re.match(r"\s*\(", rest)
        if mm:
            a = pos + mm.end() - 1
            b = _match_paren(masked, a)
            if b > a:
                cols = [re.sub(r'["`\[\]\s]', "", masked[a + 1:b][x:y]).lower() for x, y in _split_top(masked[a + 1:b])]
                pos = b + 1
        vm = re.match(r"\s*VALUES\s*\(", masked[pos:], re.I)
        if not vm:
            return None  # INSERT … SELECT / DEFAULT VALUES — решает вызывающий
        a = pos + vm.end() - 1
        b = _match_paren(masked, a)
        if b < 0:
            return None
        if cols is None:
            cols = [c.lower() for c in self._table_columns(table)]
        vals: dict[str, tuple[bool, Any]] = {}
        for i, (x, y) in enumerate(_split_top(masked[a + 1:b])):
            if i < len(cols):
                vals[cols[i]] = _value_of(sql, masked, a + 1 + x, a + 1 + y, params)
        return vals

    def target_for_insert(self, sql: str, params: Any, table: str,
                          vals: Optional[dict[str, tuple[bool, Any]]] = None) -> Optional[str]:
        """файл для INSERT … VALUES: project_id → владелец родителя → проект запроса."""
        if vals is None:
            vals = self.parse_insert(sql, params, table)
        if vals is None:
            return None
        known, v = vals.get("project_id", (False, None))
        if known and self._norm_pid(v):
            return self._norm_pid(v)
        for col, parent in LINKS.get(base_name(table), []):
            known, v = vals.get(col, (False, None))
            if known and v not in (None, ""):
                owner = self.owner_of(parent, v)
                if owner:
                    return owner
        return None

    def _context_pid(self) -> str:
        p = self._norm_pid(self._current())
        return p or self.aliases[self.ref]

    # — выполнение —
    def execute(self, sql: str, params: Any = ()):
        masked = _mask_strings(sql).lstrip()
        head = masked[:12].upper()
        if head.startswith(("CREATE", "DROP", "ALTER")):
            # как у sqlite3 в Python: схема без открытой транзакции применяется сразу (автокоммит);
            # во всех файлах — под одной блокировкой
            if self.raw.in_transaction or re.match(r"CREATE\s+TEMP", masked, re.I):
                return self._ddl(sql, params)
            self.raw.execute("BEGIN IMMEDIATE")
            try:
                res = self._ddl(sql, params)
                self.raw.commit()
                return res
            except BaseException:
                self.raw.rollback()
                raise
        if head.startswith(("BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE", "VACUUM", "ATTACH", "DETACH", "ANALYZE")):
            return self.raw.execute(sql, params)
        self.check_views()
        if head.startswith(("SELECT", "WITH", "VALUES")):
            if re.match(r"SELECT\s+CHANGES\s*\(\s*\)", masked, re.I) and self._multi_changes is not None:
                return self.raw.execute("SELECT ? AS n", (self._multi_changes,))
            if "sqlite_master" in masked or "sqlite_schema" in masked:
                sql = self._route_master(sql, params)
            else:
                sql = self._pin_select(sql, params) or sql
            return self._retry(lambda: self.raw.execute(sql, params))
        if head.startswith("PRAGMA"):
            return self.raw.execute(self._route_pragma(sql), params)
        if head.startswith(("INSERT", "REPLACE", "UPDATE", "DELETE")):
            self._begin_write()
            # без повтора: запись могла уже пройти в части файлов
            return self._write(sql, params)
        return self.raw.execute(sql, params)

    def _begin_write(self) -> None:
        """запись без открытой транзакции: сразу BEGIN IMMEDIATE — блокировка записи во всех файлах разом
        (иначе запись во второй файл после чтения первого может упасть «database is locked» без ожидания).
        Коммит — как раньше: db.execute / commit() вызывающего."""
        if not self.raw.in_transaction:
            self.raw.execute("BEGIN IMMEDIATE")

    def executemany(self, sql: str, seq: Iterable):
        self.check_views()
        self._begin_write()
        m = _WRITE_HEAD.match(_mask_strings(sql))
        if not m or m.group("dot") or not is_project_table(m.group("name")):
            self._multi_changes = None
            return self.raw.executemany(sql, seq)
        total = 0
        for params in seq:
            cur = self._write(sql, params)
            total += max(0, int(getattr(cur, "rowcount", 0) or 0))
        self._multi_changes = total
        return _Rows([], total)

    def executescript(self, script: str):
        # как у sqlite3: сначала закрыть открытую транзакцию
        if self.raw.in_transaction:
            self.raw.commit()
        for st in split_statements(script):
            self.execute(st)
        self.raw.commit()
        return _Rows([], 0)

    # — ускорение: выборка строго одного проекта по связям «владелец» читается из его файла напрямую —
    _PIN_TAIL = re.compile(r"\b(WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING|WINDOW)\b", re.I)
    _PIN_JOIN = re.compile(r"\b(?:(?:LEFT|INNER)(?:\s+OUTER)?\s+)?JOIN\b", re.I)
    _PIN_REF = re.compile(r"^\s*([A-Za-z_]\w*)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?\s*$", re.I)
    _PIN_EQ = re.compile(r"^\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*$")

    def _pin_select(self, sql: str, params: Any) -> Optional[str]:
        """SELECT … FROM a [LEFT] JOIN b ON b.id = a.user_id … WHERE … a.project_id = ? …  (без подзапросов)
        → таблицы проекта читаются из файла этого проекта (с индексами), а не через общее представление.
        Строки одного проекта и всё, что с ними связано по номеру владельца, лежат в одном файле, поэтому
        результат тот же. Любое сомнение (подзапрос, запятая во FROM, другое условие соединения) — не трогаем."""
        masked = _mask_strings(sql)
        up = masked.upper()
        if up.count("SELECT") != 1 or re.search(r"\b(UNION|INTERSECT|EXCEPT|WITH|NATURAL|USING|RIGHT|FULL|CROSS)\b", up):
            return None
        fm = re.search(r"\bFROM\b", masked, re.I)
        if not fm:
            return None
        tm = self._PIN_TAIL.search(masked, fm.end())
        from_end = tm.start() if tm else len(masked)
        body = masked[fm.end():from_end]
        if "," in body or "(" in body:
            return None
        # FROM t [a] (JOIN t [a] ON x.c = y.c)*
        pieces = self._PIN_JOIN.split(body)
        refs: list[tuple[str, str, int, int]] = []   # (таблица, псевдоним, начало имени, конец имени) в sql
        conds: list[str] = []
        pos = fm.end()
        for i, piece in enumerate(pieces):
            start = masked.index(piece, pos) if piece else pos
            pos = start + len(piece)
            if i == 0:
                ref_txt, cond = piece, None
            else:
                on = re.search(r"\bON\b", piece, re.I)
                if not on:
                    return None
                ref_txt, cond = piece[:on.start()], piece[on.end():]
            m = self._PIN_REF.match(ref_txt)
            if not m:
                return None
            name = m.group(1)
            alias = m.group(2) or name
            if alias.upper() in ("ON", "WHERE", "LEFT", "INNER", "JOIN"):
                return None
            off = start + ref_txt.index(name)
            refs.append((name, alias, off, off + len(name)))
            if cond is not None:
                conds.append(cond)
        ptabs = {a.lower(): t.lower() for t, a, _, _ in refs if t.lower() in PROJECT_SET}
        if not ptabs or any(t != base_name(t) for t in ptabs.values()):
            return None
        alias_tab = {a.lower(): t.lower() for t, a, _, _ in refs}
        # каждое соединение с таблицей проекта — по связи владельца: x.id = y.<связь на x> (в любую сторону)
        for k, cond in enumerate(conds):
            t_new = refs[k + 1][0].lower()
            m = self._PIN_EQ.match(cond)
            if not m:
                if t_new in PROJECT_SET:
                    return None
                continue
            a1, c1, a2, c2 = m.group(1).lower(), m.group(2).lower(), m.group(3).lower(), m.group(4).lower()
            t1, t2 = alias_tab.get(a1), alias_tab.get(a2)
            if t1 not in PROJECT_SET or t2 not in PROJECT_SET:
                if t_new in PROJECT_SET:
                    return None
                continue
            ok = (c1 == "id" and (c2, t1) in LINKS.get(t2, [])) or (c2 == "id" and (c1, t2) in LINKS.get(t1, []))
            if not ok:
                return None
        # условие проекта: <псевдоним таблицы проекта>.project_id = ? | 'id' — ровно одно, верхним уровнем (AND)
        where = masked[from_end:]
        hits = list(re.finditer(r"(?:\b([A-Za-z_]\w*)\.)?\bproject_id\s*=\s*(\?|'[^']*')", where))
        if len(hits) != 1 or re.search(r"\bOR\b", where, re.I):
            return None
        h = hits[0]
        if h.group(1) and h.group(1).lower() not in ptabs:
            return None
        if not h.group(1) and len(ptabs) != 1:
            return None
        if h.group(2) == "?":
            before = masked[:from_end + h.start()]
            if re.search(r"\?\d", masked) or not isinstance(params, (list, tuple)):
                return None
            idx = before.count("?")
            if idx >= len(params):
                return None
            pid = self._norm_pid(params[idx])
        else:
            pid = self._norm_pid(sql[from_end + h.start(2) + 1:from_end + h.end(2) - 1])
        if not pid:
            return None
        file_alias = self.files[pid]
        out, last = [], 0
        for t, a, s0, e0 in refs:
            if t.lower() in PROJECT_SET:
                out.append(sql[last:s0] + f'{file_alias}."{t}"' + ("" if a != t else f' AS "{t}"'))
                last = e0
        out.append(sql[last:])
        return "".join(out)

    def _route_master(self, sql: str, params: Any) -> str:
        """sqlite_master про таблицу проекта (схема) → смотреть в файл-образец."""
        names = set(re.findall(r"'([A-Za-z_]\w*)'", sql))
        if isinstance(params, (list, tuple)):
            names |= {str(p) for p in params if isinstance(p, str)}
        if any(is_project_table(n) for n in names):
            sql = re.sub(r"\b(?:main\.)?sqlite_(master|schema)\b", f"{self.ref}.sqlite_\\1", sql, count=1)
        return sql

    def _route_pragma(self, sql: str) -> str:
        m = _PRAGMA_T.match(sql)
        if not m or m.group(1):
            return sql
        kind, name = m.group(2).lower(), m.group(3)
        if kind in ("index_info", "index_xinfo"):
            if self.raw.execute("SELECT 1 FROM main.sqlite_master WHERE name = ?", (name,)).fetchone():
                return sql
            return f"PRAGMA {self.ref}.{kind}(\"{name}\")"
        if is_project_table(name):
            return f"PRAGMA {self.ref}.{kind}(\"{name}\")"
        return sql

    def _write(self, sql: str, params: Any):
        masked = _mask_strings(sql)
        m = _WRITE_HEAD.match(masked)
        if not m or m.group("dot") or not is_project_table(m.group("name")):
            self._multi_changes = None
            return self.raw.execute(sql, params)
        table = m.group("name").strip('"`[]')
        verb = m.group("verb").split()[0].upper()
        a, b = m.span("name")

        def at(alias: str, text: str = sql) -> str:
            return text[:a] + f'{alias}."{table}"' + text[b:]

        if verb in ("INSERT", "REPLACE"):
            rest = masked[b:]
            is_select = re.match(r"\s*(\([^)]*\)\s*)?(SELECT|WITH)\b", rest, re.I | re.S)
            if is_select:
                sel_at = b + is_select.start(2)
                if _top_level_from_project(masked[sel_at:]):
                    # копирование строк таблиц проекта (миграции, заполнение): в каждом файле — из строк этого же файла
                    return self._each(lambda alias: at(alias, sql[:b] + _qualify_from(sql[b:], alias)), params)
                if _has_top_level(masked[sel_at:], ("ON CONFLICT", "RETURNING")):
                    raise sqlite3.OperationalError("dbshard: INSERT … SELECT без таблиц проекта с ON CONFLICT/RETURNING не поддерживается")
                # INSERT … SELECT ?, ?, … WHERE (условие): выборка — один раз, как в одной базе;
                # каждая строка — в файл своего проекта (как INSERT … VALUES)
                return self._insert_rows(sql, masked, params, table, b, sel_at, m.group("verb"))
            vals = self.parse_insert(sql, params, table)
            pid = self.target_for_insert(sql, params, table, vals) or self._context_pid()
            alias = self.files[pid]
            clash = self._unique_clash(table, vals or {}, alias)
            if clash:
                mode = re.match(r"\s*(?:INSERT\s+OR\s+(\w+)|(REPLACE))", masked, re.I)
                how = ((mode.group(1) or mode.group(2)) or "").upper() if mode else ""
                if how == "IGNORE" or re.search(r"\bON\s+CONFLICT\b[^;]*\bDO\s+NOTHING\b", masked, re.I):
                    self._multi_changes = 0
                    return _Rows([], 0)
                if how != "REPLACE":
                    raise sqlite3.IntegrityError(f"UNIQUE constraint failed: {table}.{clash[0]}")
                # REPLACE: как в одной базе — старая строка с тем же значением уходит
                for other, col, val in clash[1]:
                    self.raw.execute(f'DELETE FROM {other}."{table}" WHERE "{col}" = ?', (val,))
            self._ensure_seq(alias, base_name(table))
            self._multi_changes = None
            return self.raw.execute(at(alias), params)
        # UPDATE / DELETE — в каждом файле (подзапросы видят всю сеть, как в одной базе)
        if verb == "UPDATE" and base_name(table) in GLOBAL_UNIQUE:
            self._check_update_unique(sql, masked, params, table, b)
        return self._each(lambda alias: at(alias), params)

    def _insert_rows(self, sql: str, masked: str, params: Any, table: str, name_end: int, sel_at: int, verb: str):
        cm = re.match(r"\s*\(([^)]*)\)", masked[name_end:sel_at])
        cols = ([c.strip().strip('"`[]') for c in sql[name_end + cm.start(1):name_end + cm.end(1)].split(",")]
                if cm else self._table_columns(table))
        rows = self.raw.execute(sql[sel_at:], params).fetchall()
        head = re.sub(r"\s+", " ", verb.strip())
        ins = (f'{head} "{table}" (' + ", ".join(f'"{c}"' for c in cols) + ") VALUES ("
               + ", ".join("?" for _ in cols) + ")")
        self.raw.execute("SAVEPOINT dbshard_rows")
        total, last = 0, None
        try:
            for r in rows:
                cur = self._write(ins, tuple(r))
                n = self.raw.execute("SELECT changes()").fetchone()[0] if not isinstance(cur, _Rows) else cur.rowcount
                total += int(n or 0)
                if n and not isinstance(cur, _Rows):
                    last = cur.lastrowid
        except BaseException:
            self.raw.execute("ROLLBACK TO dbshard_rows")
            self.raw.execute("RELEASE dbshard_rows")
            raise
        self.raw.execute("RELEASE dbshard_rows")
        self._multi_changes = total
        return _Rows([], total, last)

    def _unique_clash(self, table: str, vals: dict[str, tuple[bool, Any]], alias: str):
        """значение уникального столбца уже есть в другом файле → (столбец, [(файл, столбец, значение)])."""
        cols = GLOBAL_UNIQUE.get(base_name(table))
        if not cols or base_name(table) != table:
            return None
        hits, first = [], None
        for col in cols:
            known, v = vals.get(col, (False, None))
            if not known or v is None:
                continue
            for other in self.aliases:
                if other == alias:
                    continue
                try:
                    if self.raw.execute(f'SELECT 1 FROM {other}."{table}" WHERE "{col}" = ? LIMIT 1', (v,)).fetchone():
                        hits.append((other, col, v))
                        first = first or col
                except sqlite3.Error:
                    continue
        return (first, hits) if hits else None

    def _check_update_unique(self, sql: str, masked: str, params: Any, table: str, after: int) -> None:
        """UPDATE … SET code = ? …: новое значение не должно совпасть со строкой другого проекта."""
        sm = re.search(r"\bSET\b", masked[after:], re.I)
        if not sm:
            return
        start = after + sm.end()
        wm = re.search(r"\b(WHERE|RETURNING|FROM)\b", masked[start:], re.I)
        end = start + wm.start() if wm else len(masked)
        cols = GLOBAL_UNIQUE[base_name(table)]
        for x, y in _split_top(masked[start:end]):
            part = masked[start + x:start + y]
            m = re.match(r"\s*[\"`\[]?(\w+)[\"`\]]?\s*=\s*", part)
            if not m or m.group(1).lower() not in cols:
                continue
            col = m.group(1).lower()
            known, v = _value_of(sql, masked, start + x + m.end(), start + y, params)
            if not known or v is None:
                continue
            # строки, которые меняем, — в каком файле; совпадение в другом файле = нарушение уникальности
            where = sql[start + wm.start():] if wm else ""
            wparams = params
            if isinstance(params, (list, tuple)):
                wparams = tuple(params)[masked[:start + (wm.start() if wm else len(masked) - start)].count("?"):]
            owners = set()
            for alias in self.aliases:
                try:
                    q = f'SELECT 1 FROM {alias}."{table}" {where} LIMIT 1' if where.upper().startswith("WHERE") else None
                    if q and self.raw.execute(q, wparams).fetchone():
                        owners.add(alias)
                except sqlite3.Error:
                    owners = set(self.aliases)
                    break
            if not owners:
                continue
            for alias in self.aliases:
                if alias in owners and len(owners) == 1:
                    continue
                if self.raw.execute(f'SELECT 1 FROM {alias}."{table}" WHERE "{col}" = ? LIMIT 1', (v,)).fetchone() \
                        and alias not in owners:
                    raise sqlite3.IntegrityError(f"UNIQUE constraint failed: {table}.{col}")

    def _each(self, build: Callable[[str], str], params: Any):
        """один запрос — во всех файлах; как одна инструкция в одной базе: или везде, или нигде."""
        self.raw.execute("SAVEPOINT dbshard_stmt")
        try:
            res = self._each_inner(build, params)
        except BaseException:
            self.raw.execute("ROLLBACK TO dbshard_stmt")
            self.raw.execute("RELEASE dbshard_stmt")
            raise
        self.raw.execute("RELEASE dbshard_stmt")
        return res

    def _each_inner(self, build: Callable[[str], str], params: Any):
        total, rows, desc, last = 0, [], None, None
        for alias in self.aliases:
            cur = self.raw.execute(build(alias), params)
            got = cur.fetchall() if cur.description else []
            if cur.description:
                desc = cur.description
            rows.extend(got)
            n = self.raw.execute("SELECT changes()").fetchone()[0]
            total += int(n or 0)
            if n:
                last = cur.lastrowid
        self._multi_changes = total
        return _Rows(rows, total, last, desc)

    # — номера записей: у каждого проекта свой диапазон —
    def _ensure_seq(self, alias: str, table: str) -> None:
        key = (alias, table)
        if key in self._seq_checked:
            return
        self._seq_checked.add(key)
        ensure_sequence(self.raw, alias, table, self.aliases[alias])

    # — схема —
    def _ddl(self, sql: str, params: Any):
        masked = _mask_strings(sql)
        m = re.match(r"\s*CREATE\s+(?:(TEMP|TEMPORARY)\s+)?(?:UNIQUE\s+)?(TABLE|INDEX|TRIGGER|VIEW)\s+"
                     r"(?:IF\s+NOT\s+EXISTS\s+)?([\"`\[]?[A-Za-z_]\w*[\"`\]]?)(\s*\.\s*[A-Za-z_]\w*)?", masked, re.I)
        if m:
            temp, kind, name, dot = m.group(1), m.group(2).upper(), m.group(3), m.group(4)
            if temp or dot or kind == "VIEW":
                return self.raw.execute(sql, params)
            if kind == "TABLE":
                owner = name.strip('"`[]')
            else:
                on = re.search(r"\bON\s+([\"`\[]?[A-Za-z_]\w*[\"`\]]?)", masked[m.end():], re.I)
                owner = on.group(1).strip('"`[]') if on else ""
            if not is_project_table(owner):
                return self.raw.execute(sql, params)
            s, e = m.span(3)

            def build(alias: str) -> str:
                out = sql[:s] + f"{alias}." + sql[s:]
                if kind == "TABLE" and re.search(r"\bAS\s+SELECT\b", masked, re.I):
                    out = out[:e + len(alias) + 1] + _qualify_from(out[e + len(alias) + 1:], alias)
                if kind == "TRIGGER":
                    out = out.replace("current_project()", "'" + self.aliases[alias].replace("'", "''") + "'")
                return out
            return self._ddl_each(build, params)
        m = re.match(r"\s*DROP\s+(TABLE|INDEX|TRIGGER|VIEW)\s+(IF\s+EXISTS\s+)?([\"`\[]?[A-Za-z_]\w*[\"`\]]?)(\s*\.\s*\w+)?",
                     masked, re.I)
        if m:
            kind, name, dot = m.group(1).upper(), m.group(3).strip('"`[]'), m.group(4)
            if dot or kind == "VIEW":
                return self.raw.execute(sql, params)
            if kind == "TABLE":
                project = is_project_table(name)
            else:
                project = not self.raw.execute("SELECT 1 FROM main.sqlite_master WHERE name = ?", (name,)).fetchone()
            if not project:
                return self.raw.execute(sql, params)
            s, _ = m.span(3)
            if_exists = bool(m.group(2))
            build = (lambda alias: sql[:s] + f"{alias}." + sql[s:])
            return self._ddl_each(build, params, tolerate_missing=not if_exists)
        m = re.match(r"\s*ALTER\s+TABLE\s+([\"`\[]?[A-Za-z_]\w*[\"`\]]?)(\s*\.\s*\w+)?", masked, re.I)
        if m and not m.group(2) and is_project_table(m.group(1)):
            s, _ = m.span(1)
            return self._ddl_each(lambda alias: sql[:s] + f"{alias}." + sql[s:], params)
        return self.raw.execute(sql, params)

    def _ddl_each(self, build: Callable[[str], str], params: Any, tolerate_missing: bool = False):
        done, last_exc = 0, None
        for alias in self.aliases:
            try:
                self.raw.execute(build(alias), params)
                done += 1
            except sqlite3.OperationalError as exc:
                msg = str(exc).lower()
                # столбец/индекс уже есть в этом файле (другой процесс успел) — не ошибка
                if "duplicate column" in msg or "already exists" in msg or (tolerate_missing and "no such" in msg):
                    done += 1
                    continue
                last_exc = exc
        self._views_dirty = True
        self._seq_checked.clear()
        if last_exc is not None:
            raise last_exc
        return _Rows([], 0)


class _CursorShim:
    """conn.cursor() поверх маршрутизации."""

    def __init__(self, conn: ShardedConnection):
        self._c = conn
        self._cur = None
        self.rowcount = -1
        self.lastrowid = None
        self.description = None

    def execute(self, sql: str, params: Any = ()):
        self._cur = self._c.execute(sql, params)
        self.rowcount = getattr(self._cur, "rowcount", -1)
        self.lastrowid = getattr(self._cur, "lastrowid", None)
        self.description = getattr(self._cur, "description", None)
        return self

    def executemany(self, sql: str, seq: Iterable):
        self._cur = self._c.executemany(sql, seq)
        self.rowcount = getattr(self._cur, "rowcount", -1)
        return self

    def fetchone(self):
        return self._cur.fetchone() if self._cur else None

    def fetchall(self):
        return self._cur.fetchall() if self._cur else []

    def fetchmany(self, size: int = 1):
        return self._cur.fetchmany(size) if self._cur else []

    def __iter__(self):
        return iter(self.fetchall())

    def close(self) -> None:
        pass


def _top_level_spans(masked: str) -> list[tuple[int, int]]:
    """куски текста вне скобок."""
    spans, depth, start = [], 0, 0
    for i, ch in enumerate(masked):
        if ch == "(":
            if depth == 0:
                spans.append((start, i))
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                start = i + 1
    if depth == 0:
        spans.append((start, len(masked)))
    return spans


def _top_level_text(masked: str) -> str:
    return " ".join(masked[a:b] for a, b in _top_level_spans(masked))


def _top_level_from_project(masked_select: str) -> bool:
    """у SELECT верхнего уровня во FROM/JOIN есть таблица проекта (копирование строк)."""
    top = _top_level_text(masked_select)
    return any(n.lower() in PROJECT_SET for n in re.findall(r"\b(?:FROM|JOIN)\s+([A-Za-z_]\w*)", top, re.I))


def _has_top_level(masked_select: str, words: tuple[str, ...]) -> bool:
    top = re.sub(r"\s+", " ", _top_level_text(masked_select)).upper()
    return any(w in top for w in words)


def _qualify_from(sql: str, alias: str) -> str:
    """таблицы проекта во FROM/JOIN → alias.table (INSERT … SELECT / CREATE … AS SELECT в одном файле)."""
    masked = _mask_strings(sql)
    out, last = [], 0
    for m in _FROM_REF.finditer(masked):
        name = m.group(2)
        if name.lower() in PROJECT_SET:
            s, e = m.span(2)
            out.append(sql[last:s] + f'{alias}."{name}"')
            last = e
    out.append(sql[last:])
    return "".join(out)


# ───────────────────────── номера записей ─────────────────────────

def ensure_sequence(raw: sqlite3.Connection, alias: str, table: str, pid: str, idx: Optional[int] = None) -> None:
    """новые номера в таблице table файла alias — не ниже (№ проекта + 1) × ID_SPAN."""
    try:
        row = raw.execute(f"SELECT sql FROM {alias}.sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone()
        if not row or "AUTOINCREMENT" not in str(row[0]).upper():
            return
        if idx is None:
            r = raw.execute("SELECT idx FROM main.db_shards WHERE project_id = ?", (pid,)).fetchone()
            if not r:
                return
            idx = int(r[0])
        base = (idx + 1) * ID_SPAN
        cur = raw.execute(f"SELECT seq FROM {alias}.sqlite_sequence WHERE name = ?", (table,)).fetchone()
        if cur is None:
            mx = raw.execute(f'SELECT MAX(rowid) FROM {alias}."{table}"').fetchone()[0] or 0
            raw.execute(f"INSERT INTO {alias}.sqlite_sequence (name, seq) VALUES (?, ?)", (table, max(base, int(mx))))
        elif int(cur[0] or 0) < base:
            raw.execute(f"UPDATE {alias}.sqlite_sequence SET seq = ? WHERE name = ?", (base, table))
    except sqlite3.Error as exc:
        print(f"[db] номера {alias}.{table}: {exc}", flush=True)


def ensure_all_sequences(conn: ShardedConnection) -> None:
    raw = conn.raw
    for pid, alias in conn.files.items():
        for (name,) in raw.execute(f"SELECT name FROM {alias}.sqlite_master WHERE type = 'table'").fetchall():
            if name in PROJECT_SET:
                ensure_sequence(raw, alias, name, pid)
    try:
        raw.commit()
    except sqlite3.Error:
        pass


def fix_triggers(conn: ShardedConnection) -> None:
    """триггеры в файлах проектов: current_project() → имя проекта файла (запись может прийти из чужого контекста)."""
    raw = conn.raw
    for pid, alias in conn.files.items():
        rows = raw.execute(f"SELECT name, sql FROM {alias}.sqlite_master WHERE type = 'trigger' AND sql LIKE '%current_project()%'").fetchall()
        for name, sql in rows:
            new_sql = re.sub(r"(?i)^\s*CREATE\s+TRIGGER\s+(IF\s+NOT\s+EXISTS\s+)?", f"CREATE TRIGGER {alias}.", str(sql), count=1)
            new_sql = new_sql.replace("current_project()", "'" + pid.replace("'", "''") + "'")
            raw.execute(f'DROP TRIGGER {alias}."{name}"')
            raw.execute(new_sql)
    raw.commit()


# ───────────────────────── открытие ─────────────────────────

def shard_ids(db_path: str, registered: Iterable[str]) -> list[str]:
    """проекты сети + файлы, которые уже есть (проект убрали из реестра — данные не прячем)."""
    ids = [p for p in registered]
    try:
        for name in sorted(os.listdir(projects_dir(db_path))):
            if name.endswith(".db"):
                pid = name[:-3]
                if pid not in ids:
                    ids.append(pid)
    except OSError:
        pass
    return ids


def open_raw(db_path: str, pids: list[str], default_pid: str) -> tuple[sqlite3.Connection, dict[str, str], str]:
    if len(pids) > MAX_FILES:
        raise RuntimeError(f"проектов {len(pids)}: sqlite подключает не больше {MAX_FILES} файлов")
    os.makedirs(projects_dir(db_path), exist_ok=True)
    raw = sqlite3.connect(core_path(db_path), check_same_thread=False)
    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA busy_timeout = 5000")
    try:
        raw.execute("PRAGMA journal_mode = WAL")
    except sqlite3.OperationalError:
        pass
    files: dict[str, str] = {}
    for pid in pids:
        path = project_path(db_path, pid)
        fresh = not os.path.exists(path)
        alias = alias_of(pid)
        raw.execute(f"ATTACH DATABASE ? AS {alias}", (path,))
        try:
            raw.execute(f"PRAGMA {alias}.journal_mode = WAL")
        except sqlite3.OperationalError:
            pass
        if fresh:
            _chmod(path)
        files[pid] = alias
    _chmod(core_path(db_path))
    raw.execute("PRAGMA foreign_keys = ON")
    raw.execute("CREATE TABLE IF NOT EXISTS main.db_shards (project_id TEXT PRIMARY KEY, idx INTEGER NOT NULL UNIQUE)")
    for pid in pids:
        if not raw.execute("SELECT 1 FROM main.db_shards WHERE project_id = ?", (pid,)).fetchone():
            nxt = raw.execute("SELECT COALESCE(MAX(idx) + 1, 0) FROM main.db_shards").fetchone()[0]
            raw.execute("INSERT INTO main.db_shards (project_id, idx) VALUES (?, ?)", (pid, int(nxt)))
    raw.commit()

    def has_schema(alias: str) -> bool:
        return bool(raw.execute(f"SELECT 1 FROM {alias}.sqlite_master WHERE type = 'table' AND name = 'users'").fetchone())

    ref = files.get(default_pid) or next(iter(files.values()))
    if not has_schema(ref):
        ref = next((a for a in files.values() if has_schema(a)), ref)
    # новый проект (файла не было): схема — точная копия файла-образца (со всеми столбцами, индексами, триггерами)
    if has_schema(ref):
        for pid, alias in files.items():
            if alias == ref or has_schema(alias):
                continue
            ref_pid = next(p for p, a in files.items() if a == ref)
            rows = raw.execute(f"SELECT type, name, sql FROM {ref}.sqlite_master WHERE sql IS NOT NULL "
                               "AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").fetchall()
            raw.execute("BEGIN IMMEDIATE")
            try:
                for typ, name, sql in rows:
                    sql = str(sql)
                    if typ == "trigger":
                        sql = sql.replace("'" + ref_pid.replace("'", "''") + "'", "'" + pid.replace("'", "''") + "'")
                    sql = re.sub(r"(?is)^\s*CREATE\s+(UNIQUE\s+)?(TABLE|INDEX|TRIGGER|VIEW)\s+(IF\s+NOT\s+EXISTS\s+)?",
                                 lambda m: f"CREATE {m.group(1) or ''}{m.group(2)} {alias}.", sql, count=1)
                    raw.execute(sql)
                raw.commit()
            except BaseException:
                raw.rollback()
                raise
            print(f"[db] новый проект {pid}: создана база projects/{pid}.db", flush=True)
    return raw, files, ref


# ───────────────────────── переход со старой одной базы ─────────────────────────

def _owner_sql(table: str, alias: str, cols_of: Callable[[str], set[str]], default_pid: str, depth: int = 0) -> str:
    """SQL-выражение «проект строки» для старой базы (o.*)."""
    parts: list[str] = []
    cols = cols_of(table)
    if "project_id" in cols:
        parts.append(f"NULLIF({alias}.project_id, '')")
    for col, parent in LINKS.get(table, []):
        if col in cols and cols_of(parent) and depth < 3:
            pa = f"x{depth}_{parent[:6]}"
            inner = _owner_sql(parent, pa, cols_of, default_pid, depth + 1)
            parts.append(f"(SELECT {inner} FROM o.\"{parent}\" AS {pa} WHERE {pa}.id = {alias}.\"{col}\")")
    parts.append("'" + default_pid.replace("'", "''") + "'")
    return parts[0] if len(parts) == 1 else "COALESCE(" + ", ".join(parts) + ")"


def _row_digest(rows: Iterable[tuple]) -> str:
    h = hashlib.sha256()
    for r in rows:
        h.update(repr(tuple(r)).encode("utf-8", "surrogatepass"))
    return h.hexdigest()


def split_from_legacy(db_path: str, registered: list[str], default_pid: str, log: Callable[[str], None]) -> dict[str, Any]:
    """data.db → core.db + projects/<id>.db. Бросает исключение при любом расхождении (временные файлы удаляются,
    старая база не меняется)."""
    ddir = data_dir(db_path)
    ts = time.strftime("%Y%m%d-%H%M%S")
    work = os.path.join(ddir, f".split-{ts}")
    try:
        return _split(db_path, registered, default_pid, log, ddir, ts, work)
    except BaseException:
        shutil.rmtree(work, ignore_errors=True)
        raise


def _split(db_path: str, registered: list[str], default_pid: str, log: Callable[[str], None],
           ddir: str, ts: str, work: str) -> dict[str, Any]:
    size = os.path.getsize(db_path) + (os.path.getsize(db_path + "-wal") if os.path.exists(db_path + "-wal") else 0)
    free = shutil.disk_usage(ddir).free
    if free < size * 5 + 100 * 1048576:
        raise RuntimeError(f"мало места на диске: свободно {free // 1048576} МБ, для переноса нужно ~{(size * 5) // 1048576 + 100} МБ")
    os.makedirs(work, exist_ok=True)
    backups = os.path.join(ddir, "backups")
    os.makedirs(backups, exist_ok=True)

    # 1) снимок старой базы (с WAL) — и копия в backups/
    snap = os.path.join(work, "source.db")
    # пишущие в старую базу ждут (блокировка записи на отдельном соединении), пока снимаем копию
    lock = sqlite3.connect(db_path, timeout=60, isolation_level=None)
    lock.execute("PRAGMA busy_timeout = 60000")
    lock.execute("BEGIN IMMEDIATE")
    try:
        src = sqlite3.connect(db_path, timeout=60)
        dst = sqlite3.connect(snap)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
    finally:
        lock.execute("ROLLBACK")
        lock.close()
    keep = os.path.join(backups, f"pre-split-{ts}.db")
    shutil.copyfile(snap, keep)
    _chmod(keep)
    log(f"[db] перенос по проектам: копия старой базы — backups/{os.path.basename(keep)}")

    o = sqlite3.connect(snap)
    o.row_factory = sqlite3.Row
    o.execute("ATTACH DATABASE ? AS o", (snap,))
    tables = [r[0] for r in o.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
    colmap = {t: {c[1] for c in o.execute(f'PRAGMA table_info("{t}")')} for t in tables}
    cols_of = lambda t: colmap.get(t, set())  # noqa: E731
    ptables = [t for t in tables if t in PROJECT_SET]
    mx = 0
    for t in ptables:
        if "id" in colmap[t]:
            mx = max(mx, int(o.execute(f'SELECT COALESCE(MAX(rowid), 0) FROM "{t}"').fetchone()[0] or 0))
    if mx >= ID_SPAN:
        raise RuntimeError(f"номера записей уже больше {ID_SPAN} — разделение по диапазонам невозможно")

    # чей каждый ряд
    owners: dict[str, dict[int, str]] = {}
    pids = list(registered)
    for t in ptables:
        expr = _owner_sql(t, "t", cols_of, default_pid)
        rows = o.execute(f'SELECT t.rowid AS rid, {expr} AS pid FROM o."{t}" AS t').fetchall()
        owners[t] = {int(r["rid"]): str(r["pid"]).strip().lower() for r in rows}
        for p in set(owners[t].values()):
            if p not in pids:
                pids.append(p)
    if len(pids) > MAX_FILES:
        raise RuntimeError(f"проектов с данными {len(pids)} — больше {MAX_FILES}")
    log(f"[db] перенос по проектам: проекты {', '.join(pids)}")

    # 2) core: копия без таблиц проектов
    core_tmp = os.path.join(work, "core.db")
    shutil.copyfile(snap, core_tmp)
    c = sqlite3.connect(core_tmp)
    c.execute("PRAGMA foreign_keys = OFF")
    for t in ptables:
        c.execute(f'DROP TABLE "{t}"')
    c.execute("CREATE TABLE IF NOT EXISTS db_shards (project_id TEXT PRIMARY KEY, idx INTEGER NOT NULL UNIQUE)")
    for i, p in enumerate(pids):
        c.execute("INSERT OR REPLACE INTO db_shards (project_id, idx) VALUES (?, ?)", (p, i))
    c.commit()
    c.execute("VACUUM")
    c.close()

    # 3) файлы проектов: копия, только свои строки, без общих таблиц
    proj_tmp: dict[str, str] = {}
    for i, p in enumerate(pids):
        path = os.path.join(work, f"{p}.db")
        shutil.copyfile(snap, path)
        f = sqlite3.connect(path)
        f.execute("PRAGMA foreign_keys = OFF")
        f.execute("PRAGMA recursive_triggers = OFF")
        for t in tables:
            if t not in PROJECT_SET:
                f.execute(f'DROP TABLE "{t}"')
        for t in ptables:
            drop = [rid for rid, op in owners[t].items() if op != p]
            for k in range(0, len(drop), 900):
                chunk = drop[k:k + 900]
                f.execute(f'DELETE FROM "{t}" WHERE rowid IN ({",".join("?" * len(chunk))})', chunk)
        # триггеры: проект файла вместо current_project()
        for name, sql in f.execute("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%current_project()%'").fetchall():
            f.execute(f'DROP TRIGGER "{name}"')
            f.execute(str(sql).replace("current_project()", "'" + p.replace("'", "''") + "'"))
        # номера: свой диапазон
        base = (i + 1) * ID_SPAN
        for (name, sql) in f.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table'").fetchall():
            if sql and "AUTOINCREMENT" in str(sql).upper():
                if f.execute("SELECT 1 FROM sqlite_sequence WHERE name = ?", (name,)).fetchone():
                    f.execute("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?", (base, name))
                else:
                    f.execute("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)", (name, base))
        f.commit()
        f.execute("VACUUM")
        f.close()
        proj_tmp[p] = path

    # 4) сверка: каждая таблица — те же строки, что в старой базе
    report: dict[str, Any] = {"tables": {}}
    c = sqlite3.connect(core_tmp)
    for t in tables:
        cols = [x[1] for x in o.execute(f'PRAGMA table_info("{t}")')]
        sel = ", ".join(f'"{x}"' for x in cols)
        tsql = str(o.execute("SELECT sql FROM sqlite_master WHERE name = ?", (t,)).fetchone()[0] or "")
        if "WITHOUT ROWID" in tsql.upper():
            if t in PROJECT_SET:
                raise RuntimeError(f"{t}: таблица без rowid — не поддерживается")
            q = f'SELECT {sel} FROM "{t}" ORDER BY ' + ", ".join(f'"{x}"' for x in cols)
            orig = o.execute(q).fetchall()
            got = c.execute(q).fetchall()
            if len(got) != len(orig) or _row_digest(tuple(r) for r in orig) != _row_digest(tuple(r) for r in got):
                raise RuntimeError(f"{t}: содержимое не совпадает со старой базой")
            report["tables"][t] = {"rows": len(orig), "files": {"core": len(got)}}
            continue
        orig = o.execute(f'SELECT rowid, {sel} FROM "{t}" ORDER BY rowid').fetchall()
        if t in PROJECT_SET:
            got: list[tuple] = []
            per: dict[str, int] = {}
            for p, path in proj_tmp.items():
                f = sqlite3.connect(path)
                rows = f.execute(f'SELECT rowid, {sel} FROM "{t}" ORDER BY rowid').fetchall()
                f.close()
                bad = [r[0] for r in rows if owners[t].get(int(r[0])) != p]
                if bad:
                    raise RuntimeError(f"{t}: в файле {p} чужие строки ({len(bad)})")
                per[p] = len(rows)
                got.extend(rows)
            got.sort(key=lambda r: r[0])
        else:
            got = c.execute(f'SELECT rowid, {sel} FROM "{t}" ORDER BY rowid').fetchall()
            per = {"core": len(got)}
        if len(got) != len(orig):
            raise RuntimeError(f"{t}: строк было {len(orig)}, стало {len(got)}")
        if _row_digest(tuple(r) for r in orig) != _row_digest(tuple(r) for r in got):
            raise RuntimeError(f"{t}: содержимое не совпадает со старой базой")
        report["tables"][t] = {"rows": len(orig), "files": per}
    c.close()
    o.close()
    for path in [core_tmp, *proj_tmp.values()]:
        x = sqlite3.connect(path)
        ok = x.execute("PRAGMA integrity_check").fetchone()[0]
        x.close()
        if ok != "ok":
            raise RuntimeError(f"проверка целостности {os.path.basename(path)}: {ok}")

    # 5) на место: core.db, projects/*.db (старых файлов с этими именами быть не должно)
    os.makedirs(projects_dir(db_path), exist_ok=True)
    targets = {core_tmp: core_path(db_path), **{v: project_path(db_path, k) for k, v in proj_tmp.items()}}
    for dst_path in targets.values():
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(dst_path + suffix):
                shutil.move(dst_path + suffix, os.path.join(work, "old-" + os.path.basename(dst_path) + suffix))
    for s, d in targets.items():
        os.replace(s, d)
        _chmod(d)
    # старая база — рядом, под другим именем (чтобы никто не продолжил в неё писать по ошибке)
    old = sqlite3.connect(db_path, timeout=60)
    try:
        old.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except sqlite3.Error:
        pass
    old.close()
    renamed = db_path + ".pre-split"
    if os.path.exists(renamed):
        renamed = f"{db_path}.pre-split-{ts}"
    os.replace(db_path, renamed)
    for suffix in ("-wal", "-shm"):
        try:
            if os.path.exists(db_path + suffix):
                os.replace(db_path + suffix, renamed + suffix)
        except OSError:
            pass
    st = os.stat(renamed)
    marker = {
        "version": 1,
        "done_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "projects": pids,
        "backup": os.path.relpath(keep, ddir),
        "legacy_file": os.path.relpath(renamed, ddir),
        "legacy_size": st.st_size,
        "legacy_mtime": st.st_mtime,
        "report": report,
    }
    _write_json(marker_path(db_path), marker)
    shutil.rmtree(work, ignore_errors=True)
    total = sum(v["rows"] for v in report["tables"].values())
    log(f"[db] перенос по проектам: готово, таблиц {len(report['tables'])}, строк {total}, всё совпало")
    return marker


def init_fresh(db_path: str, log: Callable[[str], None]) -> None:
    os.makedirs(projects_dir(db_path), exist_ok=True)
    _write_json(marker_path(db_path), {"version": 1, "done_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "fresh": True})
    log("[db] новая установка: база по проектам (core.db + projects/*.db)")


# ───────────────────────── одна база из всех файлов (бэкап / откат) ─────────────────────────

def export_merged(db_path: str, dest: str) -> None:
    """собрать всё в один файл прежнего формата (бэкап, возврат к одной базе). Пишет во временный файл,
    на место — только целиком собранный."""
    tmp = dest + ".part"
    for x in (tmp, tmp + "-journal"):
        if os.path.exists(x):
            os.remove(x)
    src = sqlite3.connect(core_path(db_path), timeout=60)
    d = sqlite3.connect(tmp)
    try:
        src.backup(d)
    finally:
        src.close()
    try:
        d.create_function("current_project", 0, lambda: None)
        d.execute("PRAGMA foreign_keys = OFF")
        d.execute("DROP TABLE IF EXISTS db_shards")
        files = sorted(n for n in os.listdir(projects_dir(db_path)) if n.endswith(".db"))
        created: set[str] = set()
        extras: dict[str, tuple[str, str, str]] = {}  # индексы и триггеры — после данных
        for n in files:
            pid = n[:-3]
            d.execute("ATTACH DATABASE ? AS src", (os.path.join(projects_dir(db_path), n),))
            rows = d.execute("SELECT type, name, sql FROM src.sqlite_master WHERE sql IS NOT NULL "
                             "AND name NOT LIKE 'sqlite_%'").fetchall()
            for typ, name, sql in rows:
                if typ == "table" and name not in created:
                    d.execute(sql)
                    created.add(name)
                elif typ in ("index", "trigger") and name not in extras:
                    if typ == "trigger":
                        # в файле проекта триггер записан с именем проекта — в одной базе он снова current_project()
                        sql = str(sql).replace("'" + pid.replace("'", "''") + "'", "current_project()")
                    extras[name] = (typ, name, sql)
            d.execute("BEGIN")
            for typ, name, sql in rows:
                if typ != "table":
                    continue
                cols = [c[1] for c in d.execute(f'PRAGMA src.table_info("{name}")')]
                mine = {c[1] for c in d.execute(f'PRAGMA main.table_info("{name}")')}
                use = [c for c in cols if c in mine]
                sel = ", ".join(f'"{c}"' for c in use)
                d.execute(f'INSERT INTO main."{name}" ({sel}) SELECT {sel} FROM src."{name}"')
            d.commit()
            d.execute("DETACH DATABASE src")
        for typ, name, sql in sorted(extras.values(), key=lambda x: x[0] != "index"):
            if not d.execute("SELECT 1 FROM main.sqlite_master WHERE name = ?", (name,)).fetchone():
                try:
                    d.execute(sql)
                except sqlite3.Error as exc:
                    print(f"[db] сборка одной базы: {typ} {name}: {exc}", flush=True)
        d.commit()
    except BaseException:
        d.close()
        for x in (tmp, tmp + "-journal"):
            if os.path.exists(x):
                os.remove(x)
        raise
    d.close()
    os.replace(tmp, dest)
    _chmod(dest)


# ───────────────────────── проверка после переноса и командная строка ─────────────────────────

def warn_legacy_touched(db_path: str, marker: dict[str, Any], log: Callable[[str], None]) -> None:
    """старую базу кто-то менял после переноса (старый процесс не перезапустился) — громко сказать об этом."""
    try:
        legacy = os.path.join(data_dir(db_path), str(marker.get("legacy_file") or ""))
        if marker.get("legacy_file") and os.path.exists(legacy):
            st = os.stat(legacy)
            if st.st_size != marker.get("legacy_size") or abs(st.st_mtime - float(marker.get("legacy_mtime") or 0)) > 1:
                log(f"[db] ВНИМАНИЕ: {marker['legacy_file']} изменён после переноса по проектам — какой-то старый "
                    "процесс писал в старую базу. Перезапустите все сервисы; записи, сделанные туда после переноса, "
                    "в новые базы не попали.")
        if os.path.exists(db_path) and os.path.getsize(db_path) > 0:
            log(f"[db] ВНИМАНИЕ: рядом снова лежит {os.path.basename(db_path)}, но база уже по проектам "
                "(core.db + projects/) — этот файл не используется.")
    except OSError:
        pass


def merge_back(db_path: str, log: Callable[[str], None] = print) -> str:
    """вернуть одну базу: собрать data.db из core.db + projects/*.db; файлы по проектам — в папку split-<время>.
    Запускать при остановленных сервисах; после — в .env DB_SPLIT=0."""
    if not read_marker(db_path):
        raise SystemExit("база и так одна (нет db-split.json)")
    if os.path.exists(db_path) and os.path.getsize(db_path) > 0:
        raise SystemExit(f"{db_path} уже есть — уберите его, чтобы не перезаписать")
    export_merged(db_path, db_path)
    ts = time.strftime("%Y%m%d-%H%M%S")
    keep = os.path.join(data_dir(db_path), f"split-{ts}")
    os.makedirs(keep, exist_ok=True)
    for name in ("core.db", "core.db-wal", "core.db-shm", MARKER):
        src = os.path.join(data_dir(db_path), name)
        if os.path.exists(src):
            shutil.move(src, os.path.join(keep, name))
    if os.path.isdir(projects_dir(db_path)):
        shutil.move(projects_dir(db_path), os.path.join(keep, "projects"))
    log(f"одна база собрана: {db_path}; файлы по проектам сохранены в {keep}. Поставьте DB_SPLIT=0 в .env и перезапустите.")
    return keep


def status(db_path: str) -> dict[str, Any]:
    m = read_marker(db_path)
    out: dict[str, Any] = {"mode": "split" if m else "single", "data_dir": data_dir(db_path)}
    if m:
        out["done_at"] = m.get("done_at")
        out["backup"] = m.get("backup")
        files = {}
        for n in sorted(os.listdir(projects_dir(db_path))) if os.path.isdir(projects_dir(db_path)) else []:
            if n.endswith(".db"):
                c = sqlite3.connect(os.path.join(projects_dir(db_path), n))
                try:
                    files[n[:-3]] = {"users": c.execute("SELECT COUNT(*) FROM users").fetchone()[0],
                                     "subscriptions": c.execute("SELECT COUNT(*) FROM subscriptions").fetchone()[0],
                                     "mb": round(os.path.getsize(os.path.join(projects_dir(db_path), n)) / 1048576, 1)}
                except sqlite3.Error as exc:
                    files[n[:-3]] = {"error": str(exc)}
                c.close()
        out["projects"] = files
    elif os.path.exists(failed_path(db_path)):
        out["failed"] = open(failed_path(db_path), encoding="utf-8").read()[:2000]
    return out


if __name__ == "__main__":  # python dbshard.py status | merge-back
    import sys
    path = os.getenv("DB_PATH", "data/data.db")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "status":
        print(json.dumps(status(path), ensure_ascii=False, indent=1))
    elif cmd == "merge-back":
        merge_back(path)
    else:
        raise SystemExit("команды: status | merge-back")
