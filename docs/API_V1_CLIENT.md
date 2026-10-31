# API v1 — документация для разработчика приложения

API для мобильного (и любого другого) клиента проекта сети listvpn: FGN, BatmanVPN и т. д.
Один и тот же API у всех проектов; проект определяется по домену, на который идёт запрос.

Все запросы и ответы — JSON (`Content-Type: application/json`). Даты — UTC в формате `2030-01-01T00:00:00Z`.
Суммы — в рублях (число, может быть дробным). Трафик — в байтах.

---

## 1. Адрес API

| Вариант | `BASE` | Нужен `X-Project`? |
|---|---|---|
| **Домен мини-приложения проекта** (основной) | `https://<домен мини-приложения>/api/v1` | нет — проект берётся из домена |
| **Отдельный домен API** (если владелец его настроил) | `https://<домен API>` (без `/api/v1`) | да, `X-Project: <id проекта>` |

Для FGN: `BASE = https://app.blin4ick.cc/api/v1`.

Проверка, что API живо (токен не нужен):

```bash
curl https://app.blin4ick.cc/api/v1/tariffs
```

---

## 2. Заголовки

| Заголовок | Значение | Когда |
|---|---|---|
| `Authorization` | `Bearer <access_token>` | все методы, помеченные «токен» |
| `X-App-Key` | ключ приложения из панели (Настройки → «Приложение (API)») | если в панели включено «Требовать ключ». С ключом не нужна капча при входе по почте. Неверный ключ → `401 app_key_invalid`, даже если ключ не обязателен |
| `X-HWID` | постоянный id устройства: 8–128 символов `[A-Za-z0-9._:-]` | `GET /subscription` — без него не придёт `config` |
| `X-Device-OS` | `iOS`, `Android`, `Windows`… | необязательно, для списка устройств |
| `X-Device-OS-Version` | `17.5` | необязательно |
| `X-Device-Model` | `iPhone 15` | необязательно |
| `X-Project` | `fgn`, `batman`… | только на отдельном домене API |

`X-HWID` генерируйте один раз при установке приложения и храните (Keychain / EncryptedSharedPreferences). Смена HWID = новое устройство, оно займёт ещё один слот.

---

## 3. Авторизация

### 3.1 Схема

1. Получить пару токенов: `POST /auth/token` (по `initData` Telegram или по билету из входа по почте).
2. Слать запросы с `Authorization: Bearer <access_token>`.
3. `access_token` живёт **15 минут**. На `401 token_expired` — `POST /auth/refresh`, повторить запрос.
4. `refresh_token` живёт **30 дней** и продлевается при каждом обновлении, но не дольше **90 дней** с момента входа. Потом — войти заново.

Одновременно у пользователя до **10** живых сессий (устройств); при входе на 11-м самая старая завершается.

### 3.2 Вход по почте (мобильное приложение)

**Шаг 1. Отправить код**

```http
POST {BASE}/auth/email/send
{"email": "user@mail.ru", "captcha_token": null}
```

```json
{"ok": true, "resend_after": 60, "code_ttl": 600}
```

- `resend_after` — через сколько секунд можно запросить код повторно; `code_ttl` — сколько живёт код.
- `captcha_token` нужен, только если в панели включена капча и запрос идёт **без** `X-App-Key`.
- Лимиты: 3 кода за 5 минут на пару почта+IP, 10 в час; при превышении `429`.

**Шаг 2. Проверить код**

```http
POST {BASE}/auth/email/verify
{"email": "user@mail.ru", "code": "123456", "ref": "123"}
```

```json
{"session_token": "lt_...", "expires_in": 600, "is_new_user": true}
```

- `ref` — реферальный код (id пригласившего), необязательно; учитывается только при создании нового аккаунта.
- `session_token` — одноразовый билет на 10 минут. Сразу обменяйте его на токены (шаг 3).

**Шаг 3. Получить токены**

```http
POST {BASE}/auth/token
{"session_token": "lt_..."}
```

### 3.3 Вход через Telegram (мини-приложение)

```http
POST {BASE}/auth/token
{"init_data": "<Telegram.WebApp.initData>"}
```

`initData` можно передать и заголовком `X-Telegram-Init-Data`. Он должен быть не старше **1 часа** и подписан ботом **этого** проекта.

### 3.4 Ответ с токенами

`/auth/token` и `/auth/refresh` отвечают одинаково:

```json
{
  "access_token": "bv1.eyJ1Ijo...",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "Xk2pQ...",
  "refresh_expires_in": 2592000
}
```

### 3.5 Обновление токена

```http
POST {BASE}/auth/refresh
{"refresh_token": "Xk2pQ..."}
```

Ответ — **новая** пара. Сохраните обе: старый `refresh_token` после этого недействителен.
Повторное использование старого `refresh_token` считается кражей: сессия завершается (`401 refresh_reused`), нужно входить заново.

> Обновляйте токен из одного места. Если два параллельных запроса одновременно вызовут refresh с одним токеном, второй убьёт сессию. Пример правильной очереди — в разделе 9.

### 3.6 Выход

```http
POST {BASE}/auth/logout                    → {"ok": true, "revoked": 1}
POST {BASE}/auth/logout?all_sessions=true  → {"ok": true, "revoked": 3}
```

### 3.7 Ошибки входа

| HTTP | `code` | Что значит |
|---|---|---|
| 400 | `credentials_missing` | не передан ни `init_data`, ни `session_token` |
| 400 | `bad_email` | некорректный email |
| 401 | `code_invalid` | неверный или истёкший код из письма |
| 401 | `session_invalid` | билет `lt_…` истёк, уже использован или от другого проекта |
| 401 | `init_data_invalid` | подпись `initData` не сходится (не тот бот / подделка) |
| 401 | `init_data_expired` | `initData` старше часа — переоткрыть мини-приложение |
| 401 | `refresh_invalid` | refresh-токен неизвестен или истёк — войти заново |
| 401 | `refresh_reused` | старый refresh использован повторно — сессия завершена |
| 403 | `account_banned` | аккаунт заблокирован |
| 429 | `rate_limited` | подождать `retry_after_seconds` |

---

## 4. Список методов

| Метод | Путь | Токен | Что делает |
|---|---|---|---|
| POST | `/auth/email/send` | — | код на почту |
| POST | `/auth/email/verify` | — | проверить код → билет `session_token` |
| POST | `/auth/token` | — | вход → токены |
| POST | `/auth/refresh` | — | обновить токены |
| POST | `/auth/logout` | да | выход |
| GET | `/users/me` | да | профиль |
| POST | `/users/me/terms` | да | принять оферту (без этого оплата недоступна) |
| GET | `/subscription` | да | подписка, ключи (`config`), трафик, статистика сетей |
| POST | `/subscription/resync` | да | перевыпустить ключ («не работает») |
| GET | `/tariffs` | — | тарифы |
| POST | `/purchases/yookassa/create` | да | купить / продлить тариф |
| POST | `/purchases/hwid-slot/create` | да | докупить слоты устройств |
| GET | `/purchases/{id}/status` | да | статус оплаты |
| GET | `/family` | да | семья: устройства, гости, лимит |
| POST | `/family/invite` | да | код и ссылка приглашения |
| POST | `/family/join` | да | вступить в семью по коду |
| DELETE | `/family/members/{user_id}` | да | владелец удаляет гостя |
| DELETE | `/family/members/me` | да | гость выходит сам (то же: `POST /family/leave`) |
| DELETE | `/family/devices/{device_id}` | да | отвязать устройство |
| GET | `/referrals/me` | да | реферальная ссылка и статистика |
| POST | `/referrals/withdrawals` | да | заявка на вывод |
| GET | `/tasks` | да | задания |
| POST | `/tasks/{id}/claim` | да | забрать награду |
| POST | `/telemetry/sessions` | да | отметка «VPN подключён» |

Методы с деньгами и наградами (покупки, вывод, `claim`, приглашение и вступление в семью) у пользователей Telegram могут требовать подписки на канал проекта — тогда `403 channel_required` (см. раздел 8).

---

## 5. Профиль и подписка

### GET /users/me

```json
{
  "id": 123,
  "telegram_id": 555000111,
  "telegram_username": "ivan",
  "email": "ivan@mail.ru",
  "registered_at": "2026-01-01T10:00:00Z",
  "terms_accepted": true,
  "is_banned": false,
  "family_role": "owner",
  "project": {"id": "fgn", "name": "FGN"}
}
```

- `telegram_id` / `telegram_username` — `null` у аккаунтов, созданных по почте; `email` — `null` у аккаунтов Telegram без почты.
- `family_role`: `owner` (есть платная подписка или гости) | `member` (гость чужой семьи) | `none`.
- Заблокированный пользователь тоже получает ответ (`is_banned: true`).

### POST /users/me/terms

Тело не нужно. Отмечает согласие с офертой и политикой конфиденциальности. Ответ — как `GET /users/me`.
Показывайте экран согласия, пока `terms_accepted: false`; без него покупки отвечают `403 terms_not_accepted`.

### GET /subscription

Заголовок `X-HWID` обязателен, чтобы получить ключи.

```json
{
  "state": "active",
  "status": "active",
  "expires_at": "2030-01-01T00:00:00Z",
  "subscription_url": "https://sub.example.com/hIeb",
  "retry_after_seconds": null,
  "config": "vless://...#NL\nvless://...#DE",
  "config_error": null,
  "traffic": {"used_bytes": 134217728000, "limit_bytes": 0, "whitelist_active": true},
  "network_stats": {"lte_days": 12, "wifi_days": 17, "period_days": 30}
}
```

| Поле | Описание |
|---|---|
| `state` / `status` | одно и то же, см. таблицу ниже |
| `expires_at` | когда кончится подписка |
| `subscription_url` | ссылка подписки для импорта в сторонние клиенты (Happ, v2rayNG…); `null` при `provisioning` |
| `retry_after_seconds` | при `provisioning` — через сколько секунд повторить запрос |
| `config` | ключи подключения открытым текстом, по строке на сервер (`vless://…`, имя сервера после `#`) |
| `config_error` | почему `config` = `null` при `active`, см. ниже |
| `traffic.used_bytes` | израсходовано; `null` — не удалось узнать |
| `traffic.limit_bytes` | лимит; `0` — без лимита; `null` — не удалось узнать |
| `traffic.whitelist_active` | в подписке есть обход белых списков |
| `network_stats` | сколько дней из последних `period_days` VPN был включён через мобильную сеть / Wi-Fi (по телеметрии с полем `network`) |

| `state` | Что показать |
|---|---|
| `active` | подписка работает |
| `provisioning` | ключ выдаётся / перевыпускается; повторить через `retry_after_seconds` (обычно 3–5 с) |
| `expired` | срок истёк — предложить продление |
| `disabled` | подписка или аккаунт заблокированы |

`config` приходит только при `active` и только с `X-HWID`. При первом запросе с новым HWID устройство регистрируется в подписке и занимает слот.

| `config_error` | Что делать |
|---|---|
| `hwid_required` | не передан `X-HWID` |
| `hwid_limit_reached` | все слоты заняты: отвязать устройство (`DELETE /family/devices/{id}`) или докупить слот |
| `unavailable` | VPN-панель не ответила — повторить позже |

Нет ни одной подписки → `404 no_subscription`. Гость семьи получает подписку владельца.
Ключи кэшируются на сервере до 2 минут; запрашивать `/subscription` при каждом подключении можно.

### POST /subscription/resync

Кнопка «Ключ не работает». Тело не нужно. Ответ `202` — объект как у `GET /subscription`, обычно `state: "provisioning"`.
Дальше опрашивайте `GET /subscription` каждые `retry_after_seconds`, пока не придёт `active` с новым `config`.

Ошибки: `403 family_member` (перевыпускает владелец), `403 subscription_disabled`, `409 subscription_expired`, `404 no_subscription`, `429` (не больше 5 раз за 10 минут).

---

## 6. Тарифы и оплата

### GET /tariffs

Без токена.

```json
[
  {"code": "m1",  "title": "1 месяц",    "price": 180,  "currency": "RUB", "period_days": 30},
  {"code": "m3",  "title": "3 месяца",   "price": 470,  "currency": "RUB", "period_days": 90},
  {"code": "m6",  "title": "6 месяцев",  "price": 900,  "currency": "RUB", "period_days": 180},
  {"code": "m12", "title": "12 месяцев", "price": 1600, "currency": "RUB", "period_days": 365}
]
```

Цены задаются в панели проекта. `price` — за тариф с базовым числом устройств; итоговая сумма с доплатами приходит в ответе на создание платежа.

### POST /purchases/yookassa/create

Купить подписку или продлить действующую на срок тарифа.

```json
{"tariff_code": "m1", "extra_devices": 0, "use_referral_balance": false}
```

| Поле | Описание |
|---|---|
| `tariff_code` | `code` из `/tariffs` |
| `extra_devices` | 0–20, устройства сверх включённых в тариф (за доплату) |
| `use_referral_balance` | оплатить частично или полностью реферальным балансом |

Ответ `201`:

```json
{
  "purchase_id": "a8e42ec625044ca477fc63cd",
  "payment_url": "https://yoomoney.ru/checkout/...",
  "status": "pending",
  "amount": 220,
  "full_price": 220,
  "referral_applied": 0,
  "currency": "RUB"
}
```

- `amount` — сколько платить в ЮKassa; `full_price` — полная цена; `referral_applied` — сколько списано с реф. баланса.
- Откройте `payment_url` во внешнем браузере (или Custom Tabs / SFSafariViewController). После оплаты ЮKassa вернёт пользователя на адрес из панели (Настройки → «Приложение (API)» → адрес возврата, например `fgn://payment?id={payment_id}`).
- Если всё покрыто реф. балансом: `status: "succeeded"`, `payment_url: null` — подписка уже продлена.

Ошибки: `403 terms_not_accepted`, `404 tariff_not_found`, `503 payments_unavailable` (оплата не настроена), `502 payment_error`, `429` (не больше 10 платежей за 10 минут).

### POST /purchases/hwid-slot/create

Докупить слоты устройств к своей активной **платной** подписке.

```json
{"count": 1, "months": 1}
```

`count` — 1–10 слотов; `months` — 1, 3, 6 или 12. Ответ — как у `/purchases/yookassa/create`. После оплаты растёт `hwid_limit` (см. `/family`).

Ошибки: `403 family_member` (докупает владелец), `409 no_subscription`, `422 bad_months`, плюс ошибки оплаты выше.

### GET /purchases/{purchase_id}/status

```json
{
  "purchase_id": "a8e42ec625044ca477fc63cd",
  "status": "succeeded",
  "purpose": "subscription",
  "amount": 220,
  "currency": "RUB",
  "payment_url": null,
  "paid_at": "2026-10-31T14:27:20Z",
  "expires_at": "2026-11-30T14:27:20Z"
}
```

- `status`: `pending` | `succeeded` | `failed` | `canceled`.
- `purpose`: `subscription` | `extend` | `devices`.
- `payment_url` — только пока `pending` (можно снова открыть страницу оплаты).
- `expires_at` — новый срок подписки, только при `succeeded`.

Опрашивайте раз в 3–5 секунд, пока `pending` (например, после возврата из браузера). Подписку продлевает уведомление ЮKassa; кроме того, опрос сам перепроверяет платёж в ЮKassa не чаще раза в 10 секунд. После `succeeded` подписка может ещё несколько секунд быть в `provisioning`.

Чужая или несуществующая покупка → `404 purchase_not_found`.

---

## 7. Семья и устройства

Подписку можно разделить с гостями. Лимит устройств общий: устройства владельца и всех гостей вместе.

### GET /family

```json
{
  "role": "owner",
  "is_owner": true,
  "owner": {"user_id": 1, "display_name": "@ivan"},
  "used_hwids": 2,
  "hwid_limit": 3,
  "devices_available": true,
  "devices": [
    {"id": "dev-AAAA1111", "name": "iPhone 15 · 17.5", "platform": "iOS",
     "last_seen_at": "2026-10-31T10:00:00Z", "user_id": 1, "is_mine": true, "can_delete": true}
  ],
  "members": [
    {"user_id": 2, "display_name": "@petr", "used_hwids": 1, "joined_at": "2026-10-31T14:26:45Z"}
  ],
  "max_members": 5,
  "can_invite": true,
  "invite": {"code": "M3HKUXR3", "link": "https://app.blin4ick.cc/family?code=M3HKUXR3"}
}
```

| Поле | Описание |
|---|---|
| `role` | `owner` / `member` / `none`; при `none` списки пустые, `owner` = `null` |
| `used_hwids` / `hwid_limit` | занято / всего слотов на подписку |
| `devices[].id` | HWID устройства — его передают в `DELETE /family/devices/{id}` |
| `devices[].user_id` | чьё устройство (владелец или гость) |
| `devices[].can_delete` | может ли текущий пользователь его отвязать |
| `devices_available` | `false` — список устройств сейчас не получить (панель не ответила) |
| `max_members` | максимум человек в семье |
| `can_invite`, `invite` | только у владельца с платной подпиской; `invite.link` может быть `null`, если у проекта не задан адрес |

### POST /family/invite

Тело необязательно. `{"rotate": true}` — выдать новый код, старый перестанет работать (не чаще 5 раз в час).

```json
{"code": "M3HKUXR3", "invite_link": "https://app.blin4ick.cc/family?code=M3HKUXR3"}
```

Ошибки: `403 family_member`, `409 no_subscription`.

### POST /family/join

```json
{"code": "M3HKUXR3"}
```

Ответ — объект как у `GET /family` (уже с `role: "member"`).

Ошибки: `409 already_in_family` (свой код или уже в этой семье), `409 in_other_family`, `409 has_own_family`, `409 has_own_subscription`, `404 code_not_found`, `400 family_full`, `400 owner_no_subscription`.

### DELETE /family/members/{user_id}

Владелец удаляет гостя. Ответ — как `GET /family`. Ошибки: `403 family_member`, `404 member_not_found`.

### DELETE /family/members/me  (или POST /family/leave)

Гость выходит сам. Ответ: `{"ok": true}`. Ошибка: `409 not_in_family`.

Когда гость уходит или его удаляют, ключ владельца перевыпускается и **все** устройства подписки отвязываются (иначе у ушедшего остался бы рабочий ключ). Приложения получат новый `config` при следующем `GET /subscription`.

### DELETE /family/devices/{device_id}

Отвязать устройство и освободить слот. Владелец — любое, гость — только своё. Ответ — как `GET /family`.

Ошибки: `403 not_your_device`, `404 device_not_found`, `503 devices_unavailable`, `502 device_delete_failed`.

---

## 8. Рефералы, задания, телеметрия

### GET /referrals/me

```json
{
  "invite_link": "https://t.me/fgn_bot?start=ref_123",
  "stats": {"invited": 5, "earned_total": 500, "available_to_withdraw": 100}
}
```

### POST /referrals/withdrawals

```json
{"amount": 100, "method": "crypto", "address": "UQAbc..."}
```

- `amount` — рубли, минимум 100.
- `method` — `crypto` (USDT в сети TON).
- `address` — адрес TON (`UQ…` / `EQ…`) или домен `.ton` / `.t.me`. Не передан — берётся адрес из прошлой заявки.

Ответ `201`: `{"id": 42, "status": "pending"}`. Сумма сразу списывается с баланса; заявку обрабатывает команда.

Ошибки: `400 amount_too_small`, `400 insufficient_funds`, `400 address_required`, `400 bad_address`, `422 bad_method`, `429` (не больше 5 за 10 минут).

### GET /tasks

```json
[
  {"id": 1, "title": "Подпишись на канал", "reward_days": 3, "status": "active",
   "progress": 0, "target": 1, "url": "https://t.me/channel"},
  {"id": 2, "title": "Проведи 15 минут в VPN", "reward_days": 1, "status": "completed",
   "progress": 15, "target": 15, "url": null}
]
```

| `status` | Что показать |
|---|---|
| `active` | не выполнено: прогресс `progress / target`, кнопка ведёт на `url` |
| `completed` | выполнено — кнопка «Забрать награду» |
| `claimed` | награда уже получена |

Задания настраиваются в панели. Подписка на канал проверяется только у аккаунтов Telegram.

### POST /tasks/{id}/claim

Тело не нужно. Добавляет `reward_days` к подписке (или создаёт подписку, если её не было) и возвращает объект как `GET /subscription`, обычно в `provisioning`.

Ошибки: `404 task_not_found`, `409 not_completed`, `409 already_claimed`, `409 not_connected` (для заданий «N минут в VPN» сервер не видит подключений в панели), `403 subscription_disabled`, `403 no_renew`, `502 grant_failed`, `429` (не больше 10 за 10 минут).

### POST /telemetry/sessions

Отметка «VPN подключён». Нужна для заданий «проведи N минут в VPN» и для `network_stats`.

```json
{"session_id": "c0a8012e-7c4b-4a5e-9f3a-1b2c3d4e5f60", "node_name": "DE-Frankfurt", "network": "wifi"}
```

- `session_id` — 1–64 символа `[A-Za-z0-9._:-]`, новый UUID на каждое подключение.
- `node_name` — имя сервера (после `#` в строке `config`).
- `network` — необязательно: `wifi` или `lte` (`cellular`, `4g`, `5g` тоже засчитываются как `lte`).

Ответ: `{"ok": true}`.

Когда слать:
- при подключении — с новым `session_id`;
- пока подключено — каждые 1–5 минут с тем же `session_id`;
- при отключении — ещё раз с тем же `session_id`.

Засчитывается время между отметками одной сессии; промежутки больше часа не засчитываются. Лимит — 30 отметок в минуту.

---

## 9. Ошибки

Формат всех ошибок:

```json
{"detail": {"message": "Подписки нет", "code": "no_subscription"}, "error": "Подписки нет"}
```

`message` можно показать пользователю как есть; логику стройте по `code`.

| HTTP | `code` | Что делать |
|---|---|---|
| 401 | `token_expired` | `POST /auth/refresh`, повторить запрос |
| 401 | `token_missing`, `token_invalid`, `session_revoked`, `wrong_project` | войти заново (`/auth/token`) |
| 401 | `app_key_invalid` | ключ приложения отозван или неверный — обновить приложение |
| 403 | `account_banned` | аккаунт заблокирован |
| 403 | `channel_required` | предложить подписаться на канал: `detail.channel_url`, затем повторить |
| 403 | `terms_not_accepted` | показать оферту, `POST /users/me/terms` |
| 404 | `no_subscription` | подписки нет — экран покупки |
| 429 | `rate_limited` | подождать `detail.retry_after_seconds` |
| 503 | `api_disabled` | API приложения выключено в панели |
| 5xx | — | повторить позже |
| прочие 4xx | — | показать `message` |

`wrong_project` — токен выдан другому проекту сети (запрос ушёл не на тот домен или с чужим `X-Project`).

---

## 10. Типовые сценарии

**Первый запуск:** вход (3.2 или 3.3) → `GET /users/me` → если `terms_accepted: false`, экран оферты → `POST /users/me/terms` → `GET /subscription` (с `X-HWID`).

**Подключение:** `GET /subscription` → `state = active` и есть `config` → отдать строки `config` в VPN-ядро (Xray / sing-box) → `POST /telemetry/sessions`.

**Покупка:** `GET /tariffs` → `POST /purchases/yookassa/create` → открыть `payment_url` → вернуться в приложение → опрашивать `GET /purchases/{id}/status` до `succeeded` → опрашивать `GET /subscription` до `active`.

**Не хватает слотов (`hwid_limit_reached`):** показать `GET /family` → пользователь отвязывает устройство (`DELETE /family/devices/{id}`) или докупает слот (`POST /purchases/hwid-slot/create`) → снова `GET /subscription`.

**«Ключ не работает»:** `POST /subscription/resync` → опрашивать `GET /subscription` до `active`.

---

## 11. Готовый клиент (TypeScript / JavaScript)

```ts
const BASE = "https://app.blin4ick.cc/api/v1";
const APP_KEY = "";            // если в панели включено «Требовать ключ»
const HWID = getOrCreateHwid(); // постоянный id устройства

type Tokens = { access_token: string; refresh_token: string };
let tokens: Tokens | null = loadTokens();
let refreshing: Promise<void> | null = null;

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public detail: any) { super(message); }
}

async function raw(path: string, method = "GET", body?: unknown, auth = true): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-HWID": HWID,
    "X-Device-OS": "Android",
  };
  if (APP_KEY) headers["X-App-Key"] = APP_KEY;
  if (auth && tokens) headers.Authorization = `Bearer ${tokens.access_token}`;
  return fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function refresh(): Promise<void> {
  // все запросы ждут одно и то же обновление
  refreshing ??= (async () => {
    const res = await raw("/auth/refresh", "POST", { refresh_token: tokens!.refresh_token }, false);
    if (!res.ok) { tokens = null; saveTokens(null); throw new ApiError(401, "relogin", "Войдите заново", null); }
    tokens = await res.json(); saveTokens(tokens);
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = any>(path: string, method = "GET", body?: unknown, auth = true): Promise<T> {
  if (refreshing) await refreshing;
  let res = await raw(path, method, body, auth);
  if (res.status === 401 && auth && tokens) {
    const data = await res.json().catch(() => ({}));
    if (data?.detail?.code !== "token_expired") { tokens = null; saveTokens(null); throw new ApiError(401, "relogin", "Войдите заново", data); }
    await refresh();
    res = await raw(path, method, body, auth);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.detail?.code || "error", data?.detail?.message || "Ошибка", data?.detail);
  return data as T;
}

// вход по почте
export async function emailLogin(email: string, code?: string) {
  if (!code) return api("/auth/email/send", "POST", { email }, false);
  const { session_token } = await api("/auth/email/verify", "POST", { email, code }, false);
  tokens = await api("/auth/token", "POST", { session_token }, false);
  saveTokens(tokens);
}

// дождаться выдачи ключа (после покупки, resync, claim)
export async function waitActive(sub?: any) {
  sub ??= await api("/subscription");
  while (sub.state === "provisioning") {
    await new Promise((r) => setTimeout(r, (sub.retry_after_seconds || 3) * 1000));
    sub = await api("/subscription");
  }
  return sub;
}

// дождаться оплаты
export async function waitPaid(purchaseId: string) {
  for (;;) {
    const p = await api(`/purchases/${purchaseId}/status`);
    if (p.status !== "pending") return p;
    await new Promise((r) => setTimeout(r, 4000));
  }
}
```

`getOrCreateHwid`, `loadTokens`, `saveTokens` — хранение в защищённом хранилище платформы.

---

## Для владельца сервера

1. API включено по умолчанию. Панель → проект → Настройки → «Приложение (API)»: включить/выключить, ключи приложения (`X-App-Key`) и «Требовать ключ», адрес возврата после оплаты (`{payment_id}` подставляется), шаблон ссылки-приглашения (`{code}`), обход белых списков в платной подписке.
2. Отдельный домен API (по желанию): A-запись `api.example.com` на сервер панели → `.env`: `API_DOMAIN=api.example.com` → `install.sh` → 1. На нём клиент шлёт `X-Project`.
3. ЮKassa: Интеграция → HTTP-уведомления → `https://<домен мини-приложения>/webhooks/payments/yookassa` (старый `/yookassa` тоже работает).
4. Проверка: `curl https://<домен>/api/v1/tariffs` возвращает список тарифов.
5. Браузерный клиент на другом домене: добавить домен в `CORS_ORIGINS` в `.env`.

Устройство на сервере (очередь выдачи, леджер, схема БД) — `docs/API_V1.md`.
