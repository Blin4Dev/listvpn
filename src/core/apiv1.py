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
except ImportError:  # pragma: no cover
    import apiv1_auth as tokens  # type: ignore
    import apiv1_store as store  # type: ignore

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


def _err(status: int, message: str, code: str) -> HTTPException:
    return HTTPException(status, detail={"message": message, "code": code})


def build_router(core: Any) -> APIRouter:
    """core — модуль core.py (берём из него авторизацию и хелперы, без циклического импорта)."""
    db = core.db
    r = APIRouter(prefix=PREFIX, tags=["api-v1"])

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
        if user.get("telegram_id") and core.REQUIRED_CHANNEL_ID and not core._check_channel_membership(user):
            raise HTTPException(403, detail={"message": "Подпишитесь на канал BatmanVPN, чтобы продолжить",
                                             "code": "channel_required", "channel_url": core.REQUIRED_CHANNEL_URL})
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
            if core.TELEGRAM_BOT_TOKEN and (not auth_date or time.time() - auth_date > INITDATA_MAX_AGE):
                raise _err(401, "initData устарел — откройте приложение заново", "init_data_expired")
            user = core._resolve_app_user_from_tg(data.get("user") or {}, allow_banned=True)
            core._enforce_blacklist(user)
        elif body.session_token:
            sess = core.get_app_session(body.session_token.strip())
            user = core.get_user(int(sess["user_id"])) if sess else None
            if not user:
                raise _err(401, "Сессия истекла, войдите заново", "session_invalid")
        else:
            raise _err(400, "Передайте init_data или session_token", "credentials_missing")
        return tokens.create_session(int(user["id"]), ip, request.headers.get("user-agent") or "")

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

    @r.get("/subscription")
    def get_subscription(user: dict = Depends(auth_any)) -> dict[str, Any]:
        fresh = _fresh(user)
        return store.subscription_payload(fresh, _sub_or_404(fresh))  # type: ignore[return-value]

    @r.post("/subscription/resync", status_code=202)
    def resync_subscription(user: dict = Depends(auth)) -> JSONResponse:
        fresh = _fresh(user)
        sub = _sub_or_404(fresh)
        state = store.state_of(fresh, sub)
        if state == "disabled":
            raise _err(403, "Подписка заблокирована", "subscription_disabled")
        if state == "expired":
            raise _err(409, "Подписка закончилась — продлите её", "subscription_expired")
        if state != "provisioning":  # уже в очереди — просто отдаём состояние
            _limit(f"v1resync:{fresh['id']}", RESYNC_LIMIT)
            store.enqueue_provisioning(int(fresh["id"]), int(sub["id"]), "resync")
        return JSONResponse(status_code=202, content=store.subscription_payload(fresh))

    # ── 1a. серверный: ключ обхода (белые списки) по Telegram ID ──

    @r.get("/service/bypass")
    def service_bypass(tg_id: int = Query(..., ge=1, le=2 ** 62), _: None = Depends(service_dep)) -> dict[str, Any]:
        """{"bypass": {enabled, available, until, key, used_bytes?, limit_bytes?}} — тот же объект,
        что мини-приложение получает в /api/app/subscription. Нет пользователя — 404 user_not_found.
        Без активной подписки обход считается выключенным (enabled=false, key=null)."""
        row = db.fetchone("SELECT id FROM users WHERE telegram_id = ?", (int(tg_id),))
        user = core.get_user(int(row["id"])) if row else None
        if not user:
            raise _err(404, "Пользователь не найден", "user_not_found")
        if user.get("is_banned") or core.subscription_status_for_user(user) not in ("active", "trial"):
            return {"bypass": {"enabled": False, "available": core.fulfillment.whitelist_available(),
                               "until": None, "key": None}}
        return {"bypass": core._bypass_info(int(user["id"]))}

    # ── 2. тарифы ──

    @r.get("/tariffs")
    def get_tariffs() -> list[dict[str, Any]]:
        return store.list_tariffs()

    # ── 3. рефералы ──

    @r.get("/referrals/me")
    def referrals_me(user: dict = Depends(auth)) -> dict[str, Any]:
        uid = int(user["id"])
        return {
            "invite_link": f"https://t.me/{core.BOT_USERNAME}?start=ref_{uid}",
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
    def claim_task(task_id: int = Path(..., ge=1, le=2 ** 62), user: dict = Depends(auth_channel)) -> dict[str, Any]:
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
        payload = store.subscription_payload(_fresh(fresh))
        if payload is None:
            raise _err(404, "Подписки нет", "no_subscription")
        return payload

    @r.post("/telemetry/sessions")
    def telemetry_session(body: SessionIn, user: dict = Depends(auth)) -> dict[str, Any]:
        uid = int(user["id"])
        _limit(f"v1tele:{uid}", TELEMETRY_LIMIT)
        store.session_heartbeat(uid, body.session_id, body.node_name.strip())
        return {"ok": True}

    return r
