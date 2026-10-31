# API v1 — внутреннее устройство

> Документация для разработчика клиента — [API_V1_CLIENT.md](API_V1_CLIENT.md).
> Здесь — как это устроено на сервере.

Клиентский API поверх существующего бэкенда. Эндпоинты — с префиксом **`/api/v1`** на домене мини-приложения
(Caddy проксирует на сервис `api` только `/api*`) или без префикса на отдельном домене `API_DOMAIN`
(Caddy делает `rewrite * /api/v1{uri}`).

Код: `src/core/apiv1.py` (роуты), `src/core/apiv1_store.py` (БД, очередь, леджер, задания),
`src/core/apiv1_app.py` (мобильное приложение: ключи, вход по почте, устройства, config, статистика сетей).
Схема — в `src/core/database.py` (таблицы создаются и мигрируют сами при старте).

## Авторизация: токены API v1

Все эндпоинты v1, кроме `/tariffs`, `/auth/token` и `/auth/refresh`, принимают **только**
`Authorization: Bearer <access_token>`. Сырые initData и app-сессии напрямую не принимаются:
их сначала обменивают на токен. Код — `src/core/apiv1_auth.py`.

| токен | вид | срок | хранение |
|---|---|---|---|
| access | `bv1.<payload>.<подпись>`, HMAC-SHA256 | 15 мин | не хранится; на каждый запрос проверяются подпись, срок и что сессия не отозвана |
| refresh | 64 случайных символа | 30 дней скользящих, не больше 90 дней с входа | в `api_sessions` только sha-256 |

Ключ подписи — `API_TOKEN_SECRET` в `.env` (install.sh генерирует сам, минимум 32 символа).
Если переменной нет, секрет один раз генерируется и хранится в БД. Смена секрета = выход всех клиентов v1.

### `POST /api/v1/auth/token`

```json
{"init_data": "<Telegram.WebApp.initData>"}      // мини-приложение (или заголовок X-Telegram-Init-Data)
{"session_token": "<токен app-сессии>"}          // вход по email / OAuth через /api/app/auth/*
→ {"access_token": "bv1....", "token_type": "Bearer", "expires_in": 900,
   "refresh_token": "...", "refresh_expires_in": 2592000}
```

- initData проверяется подписью бота и должен быть **не старше 1 часа** (для мини-приложения
  `TELEGRAM_INITDATA_MAX_AGE` — сутки, для выдачи токена этого слишком много)
- лимит — 20 запросов в минуту с одного IP; у пользователя не больше 10 живых сессий (старые отзываются)

### `POST /api/v1/auth/refresh`

`{"refresh_token": "..."}` → новая пара, старый refresh перестаёт действовать (ротация).
Если старый refresh предъявят **повторно** (его украли или клиент сохранил не тот), вся сессия
отзывается: и вор, и владелец получают `401 refresh_reused`, владелец входит заново.
Поэтому клиент должен делать refresh в одном месте и сразу сохранять новый токен.

### `POST /api/v1/auth/logout`

Отзывает текущую сессию (access сразу перестаёт работать). `?all_sessions=true` — все сессии пользователя.

### Коды 401

`token_missing`, `token_invalid`, `token_expired` (обновить через refresh), `session_revoked`,
`refresh_invalid`, `refresh_reused`, `init_data_expired`. В ответе есть заголовок `WWW-Authenticate: Bearer`.
Заблокированный пользователь получает токен, видит `GET /subscription` со `state: "disabled"`,
остальное — `403 account_banned`.

Ошибки — в общем формате бэкенда:

```json
{"detail": {"message": "Подписки нет", "code": "no_subscription"}, "error": "Подписки нет"}
```

`429` дополнительно содержит `detail.retry_after_seconds`.

## 1. Подписка

### `GET /api/v1/subscription`

```json
{"state": "active", "expires_at": "2030-01-01T00:00:00Z",
 "subscription_url": "https://.../shortUuid", "retry_after_seconds": null}
```

| state | когда | subscription_url | retry_after_seconds |
|---|---|---|---|
| `provisioning` | есть задача в `provisioning_jobs` (resync, ретрай после оплаты, награда) | `null` | ≥ 3 — через сколько опросить снова |
| `active` | подписка `Active`, срок не истёк | ссылка | `null` |
| `expired` | срок истёк | ссылка (страница «продлите») | `null` |
| `disabled` | аккаунт или подписка заблокированы | `null` | `null` |

Если подписок нет — `404 no_subscription`. Ссылка читается из БД (без запроса к панели);
домен подменяется по `VPN_SUB_DOMAIN`, как и у остальных ссылок.

### `POST /api/v1/subscription/resync` → `202 Accepted`

Ставит задачу воркеру: записать в Remnawave срок, устройства, сквады и трафик из БД
(если пользователя в панели нет — создать) и сохранить свежую ссылку.
Старая ссылка **не отзывается** (для отзыва есть `/api/app/subscription/reissue`).
Тело ответа — как у `GET /subscription`, обычно `state: "provisioning"`.

- `403 subscription_disabled`, `409 subscription_expired` (продлевать надо оплатой), `404 no_subscription`
- не чаще 5 раз за 10 минут; повторный вызов, пока задача в очереди, просто возвращает состояние

**Воркер** (поток в сервисе `api`): одна активная задача на пользователя, 6 попыток
с паузами 5 / 15 / 30 / 60 / 120 с, зависшие `running` возвращаются в очередь через 5 мин.
После последней неудачи — `failed`, `subscriptions.sync_state = 'failed'`, сообщение в форум ошибок,
клиент снова видит `active` со старой ссылкой.

> В `subscriptions.status` значение `provisioning` не пишется: на `status = 'Active'` завязаны
> бот, напоминания, анти-абуз и панель. Признак хранится в `subscriptions.sync_state`
> и в `provisioning_jobs`.

## 2. Тарифы и платежи

### `GET /api/v1/tariffs`

```json
[{"code": "m1", "title": "1 месяц", "price": 180, "currency": "RUB", "period_days": 30}, ...]
```

Таблица `tariffs` (`m1`, `m3`, `m6`, `m12`). Цены синхронизируются с ценами периодов из панели
(«Цены»): при старте и при сохранении. `title`, `is_active` и `sort_order` можно править в БД —
синхронизация их не трогает.

### `POST /webhooks/payments/yookassa` → `200 OK`

Без префикса `/api/v1`: обслуживается сервисом `webhook`, Caddy проксирует `/webhooks/payments/*`
(на домене мини-приложения и на домене вебхуков). Логика та же, что у старого `/yookassa`
(он продолжает работать):

1. телу уведомления не доверяем — статус и сумма перепроверяются запросом в API ЮKassa;
2. `fulfillment.fulfill_payment` продлевает подписку в `subscriptions` и выдаёт ключ в Remnawave;
3. покупка пишется в `purchases` (для любого провайдера, в т.ч. Stars);
4. если Remnawave не ответил — задача в `provisioning_jobs`, воркер довыдаст ключ.

`503` — не удалось перепроверить платёж (ЮKassa повторит уведомление).
У ЮKassa нет подписи уведомлений, поэтому защита — перепроверка через API: поддельное уведомление
ничего не выдаст. Дополнительно можно включить `YOOKASSA_CHECK_IP=1` (принимать только с IP ЮKassa),
если перед сервером нет Cloudflare-прокси. Адрес для кабинета ЮKassa:
`https://<домен>/webhooks/payments/yookassa`.

## 3. Реферальная система

### `GET /api/v1/referrals/me`

```json
{"invite_link": "https://t.me/<бот>?start=ref_<id>",
 "stats": {"invited": 5, "earned_total": 500, "available_to_withdraw": 100}}
```

`earned_total` — все реферальные начисления минус отмены (то же число, что в мини-приложении),
`available_to_withdraw` — баланс по `referral_ledger`.

### `POST /api/v1/referrals/withdrawals` → `201 Created`

```json
{"amount": 100, "method": "crypto", "address": "UQ..."}
→ {"id": 42, "status": "pending"}
```

- `method`: `crypto` (= USDT TON, в `withdrawals.method` пишется `usdt_ton`, как у текущих заявок)
- `address` — **дополнительное поле**: без адреса заявку не выплатить. Если не передан, берётся адрес
  из прошлой заявки; если прошлых нет — `400 address_required`
- минимум — `services.MIN_WITHDRAW_RUB` (100 ₽); баланс проверяется по леджеру, списание, заявка
  и строка леджера пишутся одной транзакцией. Заявка уходит в форум «выводы», как обычно
- ошибки: `400 insufficient_funds | amount_too_small | bad_address | address_required`, `422 bad_method`

**Леджер** (`referral_ledger`, `SUM(amount) = users.partner_balance`). Строки:
`accrual` (бонус с оплаты реферала), `withdrawal`, `withdrawal_refund` (отклонение с возвратом),
`opening_balance` (остаток при первом запуске), `adjustment`. Баланс меняют и старые места (ручная
правка в панели, отмена бонуса при возврате платежа, оплата реф. балансом) — такие расхождения при
чтении фиксируются строкой `adjustment`, поэтому леджер всегда сходится с балансом.
При первом запуске история заполняется из `transactions` и `withdrawals`.

## 4. Задания и телеметрия

### `GET /api/v1/tasks`

```json
[{"id": 1, "title": "Подпишись на канал", "reward_days": 3, "status": "active",
  "progress": 0, "target": 1, "url": "https://t.me/..."}]
```

`status`: `active` → `completed` (условие выполнено) → `claimed` (награда получена).
`progress` / `target` / `url` — дополнительные поля для отрисовки прогресса и кнопки.

Задания хранятся в `tasks`, прогресс — в `user_tasks`. Типы (`tasks.kind`):

| kind | условие | target |
|---|---|---|
| `channel` | подписка на канал (`getChatMember`, не чаще раза в минуту; если проверить не удалось — не засчитывается) | — |
| `vpn_minutes` | непрерывное время по телеметрии | минуты |
| `referrals` | приглашено друзей | количество |
| `manual` | админ ставит `user_tasks.status = 'completed'` | — |

При первом запуске создаются «Подпишись на канал» (`REQUIRED_CHANNEL_ID`, +3 дня) и
«Проведи 15 минут в VPN» (+1 день). Новые задания — `INSERT` в `tasks`.

### `POST /api/v1/tasks/{id}/claim`

Атомарно помечает задание `claimed` и добавляет `reward_days` к сроку подписки (от текущего срока,
или от «сейчас», если истекла; grace завершается), затем ставит задачу на запись срока в Remnawave.
Ответ — объект подписки как у `GET /subscription` (обычно `state: "provisioning"`).
Если подписки не было — создаётся новая на `reward_days` и выдаётся сразу.

- `409 not_completed | already_claimed | not_connected`, `403 subscription_disabled | no_renew`, `404 task_not_found`
- для `vpn_minutes` дополнительно проверяется в Remnawave, что пользователь вообще подключался
  (телеметрию шлёт клиент, подделать её проще)

### `POST /api/v1/telemetry/sessions` → `200 OK`

```json
{"session_id": "uuid-123", "node_name": "DE-Frankfurt"}  →  {"ok": true}
```

Клиент шлёт отметку при подключении (новый `session_id`), затем раз в 1–5 мин и при отключении
(тот же `session_id`). Первая отметка создаёт строку в `vpn_sessions`, следующие продлевают её.
Засчитывается промежуток от предыдущей отметки пользователя (по любой его сессии), если он не больше
часа: параллельные сессии время не умножают, после долгого разрыва отсчёт начинается заново.
`session_id` — до 64 символов `[A-Za-z0-9._:-]`; лимит — 30 запросов в минуту.

## 5. Мобильное приложение (`src/core/apiv1_app.py`)

Клиентские форматы — в [API_V1_CLIENT.md](API_V1_CLIENT.md). Здесь — что под капотом.

**Панель → Настройки → «Приложение (API)»** (на проект, ключи `app_*` в `PROJECT_SETTING_KEYS`):
вкл/выкл API (`503 api_disabled`), «Требовать ключ» (`X-App-Key`, иначе `401 app_key_invalid`),
адрес возврата после оплаты (`{payment_id}`; https или deep link, `javascript:`/`http:` нельзя),
шаблон ссылки-приглашения в семью (`{code}`), флаг `whitelist_active`. Ключи `fak_…` — в `app_keys`
только sha-256, показываются один раз; отзыв ключа может сразу завершить выданные с ним сессии
(`api_sessions.app_key_id`). Проверка — зависимость `gate` у всего роутера v1.

**Вход по почте:** `/auth/email/send` и `/auth/email/verify` используют те же коды и лимиты, что мини-приложение
(`create_email_code`, `_email_send_limits`, `_email_verify_limits`). Verify выдаёт одноразовый билет `lt_…`
(`app_login_tickets`, 10 минут, только хеш), который `/auth/token` принимает как `session_token`.
Старые app-сессии (`/api/app/auth/*`) тоже принимаются. С ключом приложения капча не спрашивается.

**config:** при `state = active` и заголовке `X-HWID` сервер сам регистрирует устройство в Remnawave
(`POST /api/hwid/devices`), проверяя общий лимит подписки (`hwidDeviceLimit`, иначе `devices_limit` из БД),
и отдаёт `links` из `GET /api/sub/{shortUuid}/info` строками через `\n` (кеш 2 мин). E2EE и `encrypted_config` убраны.
В `app_devices` пишется, чей HWID (владелец или гость) — для `members[].used_hwids` и права гостя
удалять только своё устройство.

**traffic / network_stats:** трафик — из пользователя Remnawave (`_rw_traffic`), `network_stats` — `vpn_network_days`
(день × тип сети из `POST /telemetry/sessions` с полем `network`), за 30 дней.

**Семья:** поверх `family.py` (те же коды, лимит участников, перевыпуск ключа владельца при уходе гостя —
`_family_revoke_owner_key`, после него `app_devices` владельца очищается). `FamilyError` получил машинный `code`
и статусы `409` (`already_in_family`, `in_other_family`, `has_own_family`, `has_own_subscription`).

**Оплата:** `/purchases/yookassa/create` и `/purchases/hwid-slot/create` идут через `app_payment_create`
(`purpose = subscription | devices`), то есть цены, реф. баланс и `fulfill_payment` — общие с мини-приложением.
Выдача после оплаты идемпотентна: `pending → processing` забирает один обработчик, повторные уведомления
ничего не начисляют; Remnawave недоступен — задача в `provisioning_jobs`.

## Таблицы

| таблица | назначение |
|---|---|
| `app_keys` | ключи приложения (sha-256), на проект |
| `app_login_tickets` | одноразовые билеты входа по почте |
| `app_devices` | чей HWID в подписке (владелец / гость) |
| `vpn_network_days` | дни с VPN по типу сети (`network_stats`) |
| `provisioning_jobs` | очередь выдачи / пересинхронизации ссылки |
| `tariffs` | тарифы для `GET /tariffs` |
| `purchases` | факт покупки, одна строка на оплаченный платёж (при первом запуске заполняется из `payments`) |
| `referral_ledger` | движения реферального баланса |
| `tasks`, `user_tasks` | задания и прогресс |
| `vpn_sessions` | телеметрия сессий |
| `api_sessions` | сессии токенов API v1 (refresh — только хеш) |
| `subscriptions.sync_state` | новая колонка: `NULL` / `provisioning` / `failed` |
