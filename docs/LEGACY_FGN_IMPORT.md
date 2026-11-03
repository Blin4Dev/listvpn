# Перенос старой базы бота FGN (bot2.db)

Скрипт: `src/core/legacy_fgn.py`. Запускается в контейнере api (рабочая папка `/app/src/core`).
Старую базу положить в `~/blinvpn/data/bot2.db` (внутри контейнера — `/app/data/bot2.db`).

## Порядок

```bash
# 0. старый бот FGN — выключить навсегда (тот же токен = конфликт 409, и он будет менять ключи в Remnawave)
cd ~/blinvpn
docker compose stop bot webhook                       # чтобы ничего не писали и не рассылали во время переноса
cp data/data.db data/data.db.before-fgn-$(date +%F-%H%M)   # резервная копия

docker exec -it blinvpn-api python legacy_fgn.py check  --old /app/data/bot2.db            # только чтение
docker exec -it blinvpn-api python legacy_fgn.py import --old /app/data/bot2.db --dry-run  # всё сделать и откатить
docker exec -it blinvpn-api python legacy_fgn.py import --old /app/data/bot2.db            # по-настоящему (~10 с)
docker exec -it blinvpn-api python legacy_fgn.py verify --old /app/data/bot2.db            # сверка: «ВСЁ СХОДИТСЯ»

docker exec -it blinvpn-api python legacy_fgn.py adopt --dry-run      # что будет с ключами в Remnawave
docker exec -it blinvpn-api python legacy_fgn.py adopt --limit 1      # один человек: проверить, что ключ работает (в Remnawave ничего не меняется)
docker exec -it blinvpn-api python legacy_fgn.py adopt                # остальные (можно прерывать и запускать снова)
docker exec -it blinvpn-api python legacy_fgn.py provision            # живым подпискам без ключа — новый ключ
docker exec -it blinvpn-api python legacy_fgn.py verify --old /app/data/bot2.db

docker compose start bot webhook
```

## Что куда

| Старая база | Новая |
|---|---|
| users | users (FGN): Telegram ID, username, имя, дата прихода, реф. баланс (`partner_balance`), кто пригласил (`referred_by`), реф. код = Telegram ID (старые ссылки `ref_<tg>` работают), анти-ключ в `anti_key`/`anti_expires_at`; пробный период отмечен как использованный |
| users.vpn_key / vpn_expires_at / device_limit | subscriptions: ключ и срок как есть; действует → Active, истекла ≤ 7 дней → Expired, дольше → Deleted (как удалила бы платформа); ни одной оплаты → тип trial |
| devices_limit_expires_at в будущем | device_addons (платформа сама снимет в срок) |
| payment_history | payments + transactions (история в приложении) + purchases (API v1); один payment_id — один платёж (повторные записи старого бота не дублируются); звёзды — `stars`, рубли 0 |
| referral_earnings | transactions «Бонус за друга» + referral_ledger; разница с балансом — строка adjustment |
| gifts | referral_rewards: купленные — bought, раздачи админа — admin; коды `GIFT_X`/`GIFTN_X` → `GIFT-X`/`GIFT-NX`, старые коды и ссылки активируются |
| promocodes | promocodes (скидка %) |
| ВСЕ таблицы целиком | `legacy_fgn_<таблица>` — побайтная копия (anti_keys, notification_logs, user_language, admins, settings, white_list, processed_payments, promocode_usage …) |

Связь старых и новых id: `legacy_fgn_map_users`, `legacy_fgn_map_payments`. Итоги — настройка `legacy_fgn_import`.

## Автоматика после переноса

Не сработают на перенесённых: онбординг новичков, «оплатил, но не подключился», «давно не виделись — дарим дни»
(для уже истёкших; `--winback` при import — не гасить). Работают как у всех: напоминания об окончании (3/2/1 день),
предупреждения «подписка удалится» и удаление через 7 дней после окончания.

## Привязка к Remnawave (adopt)

Имена пользователей в Remnawave **не меняются** (панель не даёт переименовать, и не нужно). `adopt` находит
пользователя по shortUuid ключа, проверяет Telegram ID и записывает привязку в `rw_legacy_users`
(id пользователя платформы ↔ id и имя в Remnawave). Дальше платформа ведёт его как своего — продление, устройства,
сброс ключа, удаление после окончания — строго по этой привязке; чужие пользователи панели по-прежнему недоступны.
Перенесённые не показываются в «Ресейле», и перенести их группу через ресейл нельзя.
