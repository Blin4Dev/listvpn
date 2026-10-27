from __future__ import annotations

import math
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

import database as db  # type: ignore


def _trial_days_text() -> str:
    """срок пробной из настроек: «3 дня», «7 дней», …"""
    try:
        n = max(1, int(float(db.get_setting("trial_days", "3") or 3)))
    except (TypeError, ValueError):
        n = 3
    a, b = n % 100, n % 10
    word = "дней" if 11 <= a <= 14 else "день" if b == 1 else "дня" if 2 <= b <= 4 else "дней"
    return f"{n} {word}"
import services  # type: ignore
import fulfillment  # type: ignore
import provisioning  # type: ignore
import grace  # type: ignore

EMOJI_WARN_SOFT = (os.getenv("EMOJI_WARN_SOFT") or "5447644880824181073").strip()
EMOJI_WARN_HARD = (os.getenv("EMOJI_WARN_HARD") or "5420323339723881652").strip()
EMOJI_STOP = (os.getenv("EMOJI_STOP") or "5260293700088511294").strip()
EMOJI_SIREN = (os.getenv("EMOJI_SIREN") or "5395695537687123235").strip()
EMOJI_ANTIABUSE = (os.getenv("EMOJI_ANTIABUSE") or "5420323339723881652").strip()

# интервал проверки, сек
INTERVAL = max(60, int(os.getenv("REMINDER_INTERVAL", "300") or "300"))

_H = 3600
_STAGE_72 = 72 * _H
_STAGE_48 = 48 * _H
_STAGE_24 = 24 * _H
_LOOKBACK = 24 * _H  # окно для expired; дальше del*

import projects  # type: ignore  # noqa: E402


def _app_url() -> str:
    """мини-приложение проекта, пользователям которого сейчас пишем."""
    return projects.current().miniapp_url


def _open_app() -> str:
    return f"Открыть {projects.current().name}"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _utf16_len(s: str) -> int:
    """длина в utf-16 code units (смещения entity в telegram)."""
    return len(s.encode("utf-16-le")) // 2


def _build(segments: list[tuple[str, Optional[dict[str, Any]]]]) -> tuple[str, list[dict[str, Any]]]:
    """текст + entity с utf-16 смещениями."""
    text = ""
    entities: list[dict[str, Any]] = []
    offset = 0
    for chunk, ent in segments:
        length = _utf16_len(chunk)
        if ent:
            entities.append({**ent, "offset": offset, "length": length})
        text += chunk
        offset += length
    return text, entities


def _plural_hours(n: int) -> str:
    """русская форма: 1 час / 2 часа / 5 часов."""
    n = abs(int(n))
    if n % 10 == 1 and n % 100 != 11:
        return f"{n} час"
    if 2 <= n % 10 <= 4 and not (12 <= n % 100 <= 14):
        return f"{n} часа"
    return f"{n} часов"


_TAIL = " ваша подписка закончится. Не забудьте продлить подписку, чтобы сохранить доступ в свободный интернет."


_TAIL_NO_RENEW = (" ваша подписка закончится и будет удалена. Продление этой подписки недоступно — "
                  "после окончания вы сможете оформить новую.")


def _message_no_renew(stage: str, remaining_sec: float) -> tuple[str, list[dict[str, Any]]]:
    """напоминания для no_renew (без призыва продлить)."""
    bold = {"type": "bold"}
    if stage == "1d":
        hours = max(1, math.ceil(remaining_sec / _H))
        when, emoji = f"Через {_plural_hours(hours)}", EMOJI_WARN_HARD
    else:
        when, emoji = ("Через 3 дня" if stage == "3d" else "Через 2 дня"), EMOJI_WARN_SOFT
    return _build([
        ("⚠️", {"type": "custom_emoji", "custom_emoji_id": emoji}),
        (" ", None),
        ("Подписка скоро закончится!", bold),
        ("\n\n", None),
        (when, bold),
        (_TAIL_NO_RENEW, None),
    ])


def _message_for(stage: str, remaining_sec: float, no_renew: bool = False) -> tuple[str, list[dict[str, Any]]]:
    if no_renew:
        return _message_no_renew(stage, remaining_sec)
    bold = {"type": "bold"}
    if stage == "3d":
        return _build([
            ("⚠️", {"type": "custom_emoji", "custom_emoji_id": EMOJI_WARN_SOFT}),
            (" ", None),
            ("Подписка почти закончилась!", bold),
            ("\n\nЧерез ", None),
            ("3 дня", bold),
            (_TAIL, None),
        ])
    if stage == "2d":
        return _build([
            ("⚠️", {"type": "custom_emoji", "custom_emoji_id": EMOJI_WARN_SOFT}),
            (" ", None),
            ("Подписка почти закончилась!", bold),
            ("\n\nЧерез ", None),
            ("2 дня", bold),
            (_TAIL, None),
        ])
    if stage == "1d":
        hours = max(1, math.ceil(remaining_sec / _H))
        return _build([
            ("⚠️", {"type": "custom_emoji", "custom_emoji_id": EMOJI_WARN_HARD}),
            (" ", None),
            ("Подписка вот-вот закончится!", bold),
            ("\n\n", None),
            (f"Через {_plural_hours(hours)}", bold),
            (_TAIL, None),
        ])
    return _build([
        ("⛔️", {"type": "custom_emoji", "custom_emoji_id": EMOJI_STOP}),
        (" ", None),
        ("Подписка закончилась!", bold),
        ("\n\nВы не успели продлить подписку заранее и она была отключена. "
         "Но оплатить её можно в любой момент в личном кабинете.", None),
    ])


def _stage_for(remaining_sec: float) -> Optional[str]:
    if remaining_sec <= 0:
        return "expired"
    if remaining_sec <= _STAGE_24:
        return "1d"
    if remaining_sec <= _STAGE_48:
        return "2d"
    if remaining_sec <= _STAGE_72:
        return "3d"
    return None


def _renew_keyboard() -> Optional[dict[str, Any]]:
    if not _app_url():
        return None
    return {"inline_keyboard": [[{"text": "Продлить подписку", "web_app": {"url": _app_url()}}]]}


def _already_sent(subscription_id: int, stage: str, cycle_exp: str) -> bool:
    row = db.fetchone(
        "SELECT cycle_expires_at FROM sub_reminders WHERE subscription_id = ? AND stage = ?",
        (subscription_id, stage),
    )
    return bool(row) and str(row["cycle_expires_at"]) == cycle_exp


def _mark_sent(subscription_id: int, stage: str, cycle_exp: str) -> None:
    db.execute(
        "INSERT OR REPLACE INTO sub_reminders (subscription_id, stage, cycle_expires_at, sent_at) "
        "VALUES (?, ?, ?, ?)",
        (subscription_id, stage, cycle_exp, db.utcnow_iso()),
    )


def run_once(api: Callable[..., Any], log: Callable[[str], None] = print) -> int:
    """один проход: созревшие подписки → недостающие напоминания; число отправок."""
    now = _utcnow()
    lo = (now - timedelta(seconds=_LOOKBACK)).isoformat()
    hi = (now + timedelta(seconds=_STAGE_72)).isoformat()

    rows = db.fetchall(
        "SELECT s.id AS sub_id, s.expires_at AS expires_at, u.telegram_id AS telegram_id, "
        "COALESCE(s.no_renew, 0) AS no_renew "
        "FROM subscriptions s JOIN users u ON u.id = s.user_id "
        "WHERE s.status IN ('Active', 'Expired') AND s.expires_at IS NOT NULL "
        "AND s.expires_at BETWEEN ? AND ? "
        "AND COALESCE(u.is_banned, 0) = 0 AND u.telegram_id IS NOT NULL AND u.project_id = ?",
        (lo, hi, projects.current_id()),
    )

    sent = 0
    for row in rows:
        exp_raw = str(row["expires_at"])
        exp = _parse_iso(exp_raw)
        if exp is None:
            continue
        remaining = (exp - now).total_seconds()
        stage = _stage_for(remaining)
        if stage is None:
            continue
        no_renew = bool(row.get("no_renew"))
        if no_renew and stage == "expired":
            continue  # удалит run_expiry_cleanup
        sub_id = int(row["sub_id"])
        if _already_sent(sub_id, stage, exp_raw):
            continue
        chat_id = int(row["telegram_id"])
        text, entities = _message_for(stage, remaining, no_renew)
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "entities": entities,
            "link_preview_options": {"is_disabled": True},
        }
        kb = _renew_keyboard()
        if kb and no_renew:
            kb = {"inline_keyboard": [[{"text": _open_app(), "web_app": {"url": _app_url()}}]]}
        if kb:
            payload["reply_markup"] = kb

        result = api("sendMessage", payload)
        if result is not None:
            _mark_sent(sub_id, stage, exp_raw)
            sent += 1
        else:
            log(f"[reminders] не удалось отправить {stage} для подписки {sub_id}")
        time.sleep(0.05)  # ~20 msg/s

    if sent:
        log(f"[reminders] отправлено напоминаний: {sent}")
    return sent


# онбординг от first_start_at; любая подписка обрывает

OB_EMOJI = {
    "m30": "5341715473882955310",
    "h24": "5424972470023104089",
    "h48": "5460755126761312667",
    "h71": "5224607267797606837",
    "h72": "5399913388845322366",
}
OB_CHAR = {"m30": "⚙️", "h24": "🔥", "h48": "🚩", "h71": "☄️", "h72": "🌧"}

# (этап, часы)
OB_STAGES: list[tuple[str, float]] = [
    ("m30", 0.5), ("h24", 24.0), ("h48", 48.0), ("h71", 71.0), ("h72", 72.0)
]
OB_DISCOUNT_PERCENT = 10
OB_DISCOUNT_HOURS = 24


def _ob_message(stage: str) -> tuple[str, list[dict[str, Any]]]:
    b = {"type": "bold"}
    em = {"type": "custom_emoji", "custom_emoji_id": OB_EMOJI[stage]}
    ch = OB_CHAR[stage]
    if stage == "m30":
        return _build([
            (ch, em), (" ", None), ("Вы всё еще не оформили подписку!", b),
            ("\n\nА ведь с " + projects.current().name + " вы бы получили доступ в свободный интернет, "
             "безопасность и качественную поддержку.", None),
        ])
    if stage == "h24":
        return _build([
            (ch, em), (" ", None), ("Где ваша подписка?", b),
            ("\n\nПрошли уже сутки, а подписки у вас всё ещё нет. "
             f"Вы можете бесплатно протестировать {_trial_days_text()} и проверить качество VPN", None),
        ])
    if stage == "h48":
        return _build([
            (ch, em), (" ", None), ("Слушай сюда, ты так и не оформил подписку...", b),
            ("\n\nМы даём тебе скидку ", None), ("10%", b),
            (" на покупку, но она действует только один раз и только в течение 24 часов. "
             "Если не успеешь купить... потеряешь её.", None),
        ])
    if stage == "h71":
        return _build([
            (ch, em), (" ", None), ("Остался один час...", b),
            ("\n\nВы ещё помните про персональную скидку ", None), ("10%", b),
            ("? Так вот... Остался всего час, чтобы успеть воспользоваться ею.", None),
        ])
    return _build([
        (ch, em), (" ", None), ("Мы пытались...", b),
        ("\n\nЗдесь могло быть ещё одно сообщение, чтобы заставить вас купить подписку, "
         "но вы хорошо держитесь. Поэтому мы оставим вас, но знайте — ", None),
        ("если свободный интернет, то только " + projects.current().name, b), (".", None),
    ])


def _ob_keyboard(stage: str) -> Optional[dict[str, Any]]:
    # h72 без кнопки
    if stage == "h72" or not _app_url():
        return None
    return {"inline_keyboard": [[{"text": "Оформить подписку", "web_app": {"url": _app_url()}}]]}


def _ob_mark(user_id: int, stage: str) -> None:
    db.execute(
        "INSERT OR IGNORE INTO onboarding_reminders (user_id, stage, sent_at) VALUES (?, ?, ?)",
        (user_id, stage, db.utcnow_iso()),
    )


def run_onboarding_once(api: Callable[..., Any], log: Callable[[str], None] = print) -> int:
    now = _utcnow()
    lo = (now - timedelta(hours=96)).isoformat()  # окно 4 суток
    rows = db.fetchall(
        "SELECT u.id AS uid, u.telegram_id AS tg, u.first_start_at AS fs FROM users u "
        "WHERE u.telegram_id IS NOT NULL AND COALESCE(u.is_banned, 0) = 0 "
        "AND u.first_start_at IS NOT NULL AND u.first_start_at >= ? "
        "AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id) AND u.project_id = ?",
        (lo, projects.current_id()),
    )
    sent = 0
    for r in rows:
        fs = _parse_iso(r["fs"])
        if not fs:
            continue
        hours = (now - fs).total_seconds() / 3600.0
        done = {x["stage"] for x in db.fetchall(
            "SELECT stage FROM onboarding_reminders WHERE user_id = ?", (r["uid"],))}
        due = [name for name, th in OB_STAGES if hours >= th and name not in done]
        if not due:
            continue
        # после простоя шлём только последнюю стадию; остальные mark без send
        target = due[-1]
        for name in due[:-1]:
            _ob_mark(r["uid"], name)

        text, entities = _ob_message(target)
        payload: dict[str, Any] = {
            "chat_id": int(r["tg"]),
            "text": text,
            "entities": entities,
            "link_preview_options": {"is_disabled": True},
        }
        kb = _ob_keyboard(target)
        if kb:
            payload["reply_markup"] = kb
        if api("sendMessage", payload) is not None:
            _ob_mark(r["uid"], target)
            if target == "h48":
                try:
                    services.grant_personal_discount(int(r["uid"]), OB_DISCOUNT_PERCENT, OB_DISCOUNT_HOURS)
                except Exception:  # noqa: BLE001
                    pass
            sent += 1
        else:
            log(f"[onboarding] не удалось отправить {target} пользователю {r['uid']}")
        time.sleep(0.05)  # ~20 msg/s

    if sent:
        log(f"[onboarding] отправлено сообщений: {sent}")
    return sent


EMOJI_TRIAL_FAIL = (os.getenv("EMOJI_TRIAL_FAIL") or "5210952531676504517").strip()


def _trial_no_connect_message() -> tuple[str, list[dict[str, Any]]]:
    b = {"type": "bold"}
    em = {"type": "custom_emoji", "custom_emoji_id": EMOJI_TRIAL_FAIL}
    return _build([
        ("❌", em), (" ", None), ("Кажется, не всё прошло гладко...", b),
        ("\n\nВы подключили пробную подписку, но так и ни разу не подключились. "
         "Найти инструкцию можно в разделе «Управление подпиской» → «Добавить подписку».\n"
         "Если подключиться не получится — напишите в поддержку.", None),
    ])


def run_trial_connection_checks(api: Callable[..., Any], log: Callable[[str], None] = print) -> int:
    """через 15 мин после trial: ни разу не подключился → лс."""
    try:
        import provisioning  # type: ignore
    except Exception:  # noqa: BLE001
        return 0
    now = _utcnow()
    cutoff = (now - timedelta(minutes=15)).isoformat()
    give_up = (now - timedelta(hours=6)).isoformat()
    rows = db.fetchall(
        "SELECT c.* FROM trial_checks c JOIN users u ON u.id = c.user_id "
        "WHERE c.checked = 0 AND c.granted_at <= ? AND u.project_id = ?", (cutoff, projects.current_id()))
    sent = 0
    for r in rows:
        tg = int(r.get("telegram_id") or 0)
        connected = provisioning.user_ever_connected(tg) if tg else None
        if connected is None:
            # unknown: закрываем старые записи
            if str(r.get("granted_at") or "") <= give_up:
                db.execute("UPDATE trial_checks SET checked = 1 WHERE id = ?", (r["id"],))
            continue
        db.execute("UPDATE trial_checks SET checked = 1 WHERE id = ?", (r["id"],))
        if connected:
            continue
        # ещё trial?
        sub = db.fetchone("SELECT type, status FROM subscriptions WHERE id = ?", (r["subscription_id"],))
        if not sub or sub.get("type") != "trial":
            continue
        text, entities = _trial_no_connect_message()
        payload: dict[str, Any] = {
            "chat_id": tg, "text": text, "entities": entities,
            "link_preview_options": {"is_disabled": True},
        }
        if _app_url():
            payload["reply_markup"] = {
                "inline_keyboard": [[{"text": _open_app(), "web_app": {"url": _app_url()}}],
                                    [{"text": "Поддержка", "web_app": {"url": f"{_app_url()}/support"}}]]}
        if api("sendMessage", payload) is not None:
            sent += 1
        time.sleep(0.05)  # ~20 msg/s
    if sent:
        log(f"[trial-check] отправлено сообщений: {sent}")
    return sent





# ── фишки проекта (features в projects/<id>/project.json) ──
_GROWTH_DEFAULTS = {"notconn_hours": 3, "winback_after_days": 14, "winback_gift_days": 3}
_MAX_PER_PASS = 200


def _growth(key: str) -> int:
    try:
        return int(float(db.get_setting(key, str(_GROWTH_DEFAULTS[key])) or _GROWTH_DEFAULTS[key]))
    except (TypeError, ValueError):
        return _GROWTH_DEFAULTS[key]


def _days_ru(n: int) -> str:
    n = int(n)
    w = "день" if n % 10 == 1 and n % 100 != 11 else ("дня" if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 else "дней")
    return f"{n} {w}"


def _noticed(user_id: int, kind: str, ref: str) -> bool:
    return db.fetchone("SELECT 1 FROM user_notices WHERE user_id = ? AND kind = ? AND ref = ?",
                       (int(user_id), kind, ref)) is not None


def _notice(user_id: int, kind: str, ref: str) -> None:
    db.execute("INSERT OR IGNORE INTO user_notices (user_id, kind, ref, sent_at) VALUES (?, ?, ?, ?)",
               (int(user_id), kind, ref, _utcnow().isoformat()))


def run_not_connected(api: Callable[..., Any], log: Callable[[str], None] = print) -> int:
    """оплатил, но так и не подключил подписку (через notconn_hours часов) → одно напоминание. features.notify_not_connected"""
    if not projects.current().feature("notify_not_connected"):
        return 0
    try:
        import provisioning  # type: ignore
    except Exception:  # noqa: BLE001
        return 0
    now = _utcnow()
    older = (now - timedelta(hours=_growth("notconn_hours"))).isoformat()
    newer = (now - timedelta(days=7)).isoformat()
    rows = db.fetchall(
        "SELECT s.id AS sid, s.user_id AS uid, u.telegram_id AS tg, u.email AS email "
        "FROM subscriptions s JOIN users u ON u.id = s.user_id "
        "WHERE s.type = 'vpn' AND s.status = 'Active' AND s.created_at <= ? AND s.created_at >= ? "
        "AND u.project_id = ? AND u.telegram_id IS NOT NULL AND COALESCE(u.is_banned, 0) = 0 "
        "AND NOT EXISTS (SELECT 1 FROM user_notices n WHERE n.user_id = s.user_id AND n.kind = 'notconn' "
        "AND n.ref = CAST(s.id AS TEXT)) ORDER BY s.id LIMIT ?",
        (older, newer, projects.current_id(), _MAX_PER_PASS))
    sent = 0
    for r in rows:
        connected = provisioning.user_ever_connected(int(r["tg"]), r.get("email"))
        if connected is None:
            continue  # Remnawave не ответила — проверим в следующий проход
        _notice(int(r["uid"]), "notconn", str(r["sid"]))
        if connected:
            continue
        p = projects.current()
        payload: dict[str, Any] = {
            "chat_id": int(r["tg"]),
            "text": (f"🔌 Подписка {p.name} оплачена, но вы ещё не подключились.\n\n"
                     "Добавьте подписку в приложение — это займёт минуту. Если что-то не получается, напишите в поддержку."),
            "link_preview_options": {"is_disabled": True},
        }
        if _app_url():
            payload["reply_markup"] = {"inline_keyboard": [
                [{"text": "Подключить", "style": "primary", "web_app": {"url": f"{_app_url()}/subscription?setup=1"}}],
                [{"text": "Поддержка", "web_app": {"url": f"{_app_url()}/support"}}]]}
        if api("sendMessage", payload) is not None:
            sent += 1
        time.sleep(0.05)
    if sent:
        log(f"[notconn:{projects.current_id()}] напоминаний: {sent}")
    return sent


def run_winback(api: Callable[..., Any], log: Callable[[str], None] = print) -> int:
    """давно не оплачивал: подписка кончилась winback_after_days назад → дарим winback_gift_days дней
    (кнопка «Забрать»). Один подарок на каждый перерыв. features.winback_gift"""
    if not projects.current().feature("winback_gift"):
        return 0
    now = _utcnow()
    after = _growth("winback_after_days")
    gift_days = _growth("winback_gift_days")
    lapsed_before = (now - timedelta(days=after)).isoformat()
    lapsed_after = (now - timedelta(days=after + 30)).isoformat()  # совсем старых не трогаем
    rows = db.fetchall(
        "SELECT u.id AS uid, u.telegram_id AS tg, MAX(s.expires_at) AS last_exp "
        "FROM users u JOIN subscriptions s ON s.user_id = u.id "
        "WHERE u.project_id = ? AND u.telegram_id IS NOT NULL AND COALESCE(u.is_banned, 0) = 0 "
        "AND s.expires_at IS NOT NULL GROUP BY u.id "
        "HAVING SUM(CASE WHEN s.type = 'vpn' THEN 1 ELSE 0 END) > 0 "
        "AND MAX(s.expires_at) <= ? AND MAX(s.expires_at) >= ? "
        "AND SUM(CASE WHEN s.status = 'Active' AND s.expires_at > ? THEN 1 ELSE 0 END) = 0 "
        "AND SUM(CASE WHEN s.status = 'Banned' THEN 1 ELSE 0 END) = 0 LIMIT ?",
        (projects.current_id(), lapsed_before, lapsed_after, now.isoformat(), _MAX_PER_PASS))
    sent = 0
    for r in rows:
        ref = str(r["last_exp"])[:19]
        if _noticed(int(r["uid"]), "winback", ref):
            continue
        _notice(int(r["uid"]), "winback", ref)
        services.create_day_gift(int(r["uid"]), gift_days, "winback")
        p = projects.current()
        payload: dict[str, Any] = {
            "chat_id": int(r["tg"]),
            "text": (f"🎁 Давно не виделись! Дарим {_days_ru(gift_days)} подписки {p.name}.\n\n"
                     "Чтобы получить, нажмите кнопку «Забрать»."),
        }
        if _app_url():
            payload["reply_markup"] = {"inline_keyboard": [
                [{"text": "Забрать", "style": "success", "web_app": {"url": f"{_app_url()}/?gifts=1"}}]]}
        if api("sendMessage", payload) is not None:
            sent += 1
        time.sleep(0.05)
    if sent:
        log(f"[winback:{projects.current_id()}] подарков отправлено: {sent}")
    return sent


_DAY = 24 * _H
# давно истёкшие удаляем молча
_DELETE_NOTIFY_WINDOW_DAYS = 2


def _plural_days(n: int) -> str:
    a, b = n % 100, n % 10
    if b == 1 and a != 11:
        return f"{n} день"
    if 2 <= b <= 4 and not (12 <= a <= 14):
        return f"{n} дня"
    return f"{n} дней"


def _deletion_warning(days_left: int) -> tuple[str, list[dict[str, Any]]]:
    bold = {"type": "bold"}
    return _build([
        ("🚨", {"type": "custom_emoji", "custom_emoji_id": EMOJI_SIREN}),
        (" ", None),
        ("Подписка скоро удалится!", bold),
        ("\n\nУ вас есть неоплаченная подписка. Продлите её, либо она будет удалена автоматически через ", None),
        (f"{_plural_days(days_left)}.", bold),
    ])


def _deleted_message() -> tuple[str, list[dict[str, Any]]]:
    return _build([
        ("⛔️", {"type": "custom_emoji", "custom_emoji_id": EMOJI_STOP}),
        (" ", None),
        ("Подписка удалена.", {"type": "bold"}),
        ("\n\nСрок оплаты истёк — подписка была удалена навсегда. "
         "Оформить новую можно в любой момент.", None),
    ])


def _deleted_no_renew_message() -> tuple[str, list[dict[str, Any]]]:
    return _build([
        ("⛔️", {"type": "custom_emoji", "custom_emoji_id": EMOJI_STOP}),
        (" ", None),
        ("Подписка удалена.", {"type": "bold"}),
        ("\n\nСрок действия подписки закончился — она удалена. "
         "Оформить новую можно в любой момент.", None),
    ])


def _send(api: Callable[..., Any], chat_id: int, built: tuple[str, list[dict[str, Any]]],
          keyboard_text: Optional[str]) -> bool:
    text, entities = built
    payload: dict[str, Any] = {
        "chat_id": chat_id, "text": text, "entities": entities,
        "link_preview_options": {"is_disabled": True},
    }
    if keyboard_text and _app_url():
        payload["reply_markup"] = {"inline_keyboard": [[{"text": keyboard_text, "web_app": {"url": _app_url()}}]]}
    return api("sendMessage", payload) is not None


def _aa_grace_hours() -> int:
    try:
        import antiabuse  # type: ignore
        return int(antiabuse.limits()["grace_hours"])
    except Exception:  # noqa: BLE001
        return 24


def _antiabuse_warning(kind: str, count: int, limit: int) -> tuple[str, list[dict[str, Any]]]:
    bold = {"type": "bold"}

    def dev(n: int) -> str:
        if n % 10 == 1 and n % 100 != 11:
            return "устройство"
        return "устройства" if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 else "устройств"

    if kind == "hwid":
        what = f"К вашей подписке подключено {count} {dev(count)}, а по тарифу — {limit}."
    else:
        what = f"Вашей подпиской одновременно пользуются с {count} разных IP-адресов, а по тарифу — {limit} {dev(limit)}."
    return _build([
        ("⚠️", {"type": "custom_emoji", "custom_emoji_id": EMOJI_ANTIABUSE}),
        (" ", None),
        ("Обнаружено нарушение!", bold),
        (f"\n\n{what} Передавать подписку другим людям запрещено.\n\n", None),
        (f"Если через {_plural_hours(_aa_grace_hours())} нарушение сохранится, подписка будет заблокирована.", bold),
        (" Отключите лишние устройства — или докупите устройства в приложении, если их нужно больше.", None),
    ])


def send_antiabuse_warning(api: Callable[..., Any], chat_id: int, kind: str, count: int, limit: int) -> bool:
    return _send(api, chat_id, _antiabuse_warning(kind, count, limit), _open_app())


def delete_subscription(sub: dict[str, Any], log: Callable[[str], None] = print) -> bool:
    """удалить неоплаченную sub (rw + status Deleted); при сбое remnawave бд не трогаем."""
    uid = int(sub["user_id"])
    # другая активная sub на том же rw-аккаунте -> только mark строки
    other_alive = db.fetchone(
        "SELECT id FROM subscriptions WHERE user_id = ? AND id != ? AND status = 'Active' "
        "AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
        (uid, int(sub["id"]), _utcnow().isoformat()),
    )
    if not other_alive:
        user = db.fetchone("SELECT telegram_id, email FROM users WHERE id = ?", (uid,)) or {}
        if provisioning.is_configured():
            res = provisioning.delete_user(user.get("telegram_id"), user.get("email"), user_id=uid)
            if not res.get("ok"):
                log(f"[expiry] Remnawave: не удалось удалить пользователя {uid}: {res.get('error')}")
                return False
    db.execute(
        "UPDATE subscriptions SET status = 'Deleted', deleted_at = ? WHERE id = ? AND status IN ('Active', 'Expired')",
        (db.utcnow_iso(), int(sub["id"])),
    )
    try:
        fulfillment._sync_user_status(uid)
    except Exception:  # noqa: BLE001
        pass
    log(f"[expiry] подписка #{sub['id']} (user {uid}) удалена после окончания")
    return True


def run_expiry_cleanup(api: Callable[..., Any], log: Callable[[str], None] = print) -> int:
    """истёкшие: предупреждения «удалится через N дней», на 7-й день удаление."""
    now = _utcnow()
    delete_after = int(fulfillment.DELETE_AFTER_DAYS)
    rows = db.fetchall(
        "SELECT s.id, s.user_id, s.expires_at, u.telegram_id AS telegram_id, COALESCE(u.is_banned, 0) AS banned, "
        "COALESCE(s.no_renew, 0) AS no_renew "
        "FROM subscriptions s JOIN users u ON u.id = s.user_id "
        "WHERE s.status IN ('Active', 'Expired') AND s.type IN ('vpn', 'trial') "
        "AND s.expires_at IS NOT NULL AND s.expires_at <= ? AND u.project_id = ?",
        (now.isoformat(), projects.current_id()),
    )
    done = 0
    for row in rows:
        if row.get("banned"):
            continue  # заблокированных не трогаем
        exp_raw = str(row["expires_at"])
        exp = _parse_iso(exp_raw)
        if exp is None:
            continue
        # продлили другой sub
        if db.fetchone(
            "SELECT id FROM subscriptions WHERE user_id = ? AND id != ? AND status = 'Active' "
            "AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
            (int(row["user_id"]), int(row["id"]), now.isoformat()),
        ):
            continue
        days_since = int((now - exp).total_seconds() // _DAY)
        sub_id = int(row["id"])
        chat_id = int(row["telegram_id"]) if row.get("telegram_id") else None

        no_renew = bool(row.get("no_renew"))
        # no_renew: удаляем сразу
        limit = 0 if no_renew else delete_after
        if days_since >= limit:
            if not delete_subscription(row, log):
                continue
            done += 1
            fresh = days_since < limit + _DELETE_NOTIFY_WINDOW_DAYS
            if chat_id and fresh and not _already_sent(sub_id, "deleted", exp_raw):
                msg = _deleted_no_renew_message() if no_renew else _deleted_message()
                if _send(api, chat_id, msg, "Оформить подписку"):
                    _mark_sent(sub_id, "deleted", exp_raw)
                time.sleep(0.05)
            continue

        if days_since < 1 or not chat_id:
            continue  # день 0: уже ушло expired
        days_left = delete_after - days_since  # 6..1
        stage = f"del{days_left}"
        if _already_sent(sub_id, stage, exp_raw):
            continue
        if _send(api, chat_id, _deletion_warning(days_left), "Продлить подписку"):
            _mark_sent(sub_id, stage, exp_raw)
            done += 1
        time.sleep(0.05)
    if done:
        log(f"[expiry] предупреждений/удалений: {done}")
    return done


def _blacklist_refresh_sec() -> int:
    try:
        import blacklist  # type: ignore
        return max(300, int(blacklist.REFRESH_SEC))
    except Exception:  # noqa: BLE001
        return 3600


def _each_project(fn: Callable[..., Any], api: Callable[..., Any], log: Callable[[str], None], tag: str) -> None:
    """проход по каждому проекту сети: его пользователи, его бот (api берёт токен проекта из контекста)."""
    for p in projects.all_projects():
        if not p.bot_token:
            continue
        with projects.use(p.id):
            try:
                fn(api, log)
            except Exception as exc:  # noqa: BLE001
                log(f"[{tag}:{p.id}] ошибка прохода: {type(exc).__name__}: {exc}")


def start_background(api: Callable[..., Any], log: Callable[[str], None] = print) -> threading.Thread:
    """фоновый цикл напоминаний в демон-потоке."""

    def _loop() -> None:
        log(f"[reminders] фоновый рассыльщик запущен (интервал {INTERVAL}с)")
        aa_counter = 0
        bl_last = 0.0
        while True:
            # blacklist раз в час (+ на старте)
            if time.time() - bl_last >= _blacklist_refresh_sec():
                bl_last = time.time()
                try:
                    import blacklist  # type: ignore
                    blacklist.refresh(log)
                except Exception as exc:  # noqa: BLE001
                    log(f"[blacklist] ошибка обновления: {type(exc).__name__}: {exc}")
            # grace (тихо)
            try:
                grace.run_once(log)
            except Exception as exc:  # noqa: BLE001
                log(f"[grace] ошибка прохода: {type(exc).__name__}: {exc}")
            _each_project(run_once, api, log, "reminders")
            _each_project(run_expiry_cleanup, api, log, "expiry")
            _each_project(run_onboarding_once, api, log, "onboarding")
            _each_project(run_trial_connection_checks, api, log, "trial-check")
            _each_project(run_not_connected, api, log, "notconn")
            _each_project(run_winback, api, log, "winback")
            # antiabuse ~раз в 10 мин
            aa_counter += 1
            if aa_counter * INTERVAL >= 600:
                aa_counter = 0
                try:
                    import antiabuse  # type: ignore
                    antiabuse.scan_once(log, notify=lambda tg, kind, n, lim: send_antiabuse_warning(api, tg, kind, n, lim))
                except Exception as exc:  # noqa: BLE001
                    log(f"[antiabuse] ошибка прохода: {type(exc).__name__}: {exc}")
                try:
                    import antiabuse  # type: ignore
                    antiabuse.scan_trial_hwids(log)
                except Exception as exc:  # noqa: BLE001
                    log(f"[antiabuse] пробные/HWID: ошибка прохода: {type(exc).__name__}: {exc}")
            time.sleep(INTERVAL)

    thread = threading.Thread(target=_loop, name="sub-reminders", daemon=True)
    thread.start()
    return thread
