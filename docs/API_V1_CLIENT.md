# BlinVPN API — документация для разработчика

## 1. Куда слать запросы

Адрес API зависит от того, как настроен сервер. Узнайте у владельца сервиса, какой из двух вариантов у вас.

| Вариант | Адрес API | Пример запроса |
|---|---|---|
| **A. Домен мини-приложения** (работает всегда) | `https://<домен мини-приложения>/api/v1` | `GET https://app.example.com/api/v1/subscription` |
| **B. Отдельный домен API** (если настроен) | `https://<домен API>` | `GET https://api.example.com/subscription` |

- **Домен мини-приложения** — тот, на котором открывается мини-приложение в Telegram. В `.env` сервера он записан как `MINIAPP_DOMAIN`.
- **Домен API** — в `.env` это `API_DOMAIN`. В варианте B пути совпадают с ТЗ один в один, префикс не нужен.

Дальше в примерах используется `BASE`, например `BASE = https://app.example.com/api/v1`.

Все запросы и ответы в JSON. Даты приходят в UTC (`2030-01-01T00:00:00Z`), суммы в рублях.

## 2. Авторизация за 3 шага

**Шаг 1. Войти и получить токены.** В мини-приложении Telegram для этого используется `initData`:

```http
POST {BASE}/auth/token
Content-Type: application/json

{"init_data": "<Telegram.WebApp.initData>"}
```

```json
{
  "access_token": "bv1.eyJ1Ijo...",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "Xk2pQ...",
  "refresh_expires_in": 2592000
}
```

Если пользователь вошёл по email, вместо `init_data` передаётся `{"session_token": "..."}` (токен из `/api/app/auth/email/verify`).

**Шаг 2. Слать запросы с заголовком:**

```http
Authorization: Bearer bv1.eyJ1Ijo...
```

**Шаг 3. Обновлять токен.** `access_token` живёт 15 минут. Когда он истёк, сервер отвечает `401` с `"code": "token_expired"`. Тогда:

```http
POST {BASE}/auth/refresh
Content-Type: application/json

{"refresh_token": "Xk2pQ..."}
```

Ответ — новая пара токенов, в том же формате, что на шаге 1. **Сохраните обе.** Старый `refresh_token` больше не работает, а повторная попытка его использовать завершит сессию (её примут за кражу).

> Обновляйте токен из одного места в приложении. Если два параллельных запроса одновременно вызовут refresh, сессия завершится.

**Выход:** `POST {BASE}/auth/logout` с заголовком `Authorization`. Чтобы выйти на всех устройствах, добавьте `?all_sessions=true`.

## 3. Список методов

| Метод | Путь | Токен | Что делает |
|---|---|---|---|
| POST | `/auth/token` | — | вход, получить токены |
| POST | `/auth/refresh` | — | обновить токены |
| POST | `/auth/logout` | да | выход |
| GET | `/subscription` | да | статус подписки и ссылка |
| POST | `/subscription/resync` | да | «ссылка не работает» — перевыпустить из панели |
| GET | `/tariffs` | — | тарифы |
| GET | `/referrals/me` | да | реферальная статистика |
| POST | `/referrals/withdrawals` | да | заявка на вывод |
| GET | `/tasks` | да | задания |
| POST | `/tasks/{id}/claim` | да | забрать награду |
| POST | `/telemetry/sessions` | да | отметка «VPN подключён» |

## 4. Методы

### GET /subscription

```json
{
  "state": "active",
  "expires_at": "2030-01-01T00:00:00Z",
  "subscription_url": "https://sub.example.com/hIeb",
  "retry_after_seconds": null
}
```

| `state` | Что показать |
|---|---|
| `active` | подписка работает, `subscription_url` — ссылка для импорта в приложение |
| `expired` | срок истёк, предложить продление |
| `provisioning` | ссылка выдаётся; ссылки пока нет (`null`), повторить запрос через `retry_after_seconds` секунд |
| `disabled` | подписка заблокирована |

Если у пользователя нет подписки, сервер отвечает `404`.

### POST /subscription/resync

Тело не нужно. Сервер отвечает `202` и возвращает тот же объект, что `GET /subscription`, обычно со `state: "provisioning"`. Дальше опрашивайте `GET /subscription` каждые `retry_after_seconds` секунд, пока не придёт `active` с новой ссылкой.

Ошибки: `409` — подписка истекла, `403` — заблокирована.

### GET /tariffs

Токен не нужен.

```json
[
  {"code": "m1", "title": "1 месяц", "price": 180, "currency": "RUB", "period_days": 30},
  {"code": "m3", "title": "3 месяца", "price": 470, "currency": "RUB", "period_days": 90}
]
```

### GET /referrals/me

```json
{
  "invite_link": "https://t.me/blinvpn_bot?start=ref_123",
  "stats": {"invited": 5, "earned_total": 500, "available_to_withdraw": 100}
}
```

### POST /referrals/withdrawals

```json
{"amount": 100, "method": "crypto", "address": "UQAbc..."}
```

- `amount` — сумма в рублях, минимум 100.
- `method` — `crypto` (USDT в сети TON).
- `address` — адрес кошелька TON. Если не передать, подставится адрес из прошлой заявки пользователя.

Ответ `201`:

```json
{"id": 42, "status": "pending"}
```

Ошибки `400`: недостаточно средств, сумма меньше 100, неверный или не указан адрес.

### GET /tasks

```json
[
  {"id": 1, "title": "Подпишись на канал", "reward_days": 3, "status": "active",
   "progress": 0, "target": 1, "url": "https://t.me/BATMANNETWORK"},
  {"id": 2, "title": "Проведи 15 минут в VPN", "reward_days": 1, "status": "completed",
   "progress": 15, "target": 15, "url": null}
]
```

| `status` | Что показать |
|---|---|
| `active` | задание не выполнено; полоса прогресса `progress / target`, кнопка ведёт на `url` |
| `completed` | выполнено — кнопка «Забрать награду» |
| `claimed` | награда уже получена |

### POST /tasks/{id}/claim

Тело не нужно. Сервер добавляет `reward_days` к подписке и возвращает объект подписки, как `GET /subscription`.

Ошибки `409`: задание ещё не выполнено или награда уже получена.

### POST /telemetry/sessions

Нужно для заданий вида «проведи 15 минут в VPN».

```json
{"session_id": "c0a8012e-...", "node_name": "DE-Frankfurt"}
```

Ответ: `{"ok": true}`.

Когда отправлять:
- при подключении VPN — с новым `session_id` (UUID);
- пока VPN подключён — каждые 1–5 минут с тем же `session_id`;
- при отключении — ещё раз с тем же `session_id`.

Засчитывается время между отметками. Если между двумя отметками прошло больше часа, этот промежуток не засчитывается.

## 5. Ошибки

Все ошибки приходят в одном формате:

```json
{"detail": {"message": "Подписки нет", "code": "no_subscription"}, "error": "Подписки нет"}
```

`message` можно показать пользователю, а по `code` клиент выбирает, что делать.

| HTTP | Что делать |
|---|---|
| 401 `token_expired` | вызвать `/auth/refresh` и повторить запрос |
| 401 (любой другой code) | войти заново через `/auth/token` |
| 403 `channel_required` | предложить подписаться на канал, ссылка в `detail.channel_url` |
| 403 `account_banned` | аккаунт заблокирован |
| 429 | слишком часто, подождать `detail.retry_after_seconds` секунд |
| 4xx | показать `message` |
| 5xx | повторить позже |

## 6. Готовый клиент (JavaScript)

```js
const BASE = "https://app.example.com/api/v1"; // ← ваш адрес из раздела 1

let tokens = null;
let refreshing = null;

async function login() {
  tokens = await call("/auth/token", "POST", { init_data: Telegram.WebApp.initData }, false);
}

async function refresh() {
  // все запросы, которым нужен refresh, ждут одно и то же обновление
  refreshing ??= call("/auth/refresh", "POST", { refresh_token: tokens.refresh_token }, false)
    .then((t) => (tokens = t))
    .catch(login)
    .finally(() => (refreshing = null));
  return refreshing;
}

async function call(path, method = "GET", body, auth = true, retried = false) {
  if (auth && !tokens) await login();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${tokens.access_token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (res.status === 401 && auth && !retried) {
    data?.detail?.code === "token_expired" ? await refresh() : await login();
    return call(path, method, body, auth, true);
  }
  if (!res.ok) throw data;
  return data;
}

// ждать, пока ссылка выдастся (после resync или claim)
async function waitReady(sub) {
  while (sub.state === "provisioning") {
    await new Promise((r) => setTimeout(r, sub.retry_after_seconds * 1000));
    sub = await call("/subscription");
  }
  return sub;
}

// примеры
const sub     = await call("/subscription");
const tariffs = await call("/tariffs", "GET", null, false);
const ref     = await call("/referrals/me");
const fixed   = await waitReady(await call("/subscription/resync", "POST"));
const tasks   = await call("/tasks");
const reward  = await waitReady(await call(`/tasks/${tasks[0].id}/claim`, "POST"));
await call("/referrals/withdrawals", "POST", { amount: 100, method: "crypto", address: "UQ..." });
```

---

## Для владельца сервера: настройка

1. Обновите сервер: `install.sh` → **1**. Таблицы и секрет `API_TOKEN_SECRET` создадутся сами.
2. **Отдельный домен API (вариант B), по желанию:**
   - создайте A-запись, например `api.example.com`, на IP сервера бота;
   - впишите в `.env` строку `API_DOMAIN=api.example.com`;
   - запустите `install.sh` → **1**. Сертификат Caddy выпустит сам.
3. **ЮKassa:** в кабинете → Интеграция → HTTP-уведомления укажите `https://<домен мини-приложения>/webhooks/payments/yookassa`. Если настроен домен API, можно `https://api.example.com/webhooks/payments/yookassa`. Старый адрес `/yookassa` продолжает работать.
4. **Проверка:** `curl https://<домен>/api/v1/tariffs` (в варианте B — `curl https://api.example.com/tariffs`) должен вернуть список тарифов.
5. **CORS:** если клиент работает в браузере на другом домене, добавьте этот домен в `CORS_ORIGINS` в `.env`.

Задания и прочие внутренние детали описаны в `docs/API_V1.md`.
