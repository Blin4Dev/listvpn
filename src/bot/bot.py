from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

# src/core и src/api в path
_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (os.path.join(_HERE, "..", "core"), os.path.join(_HERE, "..", "api")):
    _p = os.path.abspath(_p)
    if os.path.isdir(_p) and _p not in sys.path:
        sys.path.insert(0, _p)

import database as db  # type: ignore
import projects  # type: ignore
import fulfillment  # type: ignore
import reminders  # type: ignore
import services  # type: ignore
import forum  # type: ignore
import blacklist  # type: ignore
import names  # type: ignore

API_BASE = "https://api.telegram.org"


def _env(*keys: str, default: str = "") -> str:
    for key in keys:
        val = (os.getenv(key) or "").strip()
        if val:
            return val
    return default


# сеть проектов: у каждого проекта свой бот. Один процесс опрашивает всех ботов, каждого — в своём потоке
# и в контексте своего проекта (projects.current()): токен, мини-приложение, тексты — проекта.
def P() -> "projects.Project":
    return projects.current()


def _miniapp_url() -> str:
    return P().miniapp_url


def _support_url() -> str:
    return P().support_url  # fallback, если нет мини-приложения

# premium emoji (нужен premium/fragment + bot api 9.4+)
EMOJI_FOX = _env("EMOJI_FOX", default="5963229754516574142")  # premium-эмодзи в приветствии /start
EMOJI_KEY = _env("EMOJI_KEY", default="6005570495603282482")
EMOJI_CHAT = _env("EMOJI_CHAT", default="5994297722574737553")


def api(method: str, payload: Optional[dict[str, Any]] = None, *, timeout: float = 35.0,
        _retries: int = 1) -> Any:
    url = f"{API_BASE}/bot{P().bot_token}/{method}"
    data = json.dumps(payload or {}).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            return None
        # 429: один retry по retry_after
        if e.code == 429 and _retries > 0:
            try:
                ra = float(((body or {}).get("parameters") or {}).get("retry_after") or 1)
            except (TypeError, ValueError):
                ra = 1.0
            time.sleep(min(ra, 30) + 0.1)
            return api(method, payload, timeout=timeout, _retries=_retries - 1)
    except urllib.error.URLError:
        return None
    if not body.get("ok"):
        return None
    return body.get("result")


def _support_button(**extra: Any) -> Optional[dict[str, Any]]:
    """кнопка «поддержка» в мини-приложении."""
    if _miniapp_url():
        return {"text": "Поддержка", "web_app": {"url": f"{_miniapp_url()}/support"}, **extra}
    if _support_url():
        return {"text": "Поддержка", "url": _support_url(), **extra}
    return None


def _open_app_keyboard() -> dict[str, Any]:
    """клавиатура для сервисных сообщений (оплата)."""
    buttons: list[list[dict[str, Any]]] = []
    if _miniapp_url():
        buttons.append([{"text": P().bot_text("open_app_text", f"🚀 Открыть {P().name}"), "web_app": {"url": _miniapp_url()}}])
    sup = _support_button()
    if sup:
        buttons.append([{**sup, "text": "💬 Поддержка"}])
    return {"inline_keyboard": buttons} if buttons else {}


def _utf16_len(s: str) -> int:
    """длина в utf-16 code units (смещения entity в telegram)."""
    return len(s.encode("utf-16-le")) // 2


def _welcome_text_entities() -> tuple[str, list[dict[str, Any]]]:
    """приветствие: premium-эмодзи + bold «добро пожаловать!»."""
    segments: list[tuple[str, Optional[dict[str, Any]]]] = [
        ("🦊", {"type": "custom_emoji", "custom_emoji_id": EMOJI_FOX}),
        (" ", None),
        (P().bot_text("welcome_title", "Добро пожаловать!"), {"type": "bold"}),
        ("\n\n" + P().bot_text("welcome_text", "Пришло время для по-настоящему качественного сервиса."), None),
    ]
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


def _launch_button() -> dict[str, Any]:
    if _miniapp_url():
        return {"text": "Запустить", "web_app": {"url": _miniapp_url()}}
    return {"text": "Запустить", "url": f"https://t.me/{P().bot_username}"}


def _send_welcome(chat_id: int) -> None:
    """/start: приветствие + кнопки «запустить» / «поддержка» (bot api 9.4+)."""
    text, entities = _welcome_text_entities()
    launch = _launch_button()
    # style: primary — синяя, danger — красная, success — зелёная (bot api 9.4+)
    rows: list[list[dict[str, Any]]] = [[{**launch, "style": "danger", "icon_custom_emoji_id": EMOJI_KEY}]]
    sup = _support_button(icon_custom_emoji_id=EMOJI_CHAT)
    if sup:
        rows.append([sup])
    api("sendMessage", {
        "chat_id": chat_id,
        "text": text,
        "entities": entities,
        "link_preview_options": {"is_disabled": True},
        "reply_markup": {"inline_keyboard": rows},
    })


def _send_banned(chat_id: int) -> None:
    """заблокированному: сообщение о блокировке вместо приветствия."""
    text = "⛔️ Ваш аккаунт заблокирован за нарушение правил сервиса."
    api("sendMessage", {
        "chat_id": chat_id,
        "text": text,
        "entities": [
            {"type": "custom_emoji", "custom_emoji_id": reminders.EMOJI_STOP, "offset": 0, "length": 2},
            {"type": "bold", "offset": 3, "length": len(text) - 3},
        ],
        **({"reply_markup": {"inline_keyboard": [[_support_button()]]}} if _support_button() else {}),
    })


def handle_start(message: dict[str, Any]) -> None:
    chat_id = message["chat"]["id"]
    frm = message.get("from") or {}
    telegram_id = int(frm.get("id") or chat_id)

    # payload у /start
    text = message.get("text") or ""
    parts = text.split(maxsplit=1)
    payload = parts[1].strip() if len(parts) > 1 else ""

    existed = db.fetchone("SELECT id FROM users WHERE telegram_id = ? AND project_id = ?",
                          (telegram_id, P().id)) is not None
    user = fulfillment.get_user(_ensure_user(telegram_id, frm))
    is_new = not existed

    # blacklist при входе
    try:
        blacklist.enforce(user, log=lambda m: print(m, flush=True))
    except Exception as exc:  # noqa: BLE001
        print(f"[blacklist] ошибка проверки: {exc}", flush=True)
    if user and user.get("is_banned"):
        _send_banned(chat_id)
        return

    # first_start_at один раз
    if user:
        db.execute(
            "UPDATE users SET first_start_at = ? WHERE id = ? AND first_start_at IS NULL",
            (db.utcnow_iso(), user["id"]),
        )

    if payload.startswith("ref_") and user:
        _apply_referral(user, payload[4:].strip(), is_new)
    elif payload.startswith("trk_") and user:
        _apply_tracking(user, payload[4:].strip(), frm, is_new)
    elif payload.startswith("promo_") and user:
        _apply_promo(chat_id, user, payload[6:].strip())
    elif payload.startswith("gift_") and user and _send_gift(chat_id, payload[5:].strip()):
        return
    elif payload.startswith("pay_") and user and _send_payment_return(chat_id, user, payload[4:].strip()):
        return
    elif payload.startswith("payfail_") and user and _send_payment_return(chat_id, user, payload[8:].strip(), failed=True):
        return

    _send_welcome(chat_id)


def _send_gift(chat_id: int, raw: str) -> bool:
    """/start gift_XXXX: что за подарок + кнопка активации в мини-приложении."""
    if not re.fullmatch(r"[A-Fa-f0-9]{8,16}", raw or ""):
        return False
    code = "GIFT-" + raw.upper()
    try:
        import reflevels  # type: ignore
        info = reflevels.gift_preview(code)
    except Exception as exc:  # noqa: BLE001
        print(f"[bot] gift preview error: {type(exc).__name__}: {exc}", flush=True)
        info = None
    if not info:
        api("sendMessage", {"chat_id": chat_id, "text": "⚠️ Подарок не найден. Проверьте ссылку."})
        return True
    if info["status"] != "issued":
        text = {"redeemed": "Этот подарок уже активирован.", "revoked": "Этот подарок отменён.",
                "expired": "Срок действия подарка истёк."}.get(info["status"], "Подарок недоступен.")
        api("sendMessage", {"chat_id": chat_id, "text": f"⚠️ {text}"})
        return True
    m = info["months"]
    period = {1: "1 месяц", 3: "3 месяца", 6: "6 месяцев", 12: "12 месяцев"}.get(m, f"{m} мес.")
    extra = " + белые списки" if (info["whitelist"] and fulfillment.furk_enabled()) else ""
    text = f"🎁 Вам подарок — подписка на {period}{extra}.\n\nКод: <code>{code}</code>"
    markup: dict[str, Any] = {}
    if _miniapp_url():
        url = f"{_miniapp_url()}/gift/activate?code={urllib.parse.quote(code)}"
        markup = {"reply_markup": {"inline_keyboard": [[{"text": "Активировать", "style": "primary", "web_app": {"url": url}}]]}}
    else:
        text += "\n\nОткройте приложение → «Активировать подарок» и введите код."
    api("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "HTML", **markup})
    return True


def _send_payment_return(chat_id: int, user: dict[str, Any], payment_id: str, failed: bool = False) -> bool:
    """возврат после оплаты (ЮKassa): кнопка на платёж в мини-приложении; false если не найден."""
    if not _miniapp_url() or not re.fullmatch(r"[a-f0-9]{16,64}", payment_id or ""):
        return False
    pay = db.fetchone("SELECT status FROM payments WHERE payment_id = ? AND user_id = ?", (payment_id, int(user["id"])))
    if not pay:
        return False
    status = pay.get("status")
    if status in ("paid", "processing"):
        text, failed = "✅ Оплата прошла", False
    elif status == "failed" or failed:
        text, failed = ("❌ Платёж отклонён\n\nПроизошла ошибка на стороне провайдера. "
                        "Если деньги списались, они вернутся автоматически в течение 3 дней."), True
    else:
        text = "Возвращаемся к оплате"
    api("sendMessage", {
        "chat_id": chat_id,
        "text": text,
        "reply_markup": {"inline_keyboard": [[{
            "text": "Попробовать снова" if failed else "Открыть", "style": "primary",
            "web_app": {"url": f"{_miniapp_url()}/payment/return?payment_id={payment_id}{'&result=fail' if failed else ''}"},
        }]]},
    })
    return True


def _apply_tracking(user: dict[str, Any], code: str, frm: dict[str, Any], is_new: bool) -> None:
    """учёт перехода по трекинг-ссылке + её приветствие."""
    if not code:
        return
    try:
        full_name = " ".join(x for x in (frm.get("first_name"), frm.get("last_name")) if x) or None
        link = services.register_tracking_click(
            code,
            user_id=int(user["id"]),
            telegram_id=int(user["telegram_id"]),
            username=user.get("username"),
            full_name=full_name,
            is_new_user=is_new,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[bot] tracking error: {type(exc).__name__}: {exc}", flush=True)
        return
    if link and link.get("welcome_message"):
        api("sendMessage", {
            "chat_id": int(user["telegram_id"]),
            "text": str(link["welcome_message"]),
            "link_preview_options": {"is_disabled": True},
        })


def _apply_promo(chat_id: int, user: dict[str, Any], code: str) -> None:
    """активация промокода из deep-link (/start promo_CODE)."""
    if not code:
        return
    try:
        info = services.activate_promocode(int(user["id"]), code)
        if info.get("type") == "days":
            _send_day_gift(chat_id, int(info["days"]), "promo")
            return
        safe_code = forum._esc(str(info.get("code") or code).upper())
        api("sendMessage", {
            "chat_id": chat_id,
            "text": f"✅ Промокод <b>{safe_code}</b> активирован — скидка {int(info['percent'])}%.",
            "parse_mode": "HTML",
        })
    except services.ServiceError as exc:
        api("sendMessage", {"chat_id": chat_id, "text": f"⚠️ {exc.message}"})
    except Exception as exc:  # noqa: BLE001
        print(f"[bot] promo error: {type(exc).__name__}: {exc}", flush=True)


def days_ru(n: int) -> str:
    n = int(n)
    w = "день" if n % 10 == 1 and n % 100 != 11 else ("дня" if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 else "дней")
    return f"{n} {w}"


def day_gift_text(days: int, source: str) -> str:
    if source == "winback":
        return (f"🎁 Давно не виделись! Дарим {days_ru(days)} подписки {P().name}.\n\n"
                "Чтобы получить, нажмите кнопку «Забрать».")
    return f"🎁 Вы получили {days_ru(days)} к подписке, чтобы получить нажмите кнопку «Забрать»."


def day_gift_markup() -> Optional[dict[str, Any]]:
    """кнопка «Забрать» открывает мини-приложение — там подарок и начисляется."""
    if not _miniapp_url():
        return None
    return {"inline_keyboard": [[{"text": "Забрать", "style": "success", "web_app": {"url": f"{_miniapp_url()}/?gifts=1"}}]]}


def _send_day_gift(chat_id: int, days: int, source: str) -> bool:
    markup = day_gift_markup()
    text = day_gift_text(days, source)
    if not markup:
        text += "\n\nОткройте приложение — подарок ждёт на главной."
    return api("sendMessage", {"chat_id": chat_id, "text": text, **({"reply_markup": markup} if markup else {})}) is not None


def _ensure_user(telegram_id: int, frm: dict[str, Any]) -> int:
    """создаёт пользователя в бд при отсутствии; возвращает internal id."""
    row = db.fetchone("SELECT id FROM users WHERE telegram_id = ? AND project_id = ?", (telegram_id, P().id))
    if row:
        return int(row["id"])
    import secrets
    import string

    def _ref_code() -> str:
        alphabet = string.ascii_uppercase + string.digits
        while True:
            code = "".join(secrets.choice(alphabet) for _ in range(8))
            if not db.fetchone("SELECT id FROM users WHERE referral_code = ?", (code,)):
                return code

    db.execute(
        "INSERT INTO users (project_id, telegram_id, username, first_name, last_name, balance, status, is_banned, "
        "referral_code, is_partner, partner_balance, partner_rate, autopay_enabled, created_at) "
        "VALUES (?, ?, ?, ?, ?, 0, 'None', 0, ?, 0, 0, 25, 0, ?)",
        (
            P().id,
            telegram_id,
            names.tg_username(frm.get("username")),
            None,  # имя/фамилию не храним
            None,
            _ref_code(),
            db.utcnow_iso(),
        ),
    )
    return db.last_id()


def _apply_referral(user: dict[str, Any], code: str, is_new: bool = True) -> None:
    # реферер только у нового юзера (иначе фарм со старого)
    if not code or user.get("referred_by") or not is_new:
        return
    # ref_<uid>; старые ref_<CODE> ок
    ref = None
    # пригласивший — только из этого же проекта
    if code.isdigit():
        ref = db.fetchone("SELECT id, referred_by FROM users WHERE id = ? AND project_id = ?", (int(code), P().id))
    if not ref:
        ref = db.fetchone("SELECT id, referred_by FROM users WHERE referral_code = ? AND project_id = ?", (code, P().id))
    if not ref or int(ref["id"]) == int(user["id"]):
        return
    # без петель a<->b
    if ref.get("referred_by") and int(ref["referred_by"]) == int(user["id"]):
        return
    db.execute("UPDATE users SET referred_by = ? WHERE id = ?", (ref["id"], user["id"]))


def handle_pre_checkout(query: dict[str, Any]) -> None:
    # подтвердить за 10с
    payment_id = query.get("invoice_payload") or ""
    payment = fulfillment.get_payment(payment_id) if payment_id else None
    ok = fulfillment.stars_precheckout_ok(payment, query)
    body: dict[str, Any] = {"pre_checkout_query_id": query["id"], "ok": ok}
    if not ok:
        body["error_message"] = "Платёж не найден или уже обработан. Попробуйте снова."
    api("answerPreCheckoutQuery", body)


def handle_successful_payment(message: dict[str, Any]) -> None:
    sp = message.get("successful_payment") or {}
    payment_id = sp.get("invoice_payload") or ""
    charge_id = sp.get("telegram_payment_charge_id") or ""
    chat_id = message["chat"]["id"]
    if not payment_id:
        return
    result = fulfillment.fulfill_payment(
        payment_id, stars_charge_id=charge_id, amount=sp.get("total_amount"),
        stars_payer_id=(message.get("from") or {}).get("id"),
    )
    if result.get("ok"):
        api("sendMessage", {
            "chat_id": chat_id,
            "text": "✅ <b>Оплата получена!</b>\nПодписка активирована. Откройте приложение, чтобы получить ключ.",
            "parse_mode": "HTML",
            "reply_markup": _open_app_keyboard(),
        })
    else:
        api("sendMessage", {
            "chat_id": chat_id,
            "text": "⚠️ Оплата получена, но при активации возникла ошибка. Мы уже разбираемся — напишите в поддержку, если ключ не появился.",
            "parse_mode": "HTML",
        })


def handle_callback(cq: dict[str, Any]) -> None:
    """кнопки форума «выводы»: одобрить / отклонить."""
    data = str(cq.get("data") or "")
    cq_id = cq.get("id")
    from_id = int((cq.get("from") or {}).get("id") or 0)
    msg = cq.get("message") or {}
    chat_id = (msg.get("chat") or {}).get("id")
    message_id = msg.get("message_id")
    thread_id = msg.get("message_thread_id")

    def answer(text: str = "") -> None:
        api("answerCallbackQuery", {"callback_query_id": cq_id, "text": text})

    # кнопки опроса из уже отправленных сообщений: опрос удалён
    if data == "survey:start" or data.startswith(("sv:", "svm:", "svd:")):
        answer("Опрос больше не проводится")
        return

    # старые кнопки выводов: только панель
    if data.startswith("wd_ok_") or data.startswith("wd_no_"):
        answer("Выводы обрабатываются в панели: Пользователи → Выводы")
        return

    answer()


def process_update(update: dict[str, Any]) -> None:
    try:
        if "pre_checkout_query" in update:
            handle_pre_checkout(update["pre_checkout_query"])
            return
        if "callback_query" in update:
            handle_callback(update["callback_query"])
            return
        message = update.get("message") or update.get("edited_message")
        if not message:
            return
        if message.get("successful_payment"):
            handle_successful_payment(message)
            return
        text = message.get("text") or ""
        if text.startswith("/start"):
            handle_start(message)
            return
    except Exception as exc:  # noqa: BLE001
        print(f"[bot] ошибка обработки апдейта: {type(exc).__name__}: {exc}", flush=True)


def _poll(pid: str, token: str) -> None:
    """long polling одного бота (в контексте его проекта). Токен сменили / убрали в панели — поток завершается."""
    with projects.use(pid):
        me = api("getMe")
        if me:
            print(f"[bot:{pid}] запущен как @{me.get('username')}", flush=True)
        else:
            print(f"[bot:{pid}] предупреждение: getMe не ответил (проверьте токен/сеть).", flush=True)
        # polling: снять webhook
        api("deleteWebhook", {"drop_pending_updates": False})
        api("setMyCommands", {"commands": [{"command": "start",
                                            "description": P().bot_text("command_description", f"Запустить {P().name}")}]})
        offset = 0
        allowed = ["message", "edited_message", "callback_query", "pre_checkout_query"]
        while P().bot_token == token:
            try:
                updates = api("getUpdates", {"offset": offset, "timeout": 30, "allowed_updates": allowed}, timeout=40)
                if not updates or P().bot_token != token:
                    continue
                for upd in updates:
                    offset = max(offset, int(upd["update_id"]) + 1)
                    process_update(upd)
            except Exception as exc:  # noqa: BLE001
                print(f"[bot:{pid}] ошибка цикла: {type(exc).__name__}: {exc}", flush=True)
                time.sleep(3)
        print(f"[bot:{pid}] токен изменён в панели — переподключение", flush=True)


SUPERVISE_SEC = 10


def run() -> None:
    """бот всех проектов сети. Токены — в панели (Настройки → Проект), подхватываются без перезапуска."""
    import threading

    db.init_db()
    # фоновые напоминания — одни на всю сеть; каждое сообщение уходит ботом проекта пользователя
    reminders.start_background(api, log=lambda m: print(m, flush=True))

    running: dict[str, tuple[str, threading.Thread]] = {}
    warned: set[str] = set()
    while True:
        try:
            for p in projects.all_projects():
                tok = p.bot_token
                cur = running.get(p.id)
                if not tok:
                    if p.id not in warned:
                        print(f"[bot:{p.id}] бот проекта {p.name} не подключён — панель → Настройки → Проект.", flush=True)
                        warned.add(p.id)
                    continue
                warned.discard(p.id)
                if cur and cur[0] == tok and cur[1].is_alive():
                    continue
                t = threading.Thread(target=_poll, args=(p.id, tok), name=f"bot-{p.id}", daemon=True)
                running[p.id] = (tok, t)
                t.start()
        except KeyboardInterrupt:
            break
        except Exception as exc:  # noqa: BLE001
            print(f"[bot] супервизор: {type(exc).__name__}: {exc}", flush=True)
        time.sleep(SUPERVISE_SEC)


if __name__ == "__main__":
    run()
