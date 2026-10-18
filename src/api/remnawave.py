"""
Remnawave Panel API client (3.4.4)
"""

from __future__ import annotations

import json
import os
import re
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

API_CONTRACT = "3.4.4"

# Бот работает ТОЛЬКО со своими пользователями панели: имя строго batman_<id пользователя бота>.
# Любое изменение / удаление другого пользователя (чужие проекты на той же панели) клиент отклоняет.
OWN_USERNAME_RE = re.compile(r"^batman_[0-9]+$")


def is_own_username(name: Any) -> bool:
    return bool(OWN_USERNAME_RE.match(str(name or "")))


class RemnawaveError(Exception):
    """Базовая ошибка клиента Remnawave."""

    def __init__(self, message: str, *, status: Optional[int] = None, payload: Any = None):
        super().__init__(message)
        self.status = status
        self.payload = payload


class RemnawaveForeignUserError(RemnawaveError):
    """Попытка изменить пользователя панели, который не batman_<id>, или массовая операция."""


class RemnawaveAuthError(RemnawaveError):
    pass


class RemnawaveNotFoundError(RemnawaveError):
    pass


class RemnawaveValidationError(RemnawaveError):
    pass


def _env(*keys: str, default: str = "") -> str:
    for key in keys:
        val = (os.getenv(key) or "").strip()
        if val:
            return val
    return default


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | str | None) -> Optional[str]:
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def _to_camel(key: str) -> str:
    parts = key.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


def camelize(obj: Any) -> Any:
    # рекурсивно меняем значения для тела запроса
    if isinstance(obj, dict):
        return {_to_camel(k): camelize(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [camelize(x) for x in obj]
    if isinstance(obj, datetime):
        return _iso(obj)
    return obj


def unwrap(data: Any) -> Any:
    """Ответ панели часто обёрнут в {\"response\": ...}."""
    if isinstance(data, dict) and "response" in data and len(data) <= 3:
        return data["response"]
    return data


class RemnawaveAPI:

    def __init__(
        self,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        *,
        timeout: Optional[float] = None,
        verify_ssl: bool = True,
    ) -> None:
        raw = (
            base_url
            or _env("REMWAVE_PANEL_URL", "REMNAWAVE_BASE_URL", "REMNAWAVE_PANEL_URL", default="http://127.0.0.1:3000")
        )
        self.base_url = raw.rstrip("/")
        self.token = token or _env("REMWAVE_API_KEY", "REMNAWAVE_TOKEN", "REMNAWAVE_API_TOKEN")
        # короткий таймаут для ожидания апи ремны
        if timeout is None:
            try:
                timeout = float(_env("REMWAVE_TIMEOUT", default="10") or 10)
            except ValueError:
                timeout = 10.0
        self.timeout = timeout
        self.verify_ssl = verify_ssl
        if not self.token:
            raise RemnawaveAuthError("Не задан API-токен Remnawave (REMWAVE_API_KEY)")

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json_body: Any = None,
        raw_body: Optional[bytes] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Any:
        if not path.startswith("/"):
            path = "/" + path
        url = f"{self.base_url}{path}"
        if params:
            clean = {k: v for k, v in params.items() if v is not None}
            if clean:
                qs = urllib.parse.urlencode(
                    {k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in clean.items()},
                    doseq=True,
                )
                url = f"{url}?{qs}"

        hdrs = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.token}",
            "X-Api-Contract": API_CONTRACT,
        }
        if self.base_url.startswith("http://"):
            # прямое подключение к панели (http://localhost:3000, http://remnawave:3000) мимо HTTPS-прокси:
            # без этих заголовков Remnawave отклоняет запрос (так же делают SDK Remnawave и xbm)
            hdrs["X-Forwarded-For"] = "127.0.0.1"
            hdrs["X-Forwarded-Proto"] = "https"
        if headers:
            hdrs.update(headers)

        data: Optional[bytes] = raw_body
        if json_body is not None:
            payload = camelize(json_body)
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            hdrs["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=data, headers=hdrs, method=method.upper())
        ctx = None
        if url.startswith("https://") and not self.verify_ssl:
            ctx = ssl._create_unverified_context()  # noqa: S323

        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=ctx) as resp:
                body = resp.read()
                if not body or resp.status == 204:
                    return None
                try:
                    parsed = json.loads(body.decode("utf-8"))
                except json.JSONDecodeError:
                    return body.decode("utf-8", errors="replace")
                return unwrap(parsed)
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
            try:
                err_payload = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                err_payload = raw
            msg = None
            if isinstance(err_payload, dict):
                msg = err_payload.get("message") or err_payload.get("error") or err_payload.get("detail")
            message = str(msg or raw or e.reason)
            if e.code in (401, 403):
                raise RemnawaveAuthError(message, status=e.code, payload=err_payload) from e
            if e.code == 404:
                raise RemnawaveNotFoundError(message, status=e.code, payload=err_payload) from e
            if e.code == 400:
                raise RemnawaveValidationError(message, status=e.code, payload=err_payload) from e
            raise RemnawaveError(message, status=e.code, payload=err_payload) from e
        except urllib.error.URLError as e:
            raise RemnawaveError(f"Не удалось связаться с Remnawave ({self.base_url}): {e.reason}") from e

    def get(self, path: str, **kwargs: Any) -> Any:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, json_body: Any = None, **kwargs: Any) -> Any:
        return self.request("POST", path, json_body=json_body, **kwargs)

    def patch(self, path: str, json_body: Any = None, **kwargs: Any) -> Any:
        return self.request("PATCH", path, json_body=json_body, **kwargs)

    def put(self, path: str, json_body: Any = None, **kwargs: Any) -> Any:
        return self.request("PUT", path, json_body=json_body, **kwargs)

    def delete(self, path: str, json_body: Any = None, **kwargs: Any) -> Any:
        return self.request("DELETE", path, json_body=json_body, **kwargs)

    # ── защита: только batman_<id> ──
    _own_ids_lock = threading.Lock()

    def _own_cache(self) -> set:
        cache = getattr(self, "_own_ids", None)
        if cache is None:
            cache = set()
            self._own_ids = cache  # type: ignore[attr-defined]
        return cache

    @staticmethod
    def _unwrap_user(data: Any) -> dict[str, Any]:
        if isinstance(data, dict) and isinstance(data.get("response"), dict):
            data = data["response"]
        return data if isinstance(data, dict) else {}

    def _remember_own(self, data: Any) -> None:
        u = self._unwrap_user(data)
        if is_own_username(u.get("username")) and u.get("id") is not None:
            with self._own_ids_lock:
                cache = self._own_cache()
                if len(cache) > 100000:
                    cache.clear()
                cache.add(int(u["id"]))

    def assert_own_user(self, user_id: Any) -> None:
        """перед изменением: пользователь панели с этим id должен называться batman_<число>."""
        try:
            uid = int(user_id)
        except (TypeError, ValueError):
            raise RemnawaveForeignUserError(f"отказ: непонятный id пользователя {user_id!r}")
        if uid in self._own_cache():
            return
        try:
            u = self._unwrap_user(self.get(f"/api/users/{uid}"))
        except RemnawaveError:
            u = {}
        if not u.get("username"):
            # 3.x: пользователь по числовому id — через /api/users/resolve
            try:
                u = self._unwrap_user(self.resolve_user(id=uid))
            except RemnawaveError:
                u = {}
        if u.get("id") is not None and str(u.get("id")) != str(uid):
            u = {}  # панель вернула не того пользователя
        name = u.get("username")
        if not is_own_username(name):
            raise RemnawaveForeignUserError(
                f"отказ: пользователь Remnawave id={uid} ({name!r}) не batman_<id> — бот его не трогает")
        self._remember_own(u)

    def _refuse_bulk(self, what: str) -> Any:
        raise RemnawaveForeignUserError(
            f"отказ: «{what}» затрагивает всех пользователей панели (в том числе чужих) — запрещено")

    def get_users(
        self,
        *,
        start: int = 0,
        size: int = 50,
        filters: Any = None,
        sorting: Any = None,
        **extra: Any,
    ) -> Any:
        params: dict[str, Any] = {"start": start, "size": size, **extra}
        if filters is not None:
            params["filters"] = filters
        if sorting is not None:
            params["sorting"] = sorting
        return self.get("/api/users/", params=params)

    def get_user(self, user_id: int) -> Any:
        return self.get(f"/api/users/{int(user_id)}")

    def get_user_by_username(self, username: str) -> Any:
        data = self.get(f"/api/users/by-username/{urllib.parse.quote(username, safe='')}")
        self._remember_own(data)
        return data

    def get_user_by_short_uuid(self, short_uuid: str) -> Any:
        return self.get(f"/api/users/by-short-uuid/{urllib.parse.quote(short_uuid, safe='')}")

    def resolve_user(
        self,
        *,
        id: Optional[int] = None,
        uuid: Optional[str] = None,
        short_uuid: Optional[str] = None,
        username: Optional[str] = None,
        telegram_id: Optional[int] = None,
        email: Optional[str] = None,
    ) -> Any:
        # 3.x: ровно одно из id / shortUuid / username. uuid/telegramId/email панель игнорирует
        # и при пустом теле может вернуть чужого пользователя.
        body: dict[str, Any] = {}
        if id is not None:
            body["id"] = int(id)
        elif short_uuid:
            body["shortUuid"] = short_uuid
        elif username:
            body["username"] = username
        else:
            raise RemnawaveValidationError(
                "resolve: нужен id, shortUuid или username",
                status=400,
            )
        return self.post("/api/users/resolve", json_body=body)

    def create_user(
        self,
        *,
        username: str,
        expire_at: datetime | str,
        status: str = "ACTIVE",
        short_uuid: Optional[str] = None,
        trojan_password: Optional[str] = None,
        vless_uuid: Optional[str] = None,
        ss_password: Optional[str] = None,
        traffic_limit_bytes: Optional[int] = None,
        traffic_limit_strategy: str = "NO_RESET",
        description: Optional[str] = None,
        tag: Optional[str] = None,
        telegram_id: Optional[int] = None,
        email: Optional[str] = None,
        hwid_device_limit: Optional[int] = None,
        active_internal_squads: Optional[list[str]] = None,
        external_squad_uuid: Optional[str] = None,
        **extra: Any,
    ) -> Any:
        if not is_own_username(username):
            raise RemnawaveForeignUserError(f"отказ: создавать можно только batman_<id>, а не {username!r}")
        body: dict[str, Any] = {
            "username": username,
            "expire_at": expire_at,
            "status": status,
            "short_uuid": short_uuid,
            "trojan_password": trojan_password,
            "vless_uuid": vless_uuid,
            "ss_password": ss_password,
            "traffic_limit_bytes": traffic_limit_bytes,
            "traffic_limit_strategy": traffic_limit_strategy,
            "description": description,
            "tag": tag,
            "telegram_id": telegram_id,
            "email": email,
            "hwid_device_limit": hwid_device_limit,
            "active_internal_squads": active_internal_squads,
            "external_squad_uuid": external_squad_uuid,
            **extra,
        }
        data = self.post("/api/users/", json_body=body)
        self._remember_own(data)
        return data

    def update_user(self, *, id: Optional[int] = None, username: Optional[str] = None, **fields: Any) -> Any:
        body: dict[str, Any] = {**fields}
        body.pop("uuid", None)
        if id is None:
            raise RemnawaveForeignUserError("отказ: update_user без id")
        self.assert_own_user(id)
        if username is not None and not is_own_username(username):
            raise RemnawaveForeignUserError(f"отказ: переименование в {username!r} (не batman_<id>)")
        body["id"] = int(id)
        if username is not None:
            body["username"] = username
        return self.patch("/api/users/", json_body=body)

    def delete_user(self, user_id: int) -> Any:
        self.assert_own_user(user_id)
        res = self.delete(f"/api/users/{int(user_id)}")
        self._own_cache().discard(int(user_id))
        return res

    def enable_user(self, user_id: int) -> Any:
        self.assert_own_user(user_id)
        return self.post(f"/api/users/{int(user_id)}/actions/enable")

    def disable_user(self, user_id: int) -> Any:
        self.assert_own_user(user_id)
        return self.post(f"/api/users/{int(user_id)}/actions/disable")

    def reset_user_traffic(self, user_id: int) -> Any:
        self.assert_own_user(user_id)
        return self.post(f"/api/users/{int(user_id)}/actions/reset-traffic")

    def revoke_user_subscription(self, user_id: int, body: Optional[dict[str, Any]] = None) -> Any:
        self.assert_own_user(user_id)
        return self.post(f"/api/users/{user_id}/actions/revoke", json_body=body or {})

    def extend_user(
        self,
        user_id: int,
        *,
        days: Optional[int] = None,
        hours: Optional[int] = None,
        minutes: Optional[int] = None,
        extend_to: Optional[datetime | str] = None,
        **extra: Any,
    ) -> Any:
        self.assert_own_user(user_id)
        body: dict[str, Any] = {**extra}
        if days is not None:
            body["days"] = days
        if hours is not None:
            body["hours"] = hours
        if minutes is not None:
            body["minutes"] = minutes
        if extend_to is not None:
            body["expire_at"] = extend_to
        return self.post(f"/api/users/{user_id}/actions/extend", json_body=body)

    def get_user_accessible_nodes(self, user_id: int) -> Any:
        return self.get(f"/api/users/{user_id}/accessible-nodes")

    def get_user_subscription_request_history(self, user_id: int) -> Any:
        return self.get(f"/api/users/{user_id}/subscription-request-history")

    def get_users_tags(self) -> Any:
        return self.get("/api/users/tags")

    # массовые пользователи
    def bulk_update_users(self, body: dict[str, Any]) -> Any:
        return self._refuse_bulk("массовое изменение")

    def bulk_delete_users(self, body: dict[str, Any]) -> Any:
        return self._refuse_bulk("массовое удаление")

    def bulk_delete_users_by_status(self, body: dict[str, Any]) -> Any:
        return self._refuse_bulk("удаление по статусу")

    def bulk_reset_traffic(self, body: dict[str, Any]) -> Any:
        return self._refuse_bulk("массовый сброс трафика")

    def bulk_revoke_subscription(self, body: dict[str, Any]) -> Any:
        return self._refuse_bulk("массовый перевыпуск")

    def bulk_extend_expiration(self, body: dict[str, Any]) -> Any:
        return self._refuse_bulk("массовое продление")

    def bulk_update_squads(self, body: dict[str, Any]) -> Any:
        return self._refuse_bulk("массовая смена сквадов")

    def bulk_all_update(self, body: dict[str, Any]) -> Any:
        return self._refuse_bulk("изменение всех пользователей")

    def bulk_all_reset_traffic(self, body: Optional[dict[str, Any]] = None) -> Any:
        return self._refuse_bulk("сброс трафика всем пользователям")

    def bulk_all_extend(self, body: dict[str, Any]) -> Any:
        return self._refuse_bulk("продление всем пользователям")

    def get_internal_squads(self) -> Any:
        return self.get("/api/internal-squads")

    def get_internal_squad(self, uuid: str) -> Any:
        return self.get(f"/api/internal-squads/{uuid}")

    def create_internal_squad(self, body: dict[str, Any]) -> Any:
        return self.post("/api/internal-squads", json_body=body)

    def update_internal_squad(self, body: dict[str, Any]) -> Any:
        return self.patch("/api/internal-squads", json_body=body)

    def delete_internal_squad(self, uuid: str) -> Any:
        return self.delete(f"/api/internal-squads/{uuid}")

    def get_internal_squad_accessible_nodes(self, uuid: str) -> Any:
        return self.get(f"/api/internal-squads/{uuid}/accessible-nodes")

    def get_internal_squad_usage(self, uuid: str, **params: Any) -> Any:
        return self.get(f"/api/internal-squads/{uuid}/usage", params=params)

    def add_users_to_internal_squad(self, uuid: str) -> Any:
        return self._refuse_bulk("добавить всех пользователей в сквад")

    def remove_users_from_internal_squad(self, uuid: str) -> Any:
        return self._refuse_bulk("убрать всех пользователей из сквада")

    def add_many_users_to_internal_squad(self, uuid: str, user_ids: list[int]) -> Any:
        for uid in user_ids:
            self.assert_own_user(uid)
        return self.post(
            f"/api/internal-squads/{uuid}/bulk-actions/add-many-users",
            json_body={"user_ids": user_ids},
        )

    def remove_many_users_from_internal_squad(self, uuid: str, user_ids: list[int]) -> Any:
        for uid in user_ids:
            self.assert_own_user(uid)
        return self.delete(
            f"/api/internal-squads/{uuid}/bulk-actions/remove-many-users",
            json_body={"user_ids": user_ids},
        )

    def reorder_internal_squads(self, body: dict[str, Any]) -> Any:
        return self.post("/api/internal-squads/actions/reorder", json_body=body)

    def get_internal_squad_tags(self) -> Any:
        return self.get("/api/internal-squads/tags")

    def get_external_squads(self) -> Any:
        return self.get("/api/external-squads")

    def get_external_squad(self, uuid: str) -> Any:
        return self.get(f"/api/external-squads/{uuid}")

    def create_external_squad(self, body: dict[str, Any]) -> Any:
        return self.post("/api/external-squads", json_body=body)

    def update_external_squad(self, body: dict[str, Any]) -> Any:
        return self.patch("/api/external-squads", json_body=body)

    def delete_external_squad(self, uuid: str) -> Any:
        return self.delete(f"/api/external-squads/{uuid}")

    def add_users_to_external_squad(self, uuid: str) -> Any:
        return self._refuse_bulk("назначить внешний сквад всем пользователям")

    def remove_users_from_external_squad(self, uuid: str) -> Any:
        return self._refuse_bulk("убрать внешний сквад у всех пользователей")

    def get_hwid_devices(self, **params: Any) -> Any:
        return self.get("/api/hwid/devices", params=params or None)

    def get_user_hwid_devices(self, user_id: int) -> Any:
        return self.get(f"/api/hwid/devices/{user_id}")

    def _assert_hwid_body(self, body: dict[str, Any]) -> None:
        if "userId" not in (body or {}):
            raise RemnawaveForeignUserError("отказ: операция с HWID без userId")
        self.assert_own_user(body["userId"])

    def create_hwid_device(self, body: dict[str, Any]) -> Any:
        self._assert_hwid_body(body)
        return self.post("/api/hwid/devices", json_body=body)

    def delete_hwid_device(self, body: dict[str, Any]) -> Any:
        self._assert_hwid_body(body)
        return self.post("/api/hwid/devices/delete", json_body=body)

    def delete_all_user_hwid_devices(self, body: dict[str, Any]) -> Any:
        self._assert_hwid_body(body)
        return self.post("/api/hwid/devices/delete-all", json_body=body)

    def get_hwid_stats(self) -> Any:
        return self.get("/api/hwid/devices/stats")

    def get_hwid_top_users(self, **params: Any) -> Any:
        return self.get("/api/hwid/devices/top-users", params=params or None)

    def get_subscriptions(self, **params: Any) -> Any:
        return self.get("/api/subscriptions", params=params or None)

    def get_subscription_by_user_id(self, user_id: int) -> Any:
        return self.get(f"/api/subscriptions/by-id/{user_id}")

    def get_subscription_by_username(self, username: str) -> Any:
        return self.get(f"/api/subscriptions/by-username/{urllib.parse.quote(username, safe='')}")

    def get_subscription_by_short_uuid(self, short_uuid: str) -> Any:
        return self.get(f"/api/subscriptions/by-short-uuid/{urllib.parse.quote(short_uuid, safe='')}")

    def get_subscription_raw(self, short_uuid: str) -> Any:
        return self.get(f"/api/subscriptions/by-short-uuid/{urllib.parse.quote(short_uuid, safe='')}/raw")

    def get_connection_keys(self, user_id: int) -> Any:
        return self.get(f"/api/subscriptions/connection-keys/{user_id}")

    def get_subpage_config(self, short_uuid: str) -> Any:
        return self.get(f"/api/subscriptions/subpage-config/{urllib.parse.quote(short_uuid, safe='')}")

    def get_public_subscription(self, short_uuid: str) -> Any:
        return self.get(f"/api/sub/{urllib.parse.quote(short_uuid, safe='')}")

    def get_public_subscription_info(self, short_uuid: str) -> Any:
        return self.get(f"/api/sub/{urllib.parse.quote(short_uuid, safe='')}/info")

    def get_nodes(self) -> Any:
        return self.get("/api/nodes")

    def connections_by_node(self, node_uuid: str) -> Any:
        # проверяем кто к каким нодам подключен прямо сейчас
        return self.post(f"/api/connections/by-node/{node_uuid}")

    def connections_by_node_result(self, job_id: str) -> Any:
        return self.get(f"/api/connections/by-node/{job_id}")

    def get_node(self, uuid: str) -> Any:
        return self.get(f"/api/nodes/{uuid}")

    def create_node(self, body: dict[str, Any]) -> Any:
        return self.post("/api/nodes", json_body=body)

    def update_node(self, body: dict[str, Any]) -> Any:
        return self.patch("/api/nodes", json_body=body)

    def delete_node(self, uuid: str) -> Any:
        return self.delete(f"/api/nodes/{uuid}")

    def enable_node(self, uuid: str) -> Any:
        return self.post(f"/api/nodes/{uuid}/actions/enable")

    def disable_node(self, uuid: str) -> Any:
        return self.post(f"/api/nodes/{uuid}/actions/disable")

    def restart_node(self, uuid: str, body: Optional[dict[str, Any]] = None) -> Any:
        return self.post(f"/api/nodes/{uuid}/actions/restart", json_body=body or {})

    def restart_all_nodes(self) -> Any:
        return self.post("/api/nodes/actions/restart-all")

    def reset_node_traffic(self, uuid: str) -> Any:
        return self.post(f"/api/nodes/{uuid}/actions/reset-traffic")

    def get_hosts(self) -> Any:
        return self.get("/api/hosts")

    def get_host(self, uuid: str) -> Any:
        return self.get(f"/api/hosts/{uuid}")

    def create_host(self, body: dict[str, Any]) -> Any:
        return self.post("/api/hosts", json_body=body)

    def update_host(self, body: dict[str, Any]) -> Any:
        return self.patch("/api/hosts", json_body=body)

    def delete_host(self, uuid: str) -> Any:
        return self.delete(f"/api/hosts/{uuid}")

    def get_subscription_templates(self) -> Any:
        return self.get("/api/subscription-templates")

    def get_subscription_template(self, uuid: str) -> Any:
        return self.get(f"/api/subscription-templates/{urllib.parse.quote(uuid, safe='')}")

    def get_config_profiles(self) -> Any:
        return self.get("/api/config-profiles")

    def get_config_profile(self, uuid: str) -> Any:
        return self.get(f"/api/config-profiles/{uuid}")

    def get_config_profile_inbounds(self, uuid: str) -> Any:
        return self.get(f"/api/config-profiles/{uuid}/inbounds")

    def get_all_inbounds(self) -> Any:
        return self.get("/api/config-profiles/inbounds")

    def health(self) -> Any:
        return self.get("/api/system/health")

    def system_stats(self) -> Any:
        return self.get("/api/system/stats")

    def bandwidth_stats(self) -> Any:
        return self.get("/api/system/stats/bandwidth")

    def nodes_stats(self) -> Any:
        return self.get("/api/system/stats/nodes")

    def nodes_metrics(self) -> Any:
        return self.get("/api/system/nodes/metrics")

    def stats_recap(self) -> Any:
        return self.get("/api/system/stats/recap")

    def stats_digest(self) -> Any:
        return self.get("/api/system/stats/digest")

    def system_metadata(self) -> Any:
        return self.get("/api/system/metadata")

    def system_configuration(self) -> Any:
        return self.get("/api/system/configuration")

    def generate_x25519(self) -> Any:
        return self.get("/api/system/tools/x25519/generate")

    def get_user_bandwidth(self, user_id: int, **params: Any) -> Any:
        return self.get(f"/api/bandwidth-stats/users/{user_id}", params=params or None)

    def get_node_bandwidth(self, **params: Any) -> Any:
        return self.get("/api/bandwidth-stats/nodes", params=params or None)

    def get_internal_squad_bandwidth(self, uuid: str, **params: Any) -> Any:
        return self.get(f"/api/bandwidth-stats/internal-squads/{uuid}/usage", params=params or None)

    def get_user_metadata(self, user_id: int) -> Any:
        return self.get(f"/api/metadata/user/{user_id}")

    def upsert_user_metadata(self, user_id: int, body: dict[str, Any]) -> Any:
        self.assert_own_user(user_id)
        return self.put(f"/api/metadata/user/{user_id}", json_body=body)

    def get_node_metadata(self, uuid: str) -> Any:
        return self.get(f"/api/metadata/node/{uuid}")

    def upsert_node_metadata(self, uuid: str, body: dict[str, Any]) -> Any:
        return self.put(f"/api/metadata/node/{uuid}", json_body=body)

    def list_squads_simple(self) -> list[dict[str, str]]:
        # ищем сквады
        data = self.get_internal_squads()
        items = data
        if isinstance(data, dict):
            items = data.get("internalSquads") or data.get("squads") or data.get("items") or []
        result: list[dict[str, str]] = []
        for s in items or []:
            if not isinstance(s, dict):
                continue
            uuid = str(s.get("uuid") or s.get("squadUuid") or "")
            name = str(s.get("name") or s.get("squadName") or uuid)
            if uuid:
                result.append({"uuid": uuid, "name": name})
        return result

    def find_user_by_telegram(self, telegram_id: int) -> Optional[dict[str, Any]]:
        """только свои (batman_<id>) с этим telegramId; чужих не возвращаем."""
        found = self._find_user_by_telegram_any(telegram_id)
        return found if found and is_own_username(found.get("username")) else None

    def _find_user_by_telegram_any(self, telegram_id: int) -> Optional[dict[str, Any]]:
        tg = int(telegram_id)
        try:
            page = self.get("/api/users/stream", params={"telegramId": str(tg), "size": 250})
        except RemnawaveError:
            page = None
        users = page.get("users") if isinstance(page, dict) else page
        if isinstance(users, list):
            for u in users:
                if isinstance(u, dict) and str(u.get("telegramId") or u.get("telegram_id") or "") == str(tg):
                    return u
        start, size = 0, 100
        while True:
            page = self.get_users(start=start, size=size)
            users = page.get("users") if isinstance(page, dict) else page
            if not users:
                return None
            for u in users:
                if isinstance(u, dict) and str(u.get("telegramId") or u.get("telegram_id") or "") == str(tg):
                    return u
            start += size
            total = page.get("total") if isinstance(page, dict) else None
            if (total is not None and start >= int(total)) or len(users) < size:
                return None

    def ensure_user(
        self,
        *,
        telegram_id: int,
        username: Optional[str] = None,
        days: int = 30,
        traffic_limit_bytes: int = 0,
        hwid_device_limit: int = 1,
        squad_uuids: Optional[Iterable[str]] = None,
        email: Optional[str] = None,
        description: Optional[str] = None,
        status: str = "ACTIVE",
    ) -> dict[str, Any]:
        # обновляем данные пользователя
        squads = list(squad_uuids or [])
        uname = username or f"tg_{telegram_id}"
        # вычищаем из U
        uname = "".join(c if c.isalnum() or c in "_-" else "_" for c in uname)[:36] or f"tg_{telegram_id}"
        if not is_own_username(uname):
            raise RemnawaveForeignUserError(f"отказ: ensure_user только для batman_<id>, а не {uname!r}")

        existing = self.find_user_by_telegram(telegram_id)
        expire = _utcnow() + timedelta(days=max(1, days))

        if existing:
            uid = int(existing.get("id") or existing.get("userId"))
            patch: dict[str, Any] = {
                "id": uid,
                "status": status,
                "expire_at": expire,
                "hwid_device_limit": hwid_device_limit,
            }
            if traffic_limit_bytes:
                patch["traffic_limit_bytes"] = traffic_limit_bytes
            if squads:
                patch["active_internal_squads"] = squads
            if email is not None:
                patch["email"] = email
            if description is not None:
                patch["description"] = description
            return self.update_user(**patch)

        return self.create_user(
            username=uname,
            expire_at=expire,
            status=status,
            telegram_id=telegram_id,
            email=email,
            description=description,
            traffic_limit_bytes=traffic_limit_bytes or None,
            hwid_device_limit=hwid_device_limit,
            active_internal_squads=squads or None,
        )

    def subscription_url_for(self, user: dict[str, Any], public_base: Optional[str] = None) -> Optional[str]:
        short = user.get("shortUuid") or user.get("short_uuid")
        if not short:
            return None
        try:
            import subdomain  # type: ignore  # домен ссылки из .env (VPN_SUB_DOMAIN)
        except Exception:  # noqa: BLE001
            subdomain = None  # type: ignore
        # иногда панель уже отдаёт готовый URL
        for key in ("subscriptionUrl", "subscription_url", "happUrl", "happ_url"):
            if user.get(key):
                url = str(user[key])
                return subdomain.vpn(url) if subdomain else url
        base = (public_base or self.base_url).rstrip("/")
        url = f"{base}/api/sub/{short}"
        return subdomain.vpn(url) if subdomain else url

    def ping(self) -> bool:
        try:
            self.health()
            return True
        except RemnawaveError:
            return False


_default: Optional[RemnawaveAPI] = None


def get_client() -> RemnawaveAPI:
    global _default
    if _default is None:
        _default = RemnawaveAPI()
    return _default


def reset_client() -> None:
    global _default
    _default = None


Remnawave = RemnawaveAPI