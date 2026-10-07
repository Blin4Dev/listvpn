from __future__ import annotations

import os
import sys as _sys
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# src/api в path
_API_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "api"))
if os.path.isdir(_API_DIR) and _API_DIR not in _sys.path:
    _sys.path.insert(0, _API_DIR)

try:
    from . import database as db
except ImportError:
    import database as db  # type: ignore

try:
    from . import fulfillment
except ImportError:
    import fulfillment  # type: ignore

try:
    import yookassa  # type: ignore
except Exception:  # noqa: BLE001
    yookassa = None  # type: ignore


app = FastAPI(title="BatmanVPN Webhooks", version="1.0.0", docs_url=None, redoc_url=None)


@app.on_event("startup")
def _startup() -> None:
    db.init_db()


@app.get("/health")
@app.get("/")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "webhook"}


# проверка доступности адреса уведомлений: get → 200
@app.get("/yookassa")
def yookassa_probe() -> dict[str, Any]:
    return {"ok": True}


def _log(msg: str) -> None:
    print(f"[webhook] {msg}", flush=True)


def _client_ip(request: Request) -> str:
    return (request.headers.get("x-real-ip")
            or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
            or (request.client.host if request.client else ""))


def _ack(note: str = "") -> JSONResponse:
    return JSONResponse(status_code=200, content={"ok": True, **({"note": note} if note else {})})


@app.post("/yookassa")
async def yookassa_callback(request: Request) -> JSONResponse:
    """
    HTTP-уведомление ЮKassa. Подписи у уведомлений нет, поэтому:
      1) (по желанию) IP отправителя — из сетей ЮKassa (YOOKASSA_CHECK_IP=1);
      2) телу НЕ доверяем: статус и сумму берём запросом к API ЮKassa по ID платежа,
         который мы сами сохранили при создании, и сверяем metadata.payment_id.
    Так поддельное уведомление не выдаст подписку и не отменит платёж.
    ЮKassa повторяет уведомление, пока не получит 200.
    """
    if yookassa is None:
        return JSONResponse(status_code=503, content={"error": "yookassa_unavailable"})
    client = yookassa.get_client()
    if not client.is_configured():
        return JSONResponse(status_code=503, content={"error": "yookassa_not_configured"})

    if (os.getenv("YOOKASSA_CHECK_IP") or "").strip().lower() in ("1", "true", "yes", "on"):
        ip = _client_ip(request)
        if not yookassa.YooKassaClient.ip_allowed(ip):
            _log(f"отклонено уведомление с чужого IP {ip}")
            return JSONResponse(status_code=403, content={"error": "forbidden"})

    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse(status_code=400, content={"error": "bad_json"})
    if not isinstance(payload, dict):
        return JSONResponse(status_code=400, content={"error": "bad_json"})

    event = str(payload.get("event") or "")
    obj = payload.get("object") if isinstance(payload.get("object"), dict) else {}
    # для refund.* id платежа лежит в object.payment_id
    yk_id = str((obj.get("payment_id") if event.startswith("refund.") else obj.get("id")) or "")
    if not yk_id:
        return JSONResponse(status_code=400, content={"error": "no_payment_id"})

    payment = fulfillment.get_payment_by_provider_id(yk_id)
    if payment is None:
        meta = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}
        if meta.get("payment_id"):
            payment = fulfillment.get_payment(str(meta["payment_id"]))
    if payment is None:
        return _ack("unknown_payment")
    if payment.get("provider") != "yookassa":
        _log(f"уведомление для платежа {payment['payment_id']} другого провайдера ({payment.get('provider')}) — игнор")
        return _ack("ignored")

    stored = str(payment.get("provider_payment_id") or "")
    if stored and stored != yk_id:
        _log(f"уведомление: платёж ЮKassa {yk_id} не совпадает с {stored} ({payment['payment_id']}) — игнор")
        return _ack("id_mismatch")

    if event.startswith("refund."):
        # возвраты делаем сами из панели; тут только лог
        _log(f"{event} по платежу {payment['payment_id']}")
        return _ack()

    try:
        yp = client.get_payment(yk_id)
    except Exception as exc:  # noqa: BLE001
        _log(f"не удалось перепроверить платёж {yk_id}: {exc} — попросим повторить")
        return JSONResponse(status_code=503, content={"error": "verify_failed"})
    if not yookassa.YooKassaClient.matches(yp, payment["payment_id"]):
        _log(f"платёж ЮKassa {yk_id} создан не для {payment['payment_id']} — игнор")
        return _ack("payload_mismatch")

    norm = yookassa.YooKassaClient.normalize_status(yp.get("status"))
    if norm == "paid":
        if not stored:
            db.execute("UPDATE payments SET provider_payment_id = ? WHERE payment_id = ? AND provider_payment_id IS NULL",
                       (yk_id, payment["payment_id"]))
        result = fulfillment.fulfill_payment(
            payment["payment_id"],
            provider_payment_id=yk_id,
            amount=yookassa.YooKassaClient.payment_amount(yp),
        )
        return JSONResponse(status_code=200, content={"ok": bool(result.get("ok"))})
    if norm == "failed":
        fulfillment.mark_failed(payment["payment_id"], "provider_canceled")
        return _ack()
    return _ack()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("webhook:app", host="0.0.0.0", port=int(os.getenv("WEBHOOK_PORT", "5000")))
