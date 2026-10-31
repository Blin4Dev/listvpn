# API v1 для клиентов (мини-приложение / приложения): /api/v1/*
# Авторизация — только токеном API v1: Authorization: Bearer bv1.…
# (получить: POST /api/v1/auth/token по initData Telegram или app-сессии; см. apiv1_auth.py).
# Вебхук ЮKassa (/webhooks/payments/yookassa) — в webhook.py (сервис webhook).
from __future__ import annotations

import hmac
import os
import time
from typing import Any, Optional
from urllib.parse import parse_qsl

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

try:
    from . import apiv1_auth as tokens  # type: ignore
    from . import apiv1_store as store  # type: ignore
    from . import apiv1_app as appx  # type: ignore
except ImportError:  # pragma: no cover
    import apiv1_auth as tokens  # type: ignore
    import apiv1_store as store  # type: ignore
    import apiv1_app as appx  # type: ignore

PREFIX = "/api/v1"

# сколько раз за окно (сек) можно дёргать изменяющие эндпоинты
RESYNC_LIMIT = (5, 600)
CLAIM_LIMIT = (10, 600)
WITHDRAW_LIMIT = (5, 600)
TELEMETRY_LIMIT = (30, 60)
TOKEN_IP_LIMIT = (20, 60)
SERVICE_MIN_TOKEN_LEN = 32
REFRESH_IP_LIMIT = (60, 60)
# initData для обмена на токен — не старше часа (TELEGRAM_INITDATA_MAX_AGE у мини-приложения — сутки)
INITDATA_MAX_AGE = 3600

PAY_LIMIT = (10, 600)
PAY_STATUS_LIMIT = (1, 10)          # опрос ЮKassa по одному платежу — не чаще раза в 10 сек
FAMILY_JOIN_LIMIT = (10, 900)
FAMILY_EDIT_LIMIT = (30, 3600)
FAMILY_CODE_LIMIT = (5, 3600)
DEVICE_DEL_LIMIT = (20, 3600)

# method из запроса → method в withdrawals (панель и форум знают usdt_ton)
WITHDRAW_METHODS = {"crypto": "usdt_ton", "usdt_ton": "usdt_ton"}


class TokenIn(BaseModel):
    # одно из двух: initData мини-приложения Telegram или токен app-сессии (вход по email / OAuth)
    init_data: Optional[str] = Field(None, max_length=8192)
    session_token: Optional[str] = Field(None, max_length=256)


class RefreshIn(BaseModel):
    refresh_token: str = Field(..., min_length=16, max_length=256)


class WithdrawalIn(BaseModel):
    amount: float = Field(..., gt=0, le=10_000_000)
    method: str = Field("crypto", min_length=1, max_length=32)
    # адрес USDT (TON). Не передан — берём адрес из прошлой заявки пользователя
    address: Optional[str] = Field(None, max_length=128)


class SessionIn(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._:\-]+$")
    node_name: str = Field(..., min_length=1, max_length=64)
    # тип сети, через которую идёт VPN: wifi | lte (cellular/4g/5g тоже засчитываются как lte)
    network: Optional[str] = Field(None, max_length=16)


class EmailSendIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    captcha_token: Optional[str] = Field(None, max_length=4096)  # нужен, только если включена капча и нет ключа приложения


class EmailVerifyIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    code: str = Field(..., min_length=4, max_length=12)
    captcha_token: Optional[str] = Field(None, max_length=4096)
    ref: Optional[str] = Field(None, max_length=32)  # реферальный код / id пригласившего (только для нового аккаунта)


class PurchaseIn(BaseModel):
    tariff_code: str = Field(..., min_length=1, max_length=32, pattern=r"^[A-Za-z0-9_:\-]+$")
    extra_devices: int = Field(0, ge=0, le=20)        # устройства сверх тарифа
    use_referral_balance: bool = False                # частично/полностью оплатить реферальным балансом


class SlotIn(BaseModel):
    count: int = Field(1, ge=1, le=10)
    months: int = Field(1, ge=1, le=12)


class FamilyJoinIn(BaseModel):
    code: str = Field(..., min_length=4, max_length=256)


class FamilyInviteIn(BaseModel):
    rotate: bool = False  # true — новый код, старый перестаёт работать


def _err(status: int, message: str, code: str) -> HTTPException:
    return HTTPException(status, detail={"message": message, "code": code})


def build_router(core: Any) -> APIRouter:
    """core — модуль core.py (берём из него авторизацию и хелперы, без циклического импорта)."""
    db = core.db

    def gate(request: Request, x_app_key: Optional[str] = Header(None, alias="X-App-Key")) -> None:
        """API проекта включено в панели; ключ приложения — если требуется (или если передан — должен быть верным)."""
        appx.ensure_schema()
        pid = db.pid()
        if not appx.api_enabled(pid):
            raise _err(503, "API приложения выключено", "api_disabled")
        kid = appx.check_key(x_app_key, pid) if x_app_key else None
        if (x_app_key or appx.key_required(pid)) and not kid:
            raise HTTPException(401, detail={"message": "Неверный ключ приложения — обновите приложение",
                                             "code": "app_key_invalid"})
        try:
            request.state.app_key_id = kid
        except Exception:  # noqa: BLE001
            pass

    r = APIRouter(prefix=PREFIX, tags=["api-v1"], dependencies=[Depends(gate)])

    def _auth_fail(e: "tokens.AuthError") -> HTTPException:
        return HTTPException(e.status, detail={"message": e.message, "code": e.code},
                             headers={"WWW-Authenticate": f'Bearer error="invalid_token", error_description="{e.code}"'})

    def _principal(authorization: Optional[str]) -> dict[str, Any]:
        """Authorization: Bearer bv1.… → {"user", "sid"}; initData и app-сессии здесь не принимаются."""
        raw = (authorization or "").strip()
        if not raw.lower().startswith("bearer "):
            raise HTTPException(401, detail={"message": "Нужен токен: Authorization: Bearer <access_token>",
                                             "code": "token_missing"}, headers={"WWW-Authenticate": "Bearer"})
        try:
            claims = tokens.verify_access(raw[7:].strip())
        except tokens.AuthError as e:
            raise _auth_fail(e)
        user = core.get_user(claims["user_id"])
        if not user:
            raise HTTPException(401, detail={"message": "Пользователь не найден", "code": "session_revoked"})
        if not core.same_project(user):
            # токен другого проекта сети: клиент должен слать X-Project своего проекта (или ходить на его домен)
            raise HTTPException(401, detail={"message": "Токен выдан другому проекту", "code": "wrong_project"})
        return {"user": user, "sid": claims["sid"]}

    def session_dep(authorization: Optional[str] = Header(None)) -> dict[str, Any]:
        return _principal(authorization)

    def auth_any(authorization: Optional[str] = Header(None)) -> dict[str, Any]:
        """токен валиден; заблокированный тоже проходит (видит state=disabled)."""
        return _principal(authorization)["user"]

    def auth(authorization: Optional[str] = Header(None)) -> dict[str, Any]:
        user = _principal(authorization)["user"]
        if user.get("is_banned"):
            raise _err(403, "Аккаунт заблокирован", "account_banned")
        return user

    def auth_channel(user: dict = Depends(auth)) -> dict[str, Any]:
        """действия с деньгами/наградами — как в мини-приложении, только с подпиской на канал."""
        if user.get("telegram_id") and core.channel_required() and not core._check_channel_membership(user):
            raise HTTPException(403, detail={"message": f"Подпишитесь на канал {core.P().name}, чтобы продолжить",
                                             "code": "channel_required", "channel_url": core.P().channel_url})
        return user

    def _limit(key: str, rule: tuple[int, int]) -> None:
        ok, retry = core.ratelimit.rate_limit(key, rule[0], rule[1])
        if not ok:
            raise HTTPException(429, detail={"message": f"Слишком часто. Повторите через {retry} сек.",
                                             "code": "rate_limited", "retry_after_seconds": retry})

    def _fresh(user: dict[str, Any]) -> dict[str, Any]:
        return core.get_user(int(user["id"])) or user

    def _sub_or_404(user: dict[str, Any]) -> dict[str, Any]:
        sub = store.current_subscription(int(user["id"]))
        if not sub:
            raise _err(404, "Подписки нет", "no_subscription")
        return sub

    def service_dep(authorization: Optional[str] = Header(None)) -> None:
        """серверные вызовы (бот, прокси подписок): статичный Authorization: Bearer <API_SERVICE_TOKEN>.
        Пользовательские токены bv1 здесь не принимаются."""
        expected = (os.getenv("API_SERVICE_TOKEN") or "").strip()
        if len(expected) < SERVICE_MIN_TOKEN_LEN:
            raise _err(503, "API_SERVICE_TOKEN не задан (минимум 32 символа)", "service_token_not_configured")
        raw = (authorization or "").strip()
        given = raw[7:].strip() if raw.lower().startswith("bearer ") else ""
        if not given or not hmac.compare_digest(given.encode(), expected.encode()):
            raise HTTPException(401, detail={"message": "Неверный сервисный токен", "code": "token_invalid"},
                                headers={"WWW-Authenticate": "Bearer"})

    # ── 0. токены ──

    @r.post("/auth/token")
    def issue_token(request: Request, body: Optional[TokenIn] = None,
                    x_telegram_init_data: Optional[str] = Header(None, alias="X-Telegram-Init-Data")) -> dict[str, Any]:
        ip = core._client_ip(request)
        _limit(f"v1token:{ip}", TOKEN_IP_LIMIT)
        body = body or TokenIn()
        init_data = (body.init_data or x_telegram_init_data or "").strip()
        if init_data:
            data = core.validate_webapp_init_data(init_data)  # подпись бота + срок
            try:
                auth_date = int(dict(parse_qsl(init_data)).get("auth_date") or 0)
            except ValueError:
                auth_date = 0
            if core.P().bot_token and (not auth_date or time.time() - auth_date > INITDATA_MAX_AGE):
                raise _err(401, "initData устарел — откройте приложение заново", "init_data_expired")
            user = core._resolve_app_user_from_tg(data.get("user") or {}, allow_banned=True)
            core._enforce_blacklist(user)
        elif body.session_token:
            st = body.session_token.strip()
            if st.startswith(appx.TICKET_PREFIX):
                # билет из POST /auth/email/verify: одноразовый, 10 минут
                tid = appx.use_login_ticket(st)
                user = core.get_user(tid) if tid else None
            else:
                sess = core.get_app_session(st)
                user = core.get_user(int(sess["user_id"])) if sess else None
            if user and not core.same_project(user):
                user = None
            if not user:
                raise _err(401, "Сессия истекла, войдите заново", "session_invalid")
        else:
            raise _err(400, "Передайте init_data или session_token", "credentials_missing")
        return tokens.create_session(int(user["id"]), ip, request.headers.get("user-agent") or "",
                                     app_key_id=getattr(request.state, "app_key_id", None))

    # ── 0.1 вход по почте (приложение) ──

    def _captcha_unless_app(token: Optional[str], request: Request) -> None:
        """капча (если включена в панели) — для запросов без ключа приложения; приложение с ключом её не проходит."""
        if not getattr(request.state, "app_key_id", None):
            core._require_captcha(token, request)

    @r.post("/auth/email/send")
    def email_send(body: EmailSendIn, request: Request) -> dict[str, Any]:
        email = body.email.strip().lower()
        if not core._valid_email(email):
            raise _err(400, "Введите корректный email", "bad_email")
        _captcha_unless_app(body.captcha_token, request)
        core._email_send_limits(email, request)
        code, throttled = core.create_email_code(email)
        if not throttled:
            core.send_login_code(email, code)
        out: dict[str, Any] = {"ok": True, "resend_after": core.EMAIL_CODE_RESEND, "code_ttl": core.EMAIL_CODE_TTL}
        if core.ENV != "production" and not core.mailer.is_configured():
            out["dev_code"] = code  # без SMTP и не в проде — код для отладки
        return out

    @r.post("/auth/email/verify")
    def email_verify(body: EmailVerifyIn, request: Request) -> dict[str, Any]:
        email = body.email.strip().lower()
        if not core._valid_email(email):
            raise _err(400, "Введите корректный email", "bad_email")
        core._email_verify_limits(email, request)
        _captcha_unless_app(body.captcha_token, request)
        if not core.verify_email_code(email, body.code):
            raise _err(401, "Неверный или истёкший код", "code_invalid")
        was_new = db.fetchone("SELECT id FROM users WHERE lower(email) = ? AND project_id = ?", (email, db.pid())) is None
        try:
            user = core._resolve_app_user_from_email(email)
        except HTTPException:
            raise _err(403, "Аккаунт заблокирован", "account_banned")
        if was_new:
            core._apply_web_referral(int(user["id"]), body.ref)
        else:
            core._notify_login(user, "код на почту (приложение)", request)
        return {"session_token": appx.create_login_ticket(int(user["id"])), "expires_in": appx.TICKET_TTL,
                "is_new_user": was_new}

    @r.post("/auth/refresh")
    def refresh_token(body: RefreshIn, request: Request) -> dict[str, Any]:
        _limit(f"v1refresh:{core._client_ip(request)}", REFRESH_IP_LIMIT)
        try:
            return tokens.refresh_session(body.refresh_token)
        except tokens.AuthError as e:
            raise _auth_fail(e)

    @r.post("/auth/logout")
    def logout(all_sessions: bool = False, p: dict = Depends(session_dep)) -> dict[str, Any]:
        if all_sessions:
            return {"ok": True, "revoked": tokens.revoke_user(int(p["user"]["id"]))}
        tokens.revoke(p["sid"])
        return {"ok": True, "revoked": 1}

    # ── 1. подписка ──

    def _rw(view: dict[str, Any]) -> tuple[Any, Optional[dict[str, Any]]]:
        try:
            return core._rw_find_user(view)
        except Exception:  # noqa: BLE001
            return None, None

    def _sub_limit(view: dict[str, Any], rw: Optional[dict[str, Any]]) -> int:
        """лимит устройств подписки: Remnawave — источник правды, иначе из БД."""
        n = core._rw_device_limit(rw)
        if n:
            return int(n)
        row = db.fetchone("SELECT MAX(devices_limit) AS n FROM subscriptions WHERE user_id = ? AND status = 'Active'",
                          (int(view["id"]),))
        return max(1, int((row or {}).get("n") or 1))

    def _device_meta(request: Optional[Request]) -> dict[str, Optional[str]]:
        h = request.headers if request is not None else {}
        return {"hwid": appx.clean_hwid(h.get("x-hwid")), "platform": h.get("x-device-os"),
                "os_version": h.get("x-device-os-version"), "model": h.get("x-device-model"),
                "user_agent": h.get("user-agent")}

    def _full(payload: Optional[dict[str, Any]], fresh: dict[str, Any], view: dict[str, Any],
              request: Optional[Request]) -> dict[str, Any]:
        """объект подписки для приложения: + status, config (ключи подключения), traffic, network_stats.
        config выдаётся только активной подписке и только зарегистрированному устройству (заголовок X-HWID)."""
        if payload is None:
            raise _err(404, "Подписки нет", "no_subscription")
        out = dict(payload)
        st = out.get("state")
        out["status"] = st
        out["config"] = None
        out["config_error"] = None
        out["traffic"] = {"used_bytes": None, "limit_bytes": None, "whitelist_active": False}
        out["network_stats"] = appx.network_stats([int(fresh["id"])])
        sub = store.current_subscription(int(view["id"])) or {}
        client, rw = (None, None) if st in ("disabled",) else _rw(view)
        if isinstance(rw, dict):
            tr = core._rw_traffic(core.grace.mask_rw(int(view["id"]), rw))
            out["traffic"]["used_bytes"] = tr.get("used_bytes")
            out["traffic"]["limit_bytes"] = tr.get("limit_bytes")  # 0 — без лимита
        out["traffic"]["whitelist_active"] = bool(st == "active" and str(sub.get("type") or "vpn") != "trial"
                                                  and appx.whitelist_included())
        if st != "active":
            return out  # provisioning / expired / disabled — config: null
        meta = _device_meta(request)
        if not client or not isinstance(rw, dict):
            out["config_error"] = "unavailable"
            return out
        if not meta["hwid"]:
            out["config_error"] = "hwid_required"
            return out
        rw_id = core._rw_num_id(rw)
        try:
            appx.register_device(client, int(rw_id), int(view["id"]), int(fresh["id"]), meta["hwid"],
                                 _sub_limit(view, rw), meta["platform"], meta["os_version"], meta["model"],
                                 meta["user_agent"])
        except appx.DeviceError as e:
            out["config_error"] = e.code
            return out
        except Exception as exc:  # noqa: BLE001
            # учёт устройств в Remnawave не ответил (или HWID там выключен) — ключ всё равно отдаём
            print(f"[api-v1] HWID user {fresh.get('id')}: {type(exc).__name__}: {exc}", flush=True)
        short = str(rw.get("shortUuid") or rw.get("short_uuid") or sub.get("short_uuid") or "")
        try:
            out["config"] = appx.fetch_config(client, short)
        except Exception as exc:  # noqa: BLE001
            print(f"[api-v1] config user {fresh.get('id')}: {type(exc).__name__}: {exc}", flush=True)
        if not out["config"]:
            out["config_error"] = "unavailable"
        return out

    @r.get("/subscription")
    def get_subscription(request: Request, user: dict = Depends(auth_any)) -> dict[str, Any]:
        fresh = _fresh(user)
        view = core.family_owner_for(fresh) or fresh  # участник семьи — подписка владельца
        return _full(store.subscription_payload(view, _sub_or_404(view)), fresh, view, request)

    @r.post("/subscription/resync", status_code=202)
    def resync_subscription(request: Request, user: dict = Depends(auth)) -> JSONResponse:
        fresh = _fresh(user)
        if core.family_owner_for(fresh) is not None:
            raise _err(403, "Подписка общая для семьи — перевыпускает её владелец", "family_member")
        sub = _sub_or_404(fresh)
        state = store.state_of(fresh, sub)
        if state == "disabled":
            raise _err(403, "Подписка заблокирована", "subscription_disabled")
        if state == "expired":
            raise _err(409, "Подписка закончилась — продлите её", "subscription_expired")
        if state != "provisioning":  # уже в очереди — просто отдаём состояние
            _limit(f"v1resync:{fresh['id']}", RESYNC_LIMIT)
            store.enqueue_provisioning(int(fresh["id"]), int(sub["id"]), "resync")
            appx.drop_config_cache(str(sub.get("short_uuid") or ""))
        return JSONResponse(status_code=202, content=_full(store.subscription_payload(fresh), fresh, fresh, request))

    # ── 1.1 профиль ──

    def _me(fresh: dict[str, Any]) -> dict[str, Any]:
        owner = core.family_owner_for(fresh)
        role = "member" if owner is not None else (
            "owner" if core.family.has_paid_sub(int(fresh["id"])) or core.family.has_members(int(fresh["id"])) else "none")
        return {
            "id": int(fresh["id"]),
            "telegram_id": int(fresh["telegram_id"]) if fresh.get("telegram_id") else None,
            "telegram_username": (fresh.get("username") or None) if fresh.get("telegram_id") else None,
            "email": fresh.get("email") or None,
            "registered_at": store.iso_z(fresh.get("created_at")),
            "terms_accepted": bool(fresh.get("terms_accepted_at")),
            "is_banned": bool(fresh.get("is_banned")),
            "family_role": role,
            "project": {"id": core.projects.of(fresh), "name": core.P().name},
        }

    @r.get("/users/me")
    def users_me(user: dict = Depends(auth_any)) -> dict[str, Any]:
        return _me(_fresh(user))

    @r.post("/users/me/terms")
    def users_me_terms(user: dict = Depends(auth)) -> dict[str, Any]:
        """согласие с офертой и политикой (без него оплата недоступна)."""
        db.execute("UPDATE users SET terms_accepted_at = COALESCE(terms_accepted_at, ?) WHERE id = ?",
                   (db.utcnow_iso(), int(user["id"])))
        return _me(_fresh(user))

    # ── 2. тарифы ──

    @r.get("/tariffs")
    def get_tariffs() -> list[dict[str, Any]]:
        return store.list_tariffs()

    # ── 3. рефералы ──

    @r.get("/referrals/me")
    def referrals_me(user: dict = Depends(auth)) -> dict[str, Any]:
        uid = int(user["id"])
        return {
            "invite_link": f"https://t.me/{core.P().bot_username}?start=ref_{uid}",
            "stats": {
                "invited": core.reflevels.invited_referrals(uid),
                "earned_total": store._num(core.reflevels.earnings(uid)["total"]),
                "available_to_withdraw": store._num(store.ledger_balance(uid)),
            },
        }

    @r.post("/referrals/withdrawals", status_code=201)
    def create_withdrawal(body: WithdrawalIn, user: dict = Depends(auth_channel)) -> JSONResponse:
        uid = int(user["id"])
        _limit(f"withdraw:{uid}", WITHDRAW_LIMIT)
        method = WITHDRAW_METHODS.get(body.method.strip().lower())
        if not method:
            raise _err(422, "Способ вывода не поддерживается. Доступно: crypto (USDT TON)", "bad_method")
        amount = round(float(body.amount), 2)
        min_rub = float(core.services.MIN_WITHDRAW_RUB)
        if amount < min_rub:
            raise _err(400, f"Минимальная сумма вывода — {int(min_rub)}₽", "amount_too_small")
        address = (body.address or "").strip()
        if not address:
            last = db.fetchone("SELECT address FROM withdrawals WHERE user_id = ? AND address != '' "
                               "ORDER BY id DESC LIMIT 1", (uid,))
            address = str((last or {}).get("address") or "").strip()
            if not address:
                raise _err(400, "Укажите адрес кошелька USDT (TON)", "address_required")
        if not core.services.valid_ton_address(address):
            raise _err(400, "Неверный адрес. Нужен адрес USDT TON (UQ…/EQ…) или домен .ton / .t.me", "bad_address")

        # баланс по леджеру + списание + заявка — одной транзакцией
        with db.transaction() as conn:
            available = store.reconcile_ledger(conn, uid)
            if available + 1e-9 < amount:
                raise _err(400, "Недостаточно средств на реферальном балансе", "insufficient_funds")
            cur = conn.execute("UPDATE users SET partner_balance = partner_balance - ? "
                               "WHERE id = ? AND partner_balance >= ?", (amount, uid, amount))
            if cur.rowcount == 0:
                raise _err(400, "Недостаточно средств на реферальном балансе", "insufficient_funds")
            wid = int(conn.execute(
                "INSERT INTO withdrawals (user_id, amount, address, method, status, created_at) "
                "VALUES (?, ?, ?, ?, 'pending', ?)", (uid, amount, address, method, db.utcnow_iso()),
            ).lastrowid)
            store.ledger_add(conn, uid, "withdrawal", -amount, withdrawal_id=wid)

        w = db.fetchone("SELECT * FROM withdrawals WHERE id = ?", (wid,)) or {}
        try:  # заявка в форум «выводы», как у /api/app/withdraw
            res = core.forum.notify_withdrawal(w)
            if res and res.get("message_id"):
                core.services.set_withdrawal_forum_ref(
                    wid, res.get("chat", {}).get("id") or core.forum.chat_id(), int(res["message_id"]))
        except Exception:  # noqa: BLE001
            pass
        return JSONResponse(status_code=201, content={"id": wid, "status": w.get("status") or "pending"})

    # ── 4. задания и телеметрия ──

    @r.get("/tasks")
    def get_tasks(user: dict = Depends(auth)) -> list[dict[str, Any]]:
        return store.list_tasks(_fresh(user))

    @r.post("/tasks/{task_id}/claim")
    def claim_task(request: Request, task_id: int = Path(..., ge=1, le=2 ** 62),
                   user: dict = Depends(auth_channel)) -> dict[str, Any]:
        fresh = _fresh(user)
        uid = int(fresh["id"])
        _limit(f"v1claim:{uid}", CLAIM_LIMIT)
        task = store.get_task(task_id)
        if not task:
            raise _err(404, "Задание не найдено", "task_not_found")
        sub = store.current_subscription(uid)
        if sub is not None and store.state_of(fresh, sub) == "disabled":
            raise _err(403, "Подписка заблокирована", "subscription_disabled")
        if sub is not None and sub.get("no_renew"):
            raise _err(403, "Продление этой подписки отключено", "no_renew")

        ev = store.evaluate_task(fresh, task)
        if ev["status"] == "claimed":
            raise _err(409, "Награда за это задание уже получена", "already_claimed")
        if ev["status"] != "completed":
            raise _err(409, "Задание ещё не выполнено", "not_completed")
        if task.get("kind") == "vpn_minutes":
            # телеметрию шлёт клиент — сверяем с панелью, что подключение действительно было
            connected = core.provisioning.user_ever_connected(
                int(fresh["telegram_id"]) if fresh.get("telegram_id") else 0, fresh.get("email"))
            if connected is False:
                raise _err(409, "Не видим подключений к VPN — подключитесь и попробуйте снова", "not_connected")
        if not store.mark_claimed(uid, task_id):
            raise _err(409, "Награда за это задание уже получена", "already_claimed")

        days = max(0, int(task.get("reward_days") or 0))
        try:
            if days and sub is None:
                core._grant_fresh_subscription(uid, days)  # новая подписка, выдаётся сразу
            elif days:
                store.extend_subscription(sub, days)  # type: ignore[arg-type]
                core.grace.end_for_user(uid)
                store.enqueue_provisioning(uid, int(sub["id"]), "task_reward")  # type: ignore[index]
        except Exception as exc:  # noqa: BLE001
            store.unmark_claimed(uid, task_id)
            core.forum.report_error("API v1: не удалось начислить дни за задание",
                                    f"user id{uid}, задание #{task_id}: {type(exc).__name__}: {exc}")
            raise _err(502, "Не удалось начислить награду, попробуйте позже", "grant_failed")
        fresh = _fresh(fresh)
        return _full(store.subscription_payload(fresh), fresh, fresh, request)

    @r.post("/telemetry/sessions")
    def telemetry_session(body: SessionIn, user: dict = Depends(auth)) -> dict[str, Any]:
        uid = int(user["id"])
        _limit(f"v1tele:{uid}", TELEMETRY_LIMIT)
        store.session_heartbeat(uid, body.session_id, body.node_name.strip())
        appx.record_network(uid, body.network)
        return {"ok": True}

    # ── 5. покупки (оплата — на странице ЮKassa) ──

    def _yk_method() -> str:
        """способ оплаты для ЮKassa: форма ЮKassa сама покажет доступные; нужен любой включённый в панели."""
        for m in core.pay_methods():
            if m["id"] != "tg_stars" and m.get("enabled"):
                return str(m["id"])
        raise _err(503, "Оплата сейчас недоступна", "payments_unavailable")

    def _create_payment(fresh: dict[str, Any], request: Request, body: Any) -> dict[str, Any]:
        uid = int(fresh["id"])
        _limit(f"v1pay:{uid}", PAY_LIMIT)
        if not fresh.get("terms_accepted_at"):
            raise _err(403, "Сначала примите условия оферты и политику конфиденциальности (POST /users/me/terms)",
                       "terms_not_accepted")
        body.method = _yk_method()
        tpl = appx.return_url_template()
        if tpl:
            request.state.pay_return_url = tpl  # core подставит {payment_id}
        try:
            res = core.app_payment_create(body, request, fresh)
        except HTTPException as e:
            d = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
            raise HTTPException(e.status_code, detail={**d, "code": d.get("code") or "payment_error"})
        paid = bool(res.get("paid"))
        if not paid and not res.get("pay_url"):
            raise _err(502, "Не удалось создать платёж", "payment_error")
        return {
            "purchase_id": res["payment_id"],
            "payment_url": None if paid else res.get("pay_url"),
            "status": "succeeded" if paid else "pending",
            "amount": store._num(res.get("amount") or 0),
            "full_price": store._num(res.get("full_price") or res.get("amount") or 0),
            "referral_applied": store._num(res.get("referral_applied") or 0),
            "currency": "RUB",
        }

    @r.post("/purchases/yookassa/create", status_code=201)
    def purchase_create(body: PurchaseIn, request: Request, user: dict = Depends(auth_channel)) -> JSONResponse:
        fresh = _fresh(user)
        t = db.fetchone("SELECT * FROM tariffs WHERE code = ? AND project_id = ? AND is_active = 1",
                        (body.tariff_code, db.pid()))
        if not t:
            raise _err(404, "Тариф не найден", "tariff_not_found")
        req = core.CreatePaymentBody(months=int(t.get("months") or 1), purpose="subscription",
                                     extra_devices=int(body.extra_devices),
                                     use_referral_balance=bool(body.use_referral_balance))
        return JSONResponse(status_code=201, content=_create_payment(fresh, request, req))

    @r.post("/purchases/hwid-slot/create", status_code=201)
    def purchase_slot(body: SlotIn, request: Request, user: dict = Depends(auth_channel)) -> JSONResponse:
        """докупка слотов устройств (hwid_limit) к своей платной подписке, на 1/3/6/12 мес."""
        fresh = _fresh(user)
        if core.family_owner_for(fresh) is not None:
            raise _err(403, "Слоты докупает владелец семейной подписки", "family_member")
        if int(body.months) not in core.fulfillment.DEVICE_ADDON_MONTHS:
            raise _err(422, "Срок: 1, 3, 6 или 12 месяцев", "bad_months")
        sub = db.fetchone("SELECT id FROM subscriptions WHERE user_id = ? AND status = 'Active' AND type != 'trial' "
                          "ORDER BY id DESC LIMIT 1", (int(fresh["id"]),))
        if not sub:
            raise _err(409, "Слоты докупаются к активной платной подписке", "no_subscription")
        req = core.CreatePaymentBody(months=int(body.months), purpose="devices", extra_devices=int(body.count),
                                     subscription_id=int(sub["id"]))
        return JSONResponse(status_code=201, content=_create_payment(fresh, request, req))

    _PAY_STATUS = {"paid": "succeeded", "pending": "pending", "processing": "pending"}

    @r.get("/purchases/{purchase_id}/status")
    def purchase_status(purchase_id: str = Path(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$"),
                        user: dict = Depends(auth_any)) -> dict[str, Any]:
        p = core.fulfillment.get_payment(purchase_id)
        if not p or int(p["user_id"]) != int(user["id"]):
            raise _err(404, "Покупка не найдена", "purchase_not_found")
        if p["status"] == "pending":
            ok, _ = core.ratelimit.rate_limit(f"paycheck:{purchase_id}", *PAY_STATUS_LIMIT)
            if ok:
                try:
                    core.fulfillment.confirm_via_provider(purchase_id)
                except Exception as exc:  # noqa: BLE001
                    print(f"[api-v1] статус {purchase_id}: {type(exc).__name__}: {exc}", flush=True)
                p = core.fulfillment.get_payment(purchase_id) or p
        raw = str(p.get("status") or "")
        st = _PAY_STATUS.get(raw)
        if st is None:
            st = "canceled" if raw == "refunded" or "cancel" in str(p.get("error") or "") else "failed"
        out: dict[str, Any] = {"purchase_id": purchase_id, "status": st, "purpose": p.get("purpose"),
                               "amount": store._num(p.get("amount") or 0), "currency": p.get("currency") or "RUB",
                               "payment_url": p.get("pay_url") if st == "pending" else None,
                               "paid_at": store.iso_z(p.get("paid_at")), "expires_at": None}
        if st == "succeeded":
            sub = store.current_subscription(int(user["id"]))
            out["expires_at"] = store.iso_z((sub or {}).get("expires_at"))
        return out

    # ── 6. семья: общий лимит устройств (HWID) владельца и гостей ──

    def _family_payload(fresh: dict[str, Any]) -> dict[str, Any]:
        fam = core.family
        uid = int(fresh["id"])
        owner = core.family_owner_for(fresh)
        view = owner or fresh
        vid = int(view["id"])
        if owner is not None:
            role = "member"
        elif fam.has_paid_sub(uid) or fam.has_members(uid):
            role = "owner"
        else:
            role = "none"
        devices: list[dict[str, Any]] = []
        devices_ok = True
        limit = 0
        if role != "none":
            client, rw = _rw(view)
            limit = _sub_limit(view, rw)
            if client and isinstance(rw, dict):
                try:
                    owners = appx.device_owners(vid)
                    devices = [appx.device_view(d, owners, vid) for d in appx.rw_devices(client, core._rw_num_id(rw))]
                except Exception as exc:  # noqa: BLE001
                    devices_ok = False
                    print(f"[api-v1] family devices {vid}: {type(exc).__name__}: {exc}", flush=True)
            else:
                devices_ok = False
        for d in devices:
            d["is_mine"] = d["user_id"] == uid
            d["can_delete"] = role == "owner" or d["is_mine"]
        rows = db.fetchall(
            "SELECT f.member_id, f.accepted_at, f.created_at AS invited_at, u.* FROM family_members f "
            "JOIN users u ON u.id = f.member_id WHERE f.owner_id = ? AND f.status = 'active' ORDER BY f.id",
            (vid,)) if role != "none" else []
        members = [{
            "user_id": int(m["member_id"]),
            "display_name": core._user_label(m),
            "used_hwids": sum(1 for d in devices if d["user_id"] == int(m["member_id"])),
            "joined_at": store.iso_z(m.get("accepted_at") or m.get("invited_at")),
        } for m in rows]
        live = role == "owner" and fam.has_paid_sub(uid)
        invite = None
        if live:
            code = fam.code_for(uid, core.projects.of(fresh))
            invite = {"code": code, "link": appx.invite_link(code)}
        return {
            "role": role,
            "is_owner": role == "owner",
            "owner": ({"user_id": vid, "display_name": core._user_label(view)} if role != "none" else None),
            "used_hwids": len(devices),
            "hwid_limit": limit,
            "devices_available": devices_ok,
            "devices": devices,
            "members": members,
            "max_members": fam.max_members(core.projects.of(fresh)),
            "can_invite": live,
            "invite": invite,
        }

    def _fam_err(e: Any) -> HTTPException:
        return _err(int(getattr(e, "status", 400) or 400), e.message, getattr(e, "code", "family_error"))

    def _after_member_left(owner: Optional[dict[str, Any]], who: str) -> None:
        """гость ушёл/удалён: ключ владельца перевыпускается, все устройства отвязываются (как в мини-приложении)."""
        if not owner:
            return
        old = db.fetchone("SELECT short_uuid FROM subscriptions WHERE user_id = ? AND status = 'Active' "
                          "ORDER BY id DESC LIMIT 1", (int(owner["id"]),))
        core._family_revoke_owner_key(owner, who)
        appx.forget_owner_devices(int(owner["id"]))
        appx.drop_config_cache(str((old or {}).get("short_uuid") or ""))

    @r.get("/family")
    def family_get(user: dict = Depends(auth)) -> dict[str, Any]:
        return _family_payload(_fresh(user))

    @r.post("/family/invite")
    def family_invite(body: Optional[FamilyInviteIn] = None, user: dict = Depends(auth_channel)) -> dict[str, Any]:
        fresh = _fresh(user)
        uid = int(fresh["id"])
        if core.family_owner_for(fresh) is not None:
            raise _err(403, "Вы гость семьи — приглашать может только владелец", "family_member")
        if not core.family.has_paid_sub(uid):
            raise _err(409, "Сначала оформите подписку", "no_subscription")
        pid = core.projects.of(fresh)
        if body is not None and body.rotate:
            _limit(f"v1famcode:{uid}", FAMILY_CODE_LIMIT)
            code = core.family.rotate_code(uid, pid)
        else:
            code = core.family.code_for(uid, pid)
        return {"code": code, "invite_link": appx.invite_link(code)}

    @r.post("/family/join")
    def family_join(body: FamilyJoinIn, request: Request, user: dict = Depends(auth_channel)) -> dict[str, Any]:
        fresh = _fresh(user)
        uid = int(fresh["id"])
        _limit(f"v1famjoin:{uid}", FAMILY_JOIN_LIMIT)
        _limit(f"v1famjoin:ip:{core._client_ip(request)}", (40, 900))
        before = core.family.active_owner_id(uid)
        try:
            info = core.family.join(fresh, body.code)
        except core.family.FamilyError as e:
            raise _fam_err(e)
        if before is not None and int(before) == int(info["owner_id"]):
            raise _err(409, "Вы уже в этой семье", "already_in_family")
        owner = core.get_user(int(info["owner_id"]))
        if owner:
            core._family_tg_notify(owner, f"{core._esc_html(core._user_label(fresh))} вошёл в вашу семейную подписку.")
        return _family_payload(_fresh(fresh))

    def _leave(fresh: dict[str, Any]) -> dict[str, Any]:
        owner_id = core.family.leave(int(fresh["id"]))
        if owner_id is None:
            raise _err(409, "Вы не состоите в семье", "not_in_family")
        _after_member_left(core.get_user(owner_id), core._user_label(fresh))
        return {"ok": True}

    # /members/me объявлен раньше /members/{user_id}
    @r.delete("/family/members/me")
    def family_leave_me(user: dict = Depends(auth)) -> dict[str, Any]:
        return _leave(_fresh(user))

    @r.post("/family/leave")
    def family_leave(user: dict = Depends(auth)) -> dict[str, Any]:
        return _leave(_fresh(user))

    @r.delete("/family/members/{member_user_id}")
    def family_kick(member_user_id: int = Path(..., ge=1, le=2 ** 62), user: dict = Depends(auth)) -> dict[str, Any]:
        fresh = _fresh(user)
        uid = int(fresh["id"])
        if core.family_owner_for(fresh) is not None:
            raise _err(403, "Вы гость семьи — удалять может только владелец", "family_member")
        _limit(f"v1famedit:{uid}", FAMILY_EDIT_LIMIT)
        row = db.fetchone("SELECT id FROM family_members WHERE owner_id = ? AND member_id = ? LIMIT 1",
                          (uid, int(member_user_id)))
        if not row:
            raise _err(404, "Гость не найден", "member_not_found")
        try:
            removed = core.family.remove_member(uid, int(row["id"]))
        except core.family.FamilyError as e:
            raise _fam_err(e)
        if removed and removed.get("family_was_active"):
            core._family_tg_notify(removed, f"Вас убрали из семейной подписки {core._esc_html(core.P().name)}.")
            _after_member_left(fresh, core._user_label(removed))
        return _family_payload(_fresh(fresh))

    @r.delete("/family/devices/{device_id}")
    def family_device_delete(device_id: str = Path(..., min_length=1, max_length=256),
                             user: dict = Depends(auth)) -> dict[str, Any]:
        """отвязать устройство: владелец — любое, гость — только своё."""
        fresh = _fresh(user)
        uid = int(fresh["id"])
        _limit(f"v1devdel:{uid}", DEVICE_DEL_LIMIT)
        owner = core.family_owner_for(fresh)
        view = owner or fresh
        client, rw = _rw(view)
        if not client or not isinstance(rw, dict):
            raise _err(503, "Устройства сейчас недоступны, попробуйте позже", "devices_unavailable")
        rw_id = core._rw_num_id(rw)
        try:
            present = any(str(d.get("hwid")) == device_id for d in appx.rw_devices(client, rw_id))
        except Exception:  # noqa: BLE001
            raise _err(503, "Устройства сейчас недоступны, попробуйте позже", "devices_unavailable")
        if not present:
            raise _err(404, "Устройство не найдено", "device_not_found")
        if owner is not None and appx.device_owners(int(view["id"])).get(device_id) != uid:
            raise _err(403, "Это устройство другого участника — отвязать его может владелец", "not_your_device")
        try:
            client.delete_hwid_device({"userId": rw_id, "hwid": device_id})
        except Exception as exc:  # noqa: BLE001
            core.forum.report_error("API v1: не удалось отвязать устройство", f"user {uid}: {type(exc).__name__}: {exc}")
            raise _err(502, "Не удалось отвязать устройство, попробуйте позже", "device_delete_failed")
        appx.forget_device(int(view["id"]), device_id)
        return _family_payload(_fresh(fresh))

    return r
