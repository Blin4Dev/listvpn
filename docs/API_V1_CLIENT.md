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

**Вход по почте** (мобильное приложение, вместо Telegram):

```http
POST {BASE}/auth/email/send
{"email": "user@mail.ru"}
→ {"ok": true, "resend_after": 60, "code_ttl": 600}

POST {BASE}/auth/email/verify
{"email": "user@mail.ru", "code": "123456", "ref": "123"}      // ref — реф. код, только для нового аккаунта, необязательно
→ {"session_token": "lt_...", "expires_in": 600, "is_new_user": true}
```

Полученный `session_token` сразу отправьте в `POST {BASE}/auth/token` вместо `init_data`: `{"session_token": "lt_..."}` — в ответ та же пара токенов. Билет одноразовый и живёт 10 минут.

Ошибки: `400 bad_email`, `401 code_invalid` (неверный/истёкший код), `403 account_banned`, `429 rate_limited` (подождать `retry_after_seconds`). Если в панели включена капча, а запрос идёт без ключа приложения, нужен `captcha_token`.

**Заголовки приложения.** Мобильное приложение шлёт в каждом запросе:

| Заголовок | Что | Когда нужен |
|---|---|---|
| `X-App-Key` | ключ приложения из панели (Настройки → «Приложение (API)») | если в панели включено «Требовать ключ»; с ключом не нужна капча |
| `X-HWID` | постоянный id устройства, 8–128 символов `[A-Za-z0-9._:-]` | для получения `config` в `/subscription` |
| `X-Device-OS`, `X-Device-OS-Version`, `X-Device-Model` | `iOS`, `17.5`, `iPhone 15` | необязательно — имя устройства в списке |
| `X-Project` | id проекта | только на общем домене API (адрес показан в панели) |

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
| POST | `/auth/email/send` | — | код на почту |
| POST | `/auth/email/verify` | — | проверить код → `session_token` |
| POST | `/auth/token` | — | вход, получить токены |
| POST | `/auth/refresh` | — | обновить токены |
| POST | `/auth/logout` | да | выход |
| GET | `/users/me` | да | профиль |
| POST | `/users/me/terms` | да | принять оферту (без этого оплата недоступна) |
| GET | `/subscription` | да | статус подписки, `config`, трафик, статистика сетей |
| POST | `/subscription/resync` | да | «ссылка не работает» — перевыпустить из панели |
| GET | `/tariffs` | — | тарифы |
| POST | `/purchases/yookassa/create` | да | оплата тарифа → ссылка на ЮKassa |
| POST | `/purchases/hwid-slot/create` | да | докупить слоты устройств |
| GET | `/purchases/{id}/status` | да | статус оплаты (поллинг) |
| GET | `/family` | да | семья: устройства, гости, лимит |
| POST | `/family/invite` | да | код/ссылка приглашения |
| POST | `/family/join` | да | войти в семью по коду |
| DELETE | `/family/members/{user_id}` | да | владелец удаляет гостя |
| DELETE | `/family/members/me` (= `POST /family/leave`) | да | гость выходит сам |
| DELETE | `/family/devices/{device_id}` | да | отвязать устройство |
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
  "status": "active",
  "expires_at": "2030-01-01T00:00:00Z",
  "subscription_url": "https://sub.example.com/hIeb",
  "retry_after_seconds": null,
  "config": "vless://...#NL\nvless://...#DE",
  "config_error": null,
  "traffic": {"used_bytes": 134217728000, "limit_bytes": 536870912000, "whitelist_active": true},
  "network_stats": {"lte_days": 12, "wifi_days": 17, "period_days": 30}
}
```

- `status` — то же, что `state`.
- `config` — ключи подключения открытым текстом, по строке на сервер (шифрования больше нет, поля `encrypted_config` нет). Приходит только при `active` и только с заголовком `X-HWID`: устройство при этом регистрируется в подписке (занимает слот). При `provisioning`, `expired`, `disabled` — `null`.
- `config_error` — почему `config` нет при `active`: `hwid_required` (не передан `X-HWID`), `hwid_limit_reached` (все слоты заняты — отвязать устройство или докупить слот), `unavailable` (панель не ответила — повторить позже).
- `traffic.limit_bytes` — `0`, если трафик не ограничен; `used_bytes`/`limit_bytes` — `null`, если узнать не удалось.
- `network_stats` — сколько дней из последних 30 VPN был включён через мобильную сеть / Wi-Fi (по телеметрии с полем `network`).
- Гость семьи получает подписку владельца.

| `state` | Что показать |
|---|---|
| `active` | подписка работает, `subscription_url` — ссылка для импорта в приложение |
| `expired` | срок истёк, предложить продление |
| `provisioning` | ссылка выдаётся; ссылки пока нет (`null`), повторить запрос через `retry_after_seconds` секунд |
| `disabled` | подписка заблокирована |

Если у пользователя нет подписки, сервер отвечает `404`.

### POST /subscription/resync

Тело не нужно. Сервер отвечает `202` и возвращает тот же объект, что `GET /subscription`, обычно со `state: "provisioning"`. Дальше опрашивайте `GET /subscription` каждые `retry_after_seconds` секунд, пока не придёт `active` с новой ссылкой.

Ошибки: `409` — подписка истекла, `403` — заблокирована, `403 family_member` — гость семьи (перевыпускает владелец).

### GET /users/me

```json
{
  "id": 123, "telegram_id": 555000111, "telegram_username": "ivan", "email": "ivan@mail.ru",
  "registered_at": "2026-01-01T10:00:00Z", "terms_accepted": true, "is_banned": false,
  "family_role": "owner", "project": {"id": "fgn", "name": "FGN"}
}
```

`family_role`: `owner` | `member` | `none`. `POST /users/me/terms` — принять оферту и политику, ответ тот же.

### POST /purchases/yookassa/create

```json
{"tariff_code": "m1", "extra_devices": 0, "use_referral_balance": false}
```

Ответ `201`:

```json
{"purchase_id": "a1b2c3", "payment_url": "https://yoomoney.ru/checkout/...", "status": "pending",
 "amount": 180, "full_price": 180, "referral_applied": 0, "currency": "RUB"}
```

Откройте `payment_url` во внешнем браузере. После оплаты ЮKassa вернёт на адрес из панели (например `fgn://payment?id=...`). Если всё оплачено реферальным балансом — `status: "succeeded"`, `payment_url: null`.

Ошибки: `403 terms_not_accepted` (сначала `POST /users/me/terms`), `404 tariff_not_found`, `503 payments_unavailable`.

### POST /purchases/hwid-slot/create

```json
{"count": 1, "months": 1}
```

Докупка слотов устройств к своей платной подписке; `months` — 1, 3, 6 или 12. Ответ как у `/purchases/yookassa/create`. После оплаты растёт `hwid_limit`. Ошибки: `403 family_member` (докупает владелец), `409 no_subscription`, `422 bad_months`.

### GET /purchases/{id}/status

```json
{"purchase_id": "a1b2c3", "status": "pending", "purpose": "subscription", "amount": 180, "currency": "RUB",
 "payment_url": "https://yoomoney.ru/...", "paid_at": null, "expires_at": null}
```

`status`: `pending` | `succeeded` | `failed` | `canceled`. Опрашивайте раз в 3–5 секунд, пока `pending`. При `succeeded` в `expires_at` — новый срок подписки. Подписку продлевает вебхук ЮKassa; поллинг лишь показывает результат (и заодно перепроверяет платёж в ЮKassa).

### GET /family

```json
{
  "role": "owner", "is_owner": true,
  "owner": {"user_id": 123, "display_name": "@ivan"},
  "used_hwids": 3, "hwid_limit": 5, "devices_available": true,
  "devices": [{"id": "hwid-...", "name": "iPhone 15 · 17.5", "platform": "iOS",
               "last_seen_at": "2026-10-30T10:00:00Z", "user_id": 123, "is_mine": true, "can_delete": true}],
  "members": [{"user_id": 456, "display_name": "@petr", "used_hwids": 1, "joined_at": "2026-10-01T12:00:00Z"}],
  "max_members": 5, "can_invite": true,
  "invite": {"code": "AB12CD", "link": "https://.../family?code=AB12CD"}
}
```

Лимит общий: устройства владельца и всех гостей вместе (`used_hwids / hwid_limit`). `devices[].id` — это HWID, его передают в `DELETE /family/devices/{id}`. `devices_available: false` — список устройств сейчас не получить.

### POST /family/invite

Тело необязательно: `{"rotate": true}` — выдать новый код (старый перестанет работать). Ответ: `{"code": "AB12CD", "invite_link": "..."}`. Только владелец с платной подпиской.

### POST /family/join

`{"code": "AB12CD"}` → объект как у `GET /family`.

Ошибки: `409 already_in_family` (свой код или уже в этой семье), `409 in_other_family`, `409 has_own_family`, `409 has_own_subscription`, `404 code_not_found`, `400 family_full | owner_no_subscription`.

### DELETE /family/members/{user_id}, DELETE /family/members/me, POST /family/leave

Владелец удаляет гостя — ответ как у `GET /family`. Гость выходит сам (`/members/me` или `/leave`) — `{"ok": true}`, `409 not_in_family`, если не в семье.

Когда гость уходит, ключ владельца перевыпускается и **все** устройства подписки отвязываются (иначе у ушедшего остался бы рабочий ключ) — приложения получат новый `config` при следующем `GET /subscription`.

### DELETE /family/devices/{device_id}

Отвязать устройство и освободить слот. Владелец — любое, гость — только своё (`403 not_your_device`). Ответ как у `GET /family`. `404 device_not_found`, `503 devices_unavailable`.

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
{"session_id": "c0a8012e-...", "node_name": "DE-Frankfurt", "network": "wifi"}
```

`network` — необязательно: `wifi` или `lte` (`cellular`, `4g`, `5g` тоже понимаются как `lte`). Из него считается `network_stats`.

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
| 401 `app_key_invalid` | ключ приложения отозван/неверный — обновить приложение |
| 401 (любой другой code) | войти заново через `/auth/token` |
| 503 `api_disabled` | API приложения выключено в панели |
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
