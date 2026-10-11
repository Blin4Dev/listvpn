#!/usr/bin/env bash
# Установка/обновление панели BatmanVPN на ОТДЕЛЬНОМ сервере.
# Запускается install.sh с основного сервера по SSH (от root или через sudo -n):
#   bash setup.sh <panel_domain> <email> <incoming_dir> <bot_server_ip>
# В <incoming_dir> уже лежат:
#   release.tgz  — статика панели (release/html, release/live/assets)
#   nginx.conf   — готовый конфиг nginx (содержит секрет шлюза, права 600)
set -Eeuo pipefail

PANEL_DOMAIN="${1:?panel domain}"
EMAIL="${2:?email}"
INCOMING="${3:?incoming dir}"
BOT_IP="${4:?bot server ip}"

WWW_ROOT="/var/www/blinvpn-panel"
ACME_ROOT="/var/www/blinvpn-acme"
SITE_CONF="/etc/nginx/sites-available/blinvpn-panel.conf"
SITE_LINK="/etc/nginx/sites-enabled/blinvpn-panel.conf"
ACME_CONF="/etc/nginx/sites-available/blinvpn-panel-acme.conf"
ACME_LINK="/etc/nginx/sites-enabled/blinvpn-panel-acme.conf"
KEEP_RELEASES=3

say()  { printf '   [панель] %s\n' "$*"; }
fail() { printf '   [панель] ОШИБКА: %s\n' "$*" >&2; exit 1; }
trap 'fail "строка $LINENO: команда завершилась с ошибкой"' ERR

[[ "$(id -u)" -eq 0 ]] || fail "нужен root"
[[ "$PANEL_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || fail "некорректный домен"
[[ "$BOT_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || fail "некорректный IP сервера бота"
[[ "$INCOMING" == /var/lib/blinvpn-panel/incoming/* && -d "$INCOMING" ]] || fail "нет каталога с релизом"
[[ -f "$INCOMING/release.tgz" && -f "$INCOMING/nginx.conf" ]] || fail "релиз неполный"
command -v apt-get >/dev/null 2>&1 || fail "поддерживаются только Debian/Ubuntu (apt-get)"
command -v systemctl >/dev/null 2>&1 || fail "нужен systemd"

cleanup() { rm -rf "$INCOMING" "$ACME_LINK" "$ACME_CONF" 2>/dev/null || true; }
trap cleanup EXIT

# ── пакеты ──
need=()
for p in nginx certbot curl ca-certificates tar; do
    dpkg -s "$p" >/dev/null 2>&1 || need+=("$p")
done
if ((${#need[@]})); then
    say "устанавливаю: ${need[*]}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -q >/dev/null
    apt-get install -y -q --no-install-recommends "${need[@]}" >/dev/null
fi

# ── nginx запущен ──
systemctl enable nginx >/dev/null 2>&1 || true
if ! systemctl is-active --quiet nginx; then
    if ! systemctl start nginx; then
        nginx -t 2>&1 | sed 's/^/      /' || true
        ss -ltnpH 2>/dev/null | awk '$4 ~ /:(80|443)$/ {print "      занят " $4 "  " $6}' || true
        fail "nginx не запускается (см. выше: битый конфиг или порт 80/443 занят)"
    fi
fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
    ufw allow 80/tcp >/dev/null || true
    ufw allow 443/tcp >/dev/null || true
fi

# ── релиз статики: атомарная замена через симлинк ──
ts="$(date +%Y%m%d%H%M%S)"
rel="$WWW_ROOT/releases/$ts"
mkdir -p "$rel"
tar -xzf "$INCOMING/release.tgz" -C "$rel" --no-same-owner --no-same-permissions
[[ -f "$rel/html/index.html" ]] || { rm -rf "$rel"; fail "в релизе нет index.html"; }
chown -R root:root "$rel"
find "$rel" -type d -exec chmod 755 {} +
find "$rel" -type f -exec chmod 644 {} +
prev_current="$(readlink -f "$WWW_ROOT/current" 2>/dev/null || true)"
ln -sfn "$rel" "$WWW_ROOT/current.new" && mv -Tf "$WWW_ROOT/current.new" "$WWW_ROOT/current"
say "статика панели обновлена ($ts)"

# ── сертификат ──
mkdir -p "$ACME_ROOT/.well-known/acme-challenge"
chmod 755 "$ACME_ROOT" "$ACME_ROOT/.well-known" "$ACME_ROOT/.well-known/acme-challenge"
if [[ ! -s "/etc/letsencrypt/live/${PANEL_DOMAIN}/fullchain.pem" ]]; then
    say "выпускаю сертификат для ${PANEL_DOMAIN}"
    cat > "$ACME_CONF" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${PANEL_DOMAIN};
    location /.well-known/acme-challenge/ { root ${ACME_ROOT}; }
    location / { return 404; }
}
EOF
    ln -sfn "$ACME_CONF" "$ACME_LINK"
    # старый конфиг панели (если есть) может мешать — временно отключаем
    had_site=0
    if [[ -L "$SITE_LINK" ]]; then had_site=1; rm -f "$SITE_LINK"; fi
    if ! nginx -t >/dev/null 2>&1; then
        nginx -t 2>&1 | sed 's/^/      /' || true
        [[ $had_site -eq 1 ]] && ln -sfn "$SITE_CONF" "$SITE_LINK"
        fail "конфиг nginx на сервере панели сломан (см. выше)"
    fi
    systemctl reload nginx

    # проверка: этот nginx отдаёт challenge и домен смотрит сюда
    token="probe-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "$token" > "$ACME_ROOT/.well-known/acme-challenge/$token"
    local_ok="$(curl -s -m 10 --resolve "${PANEL_DOMAIN}:80:127.0.0.1" "http://${PANEL_DOMAIN}/.well-known/acme-challenge/$token" || true)"
    public_ok="$(curl -s -m 10 "http://${PANEL_DOMAIN}/.well-known/acme-challenge/$token" || true)"
    rm -f "$ACME_ROOT/.well-known/acme-challenge/$token"
    if [[ "$local_ok" != "$token" ]]; then
        [[ $had_site -eq 1 ]] && ln -sfn "$SITE_CONF" "$SITE_LINK"
        fail "${PANEL_DOMAIN} на порту 80 обслуживает другой конфиг nginx на этом сервере (проверьте: nginx -T | grep server_name)"
    fi
    if [[ "$public_ok" != "$token" ]]; then
        # запрос сервера к самому себе по внешнему IP работает не у всех хостеров — сверяем DNS
        my_ip="$(curl -4 -s -m 8 https://api.ipify.org || true)"
        dns_ip="$(getent ahostsv4 "$PANEL_DOMAIN" | awk 'NR==1{print $1}')"
        if [[ -z "$dns_ip" || -z "$my_ip" || "$dns_ip" != "$my_ip" ]]; then
            [[ $had_site -eq 1 ]] && ln -sfn "$SITE_CONF" "$SITE_LINK"
            fail "домен ${PANEL_DOMAIN} не ведёт на этот сервер (A-запись: ${dns_ip:-нет}, IP сервера: ${my_ip:-?}). Если домен за Cloudflare — включите «DNS only»."
        fi
    fi

    certbot certonly --webroot -w "$ACME_ROOT" -d "$PANEL_DOMAIN" \
        --email "$EMAIL" --agree-tos --non-interactive \
        --deploy-hook "systemctl reload nginx" \
        || { [[ $had_site -eq 1 ]] && ln -sfn "$SITE_CONF" "$SITE_LINK"; fail "certbot не выдал сертификат"; }
    rm -f "$ACME_LINK" "$ACME_CONF"
fi

# ── конфиг панели (с секретом шлюза → только root) ──
backup=""
if [[ -f "$SITE_CONF" ]]; then
    backup="$(mktemp /root/blinvpn-panel.conf.XXXXXX)"
    cp -p "$SITE_CONF" "$backup"
fi
install -m 600 -o root -g root "$INCOMING/nginx.conf" "$SITE_CONF"
ln -sfn "$SITE_CONF" "$SITE_LINK"
rm -f "$ACME_LINK" "$ACME_CONF"
if ! nginx -t >/dev/null 2>&1; then
    nginx -t 2>&1 | sed 's/^/      /' || true
    if [[ -n "$backup" ]]; then
        install -m 600 "$backup" "$SITE_CONF"
    else
        rm -f "$SITE_LINK" "$SITE_CONF"
    fi
    if [[ -n "$prev_current" && -d "$prev_current" ]]; then
        ln -sfn "$prev_current" "$WWW_ROOT/current.new" && mv -Tf "$WWW_ROOT/current.new" "$WWW_ROOT/current"
    fi
    rm -f "$backup"
    fail "новый конфиг nginx не прошёл проверку — откатил на прежний"
fi
rm -f "$backup"
systemctl reload nginx
say "nginx панели настроен"

# ── старые релизы ──
ls -1dt "$WWW_ROOT"/releases/*/ 2>/dev/null | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
    [[ "$(readlink -f "$old")" == "$(readlink -f "$WWW_ROOT/current")" ]] && continue
    rm -rf "$old"
done

# ── проверка: статика и шлюз до сервера бота ──
sleep 1
code_index="$(curl -s -o /dev/null -w '%{http_code}' -m 15 --resolve "${PANEL_DOMAIN}:443:127.0.0.1" "https://${PANEL_DOMAIN}/" || true)"
code_api="$(curl -s -o /dev/null -w '%{http_code}' -m 20 --resolve "${PANEL_DOMAIN}:443:127.0.0.1" "https://${PANEL_DOMAIN}/api/panel/auth/me" || true)"
[[ "$code_index" == "200" ]] || fail "панель не отдаёт index.html (HTTP ${code_index})"
case "$code_api" in
    401) say "шлюз до API работает" ;;
    403) fail "сервер бота отклонил панель по IP (HTTP 403). IP этого сервера для исходящих: $(curl -4 -s -m 8 https://api.ipify.org || echo ?)" ;;
    404) fail "сервер бота не принял секрет шлюза (HTTP 404) — запустите установку на сервере бота ещё раз" ;;
    502|504) fail "не удаётся подключиться к серверу бота ${BOT_IP}:443 по HTTPS (HTTP ${code_api}): проверьте фаервол и сертификат" ;;
    *) fail "неожиданный ответ API через шлюз: HTTP ${code_api}" ;;
esac
echo "OK"
