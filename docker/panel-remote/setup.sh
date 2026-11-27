#!/usr/bin/env bash
# Установка/обновление панели BatmanVPN на ОТДЕЛЬНОМ сервере (Caddy, сертификат выпускается автоматически).
# Запускается install.sh с сервера бота по SSH (от root или через sudo -n):
#   bash setup.sh <panel_domain> <email> <incoming_dir> <bot_server_ip> [<https_port>=443]
# В <incoming_dir> уже лежат:
#   release.tgz — статика панели (html/, live/assets/)
#   site.caddy  — сайт Caddy (содержит секрет шлюза)
set -Eeuo pipefail

PANEL_DOMAIN="${1:?panel domain}"
EMAIL="${2:?email}"
INCOMING="${3:?incoming dir}"
BOT_IP="${4:?bot server ip}"
PORT="${5:-443}"
GW_CHECK="${6:-strict}"
PROXY_MODE="${7:-caddy}"  # manual — Caddy/сертификаты не трогаем: только файлы панели + инструкция

WWW_ROOT="/var/www/blinvpn-panel"
CADDY_MAIN="/etc/caddy/Caddyfile"
CADDY_SITES="/etc/caddy/sites"
SITE_FILE="${CADDY_SITES}/blinvpn-panel.caddy"
MARKER="# managed-by-blinvpn"
MIN_VER="2.7.0"
FALLBACK_VER="2.8.4"
KEEP_RELEASES=3

say()  { printf '   [панель] %s\n' "$*"; }
fail() { printf '   [панель] ОШИБКА: %s\n' "$*" >&2; exit 1; }
trap 'fail "строка $LINENO: команда завершилась с ошибкой"' ERR

[[ "$(id -u)" -eq 0 ]] || fail "нужен root"
[[ "$PANEL_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || fail "некорректный домен"
[[ "$EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || fail "некорректный email"
[[ "$BOT_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || fail "некорректный IP сервера бота"
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] && (( PORT >= 1 && PORT <= 65535 )) && [[ "$PORT" != "80" ]] || fail "некорректный порт"
if [[ "$PORT" == "443" ]]; then PANEL_URL="https://${PANEL_DOMAIN}"; else PANEL_URL="https://${PANEL_DOMAIN}:${PORT}"; fi
[[ "$INCOMING" == /var/lib/blinvpn-panel/incoming/* && -d "$INCOMING" ]] || fail "нет каталога с релизом"
[[ -f "$INCOMING/release.tgz" && -f "$INCOMING/site.caddy" ]] || fail "релиз неполный"
command -v apt-get >/dev/null 2>&1 || fail "поддерживаются только Debian/Ubuntu (apt-get)"
command -v systemctl >/dev/null 2>&1 || fail "нужен systemd"

cleanup() { rm -rf "$INCOMING" 2>/dev/null || true; }
trap cleanup EXIT

ver_ge() { [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]; }
caddy_ver() { caddy version 2>/dev/null | awk '{print $1}' | sed 's/^v//'; }

export DEBIAN_FRONTEND=noninteractive

# ── базовые пакеты ──
need=()
for p in curl ca-certificates tar gnupg; do dpkg -s "$p" >/dev/null 2>&1 || need+=("$p"); done
if ((${#need[@]})); then
    say "устанавливаю: ${need[*]}"
    apt-get update -q >/dev/null
    apt-get install -y -q --no-install-recommends "${need[@]}" >/dev/null
fi

# ── ручной прокси: выкладываем только статику и примеры конфигов ──
if [[ "$PROXY_MODE" == "manual" ]]; then
    for f in PROXY-README.txt panel.caddy.example panel.nginx.example; do
        [[ -f "$INCOMING/$f" ]] || fail "в релизе нет $f"
    done
    ts="$(date +%Y%m%d%H%M%S)"
    rel="$WWW_ROOT/releases/$ts"
    mkdir -p "$rel"
    tar -xzf "$INCOMING/release.tgz" -C "$rel" --no-same-owner --no-same-permissions
    [[ -f "$rel/html/index.html" ]] || { rm -rf "$rel"; fail "в релизе нет index.html"; }
    chown -R root:root "$rel"
    find "$rel" -type d -exec chmod 755 {} +
    find "$rel" -type f -exec chmod 644 {} +
    chmod 755 "$WWW_ROOT" "$WWW_ROOT/releases"
    ln -sfn "$rel" "$WWW_ROOT/current.new" && mv -Tf "$WWW_ROOT/current.new" "$WWW_ROOT/current"
    # примеры содержат секрет шлюза — только root
    install -d -m 700 -o root -g root "$WWW_ROOT/proxy"
    for f in PROXY-README.txt panel.caddy.example panel.nginx.example; do
        install -m 600 -o root -g root "$INCOMING/$f" "$WWW_ROOT/proxy/$f"
    done
    ls -1dt "$WWW_ROOT"/releases/*/ 2>/dev/null | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
        [[ "$(readlink -f "$old")" == "$(readlink -f "$WWW_ROOT/current")" ]] && continue
        rm -rf "$old"
    done
    say "файлы панели выложены: ${WWW_ROOT}/current/html ($ts)"
    say "Caddy и сертификаты не трогал — инструкция и примеры: ${WWW_ROOT}/proxy/"
    echo "OK"
    exit 0
fi

# ── Caddy: официальный репозиторий, иначе бинарник с GitHub (sha512) ──
install_caddy_binary() {
    local arch tmp base want got
    case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) fail "архитектура $(uname -m) не поддерживается" ;; esac
    tmp="$(mktemp -d)"; base="https://github.com/caddyserver/caddy/releases/download/v${FALLBACK_VER}"
    curl -fsSL -o "$tmp/c.tgz" "${base}/caddy_${FALLBACK_VER}_linux_${arch}.tar.gz" || fail "не удалось скачать Caddy"
    curl -fsSL -o "$tmp/s.txt" "${base}/caddy_${FALLBACK_VER}_checksums.txt" || fail "не удалось скачать контрольные суммы Caddy"
    want="$(awk -v f="caddy_${FALLBACK_VER}_linux_${arch}.tar.gz" '$2==f {print $1}' "$tmp/s.txt")"
    got="$(sha512sum "$tmp/c.tgz" | awk '{print $1}')"
    [[ -n "$want" && "$want" == "$got" ]] || fail "контрольная сумма Caddy не совпала"
    tar -xzf "$tmp/c.tgz" -C "$tmp" caddy
    install -m 755 -o root -g root "$tmp/caddy" /usr/bin/caddy
    rm -rf "$tmp"
    getent group caddy >/dev/null || groupadd --system caddy
    id caddy >/dev/null 2>&1 || useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
    mkdir -p /etc/caddy
    cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
}

v="$(caddy_ver || true)"
if [[ -z "$v" ]] || ! ver_ge "$v" "$MIN_VER"; then
    say "устанавливаю Caddy"
    if apt-get install -y -q --no-install-recommends debian-keyring debian-archive-keyring apt-transport-https >/dev/null 2>&1 \
        && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
        && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list \
        && chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list \
        && apt-get update -q >/dev/null 2>&1 && apt-get install -y -q caddy >/dev/null 2>&1; then
        :
    else
        say "репозиторий Caddy недоступен — ставлю бинарник с GitHub"
        rm -f /etc/apt/sources.list.d/caddy-stable.list
        install_caddy_binary
    fi
    v="$(caddy_ver || true)"
    [[ -n "$v" ]] && ver_ge "$v" "$MIN_VER" || fail "нужен Caddy ≥ ${MIN_VER}, установлен: ${v:-нет}"
fi

# ── главный Caddyfile ──
mkdir -p "$CADDY_SITES"
if [[ -s "$CADDY_MAIN" ]] && ! grep -qF "$MARKER" "$CADDY_MAIN" && ! grep -q 'root \* /usr/share/caddy' "$CADDY_MAIN"; then
    fail "в ${CADDY_MAIN} чужая конфигурация Caddy — перенесите свои сайты в ${CADDY_SITES}/*.caddy и удалите ${CADDY_MAIN}"
fi
cat > "$CADDY_MAIN" <<EOF
${MARKER}
# Главный файл Caddy. Сайты — в ${CADDY_SITES}/*.caddy (BatmanVPN: blinvpn-panel.caddy).
{
	email ${EMAIL}
	servers {
		protocols h1 h2
	}
}

import ${CADDY_SITES}/*.caddy
EOF
chmod 644 "$CADDY_MAIN"

# ── переход с nginx (прошлая версия установщика) ──
nginx_stopped=0
if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
    others="$(ls -1 /etc/nginx/sites-enabled/ 2>/dev/null | grep -vxE 'default|blinvpn-panel\.conf|blinvpn-panel-acme\.conf' || true)"
    others+="$(ls -1 /etc/nginx/conf.d/*.conf 2>/dev/null | tr '\n' ' ' || true)"
    [[ -z "${others// /}" ]] || fail "nginx на этом сервере обслуживает другие сайты (${others}) — Caddy не сможет занять порты 80/${PORT}"
    say "останавливаю nginx (его место займёт Caddy)"
    systemctl stop nginx; systemctl disable nginx >/dev/null 2>&1 || true
    nginx_stopped=1
fi
restore_nginx() {
    if [[ $nginx_stopped -eq 1 ]]; then
        systemctl stop caddy >/dev/null 2>&1 || true
        systemctl enable nginx >/dev/null 2>&1 || true
        systemctl start nginx || true
    fi
}
owners="$(ss -ltnpH 2>/dev/null | awk -v p="$PORT" '$4 ~ ("[:.](80|" p ")$") {print $4 " " $6}' | grep -v '"caddy"' || true)"
if [[ -n "$owners" ]]; then
    restore_nginx
    fail "порты 80/${PORT} заняты: ${owners}"
fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
    ufw allow 80/tcp >/dev/null || true
    ufw allow "${PORT}/tcp" >/dev/null || true
fi

# ── релиз статики: атомарная замена через симлинк ──
ts="$(date +%Y%m%d%H%M%S)"
rel="$WWW_ROOT/releases/$ts"
mkdir -p "$rel"
tar -xzf "$INCOMING/release.tgz" -C "$rel" --no-same-owner --no-same-permissions
[[ -f "$rel/html/index.html" ]] || { rm -rf "$rel"; restore_nginx; fail "в релизе нет index.html"; }
chown -R root:root "$rel"
find "$rel" -type d -exec chmod 755 {} +
find "$rel" -type f -exec chmod 644 {} +
chmod 755 "$WWW_ROOT" "$WWW_ROOT/releases"
prev_current="$(readlink -f "$WWW_ROOT/current" 2>/dev/null || true)"
ln -sfn "$rel" "$WWW_ROOT/current.new" && mv -Tf "$WWW_ROOT/current.new" "$WWW_ROOT/current"
say "статика панели обновлена ($ts)"

# ── сайт Caddy (с секретом шлюза → читает только root и caddy) ──
backup=""
if [[ -f "$SITE_FILE" ]]; then backup="$(mktemp /root/blinvpn-panel.caddy.XXXXXX)"; cp -p "$SITE_FILE" "$backup"; fi
install -m 640 -o root -g caddy "$INCOMING/site.caddy" "$SITE_FILE"
vlog="$(mktemp)"
if ! caddy validate --adapter caddyfile --config "$CADDY_MAIN" >"$vlog" 2>&1; then
    tail -n 15 "$vlog" | sed 's/^/      /'
    if [[ -n "$backup" ]]; then install -m 640 -o root -g caddy "$backup" "$SITE_FILE"; else rm -f "$SITE_FILE"; fi
    if [[ -n "$prev_current" && -d "$prev_current" ]]; then
        ln -sfn "$prev_current" "$WWW_ROOT/current.new" && mv -Tf "$WWW_ROOT/current.new" "$WWW_ROOT/current"
    fi
    rm -f "$backup" "$vlog"
    restore_nginx
    fail "конфигурация Caddy не прошла проверку — откатил"
fi
rm -f "$backup" "$vlog"
systemctl enable caddy >/dev/null 2>&1 || true
if systemctl is-active --quiet caddy; then systemctl reload caddy || systemctl restart caddy; else systemctl start caddy; fi
say "Caddy настроен"

# ── сертификат: Caddy выпускает сам, ждём ──
ok=0
for _ in $(seq 1 45); do
    if curl -s --noproxy "*" -o /dev/null -m 5 --resolve "${PANEL_DOMAIN}:${PORT}:127.0.0.1" "${PANEL_URL}/"; then ok=1; break; fi
    sleep 3
done
if [[ $ok -ne 1 ]]; then
    journalctl -u caddy --no-pager -n 60 2>/dev/null | grep -iE 'error|acme|challenge|certificate' | tail -n 8 | sed 's/^/      /' || true
    my_ip="$(curl -4 -s -m 8 https://api.ipify.org || true)"
    dns_ip="$(getent ahostsv4 "$PANEL_DOMAIN" | awk 'NR==1{print $1}')"
    restore_nginx
    fail "Caddy не получил сертификат для ${PANEL_DOMAIN} (A-запись: ${dns_ip:-нет}, IP сервера: ${my_ip:-?}). Проверьте DNS, порты 80/${PORT} и что домен не за Cloudflare-прокси."
fi
say "HTTPS работает"

# ── уборка после nginx-версии ──
if [[ $nginx_stopped -eq 1 ]]; then
    rm -f /etc/nginx/sites-enabled/blinvpn-panel.conf /etc/nginx/sites-enabled/blinvpn-panel-acme.conf
    mv -f /etc/nginx/sites-available/blinvpn-panel.conf /etc/nginx/sites-available/blinvpn-panel.conf.migrated-to-caddy 2>/dev/null || true
    if command -v certbot >/dev/null 2>&1 && [[ -d "/etc/letsencrypt/live/${PANEL_DOMAIN}" ]]; then
        certbot delete --cert-name "$PANEL_DOMAIN" --non-interactive >/dev/null 2>&1 || true
    fi
fi

# ── старые релизы ──
ls -1dt "$WWW_ROOT"/releases/*/ 2>/dev/null | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
    [[ "$(readlink -f "$old")" == "$(readlink -f "$WWW_ROOT/current")" ]] && continue
    rm -rf "$old"
done

# ── проверка: статика и шлюз до сервера бота ──
code_index="$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -m 15 --resolve "${PANEL_DOMAIN}:${PORT}:127.0.0.1" "${PANEL_URL}/" || true)"
code_api="$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -m 20 --resolve "${PANEL_DOMAIN}:${PORT}:127.0.0.1" "${PANEL_URL}/api/panel/auth/me" || true)"
[[ "$code_index" == "200" ]] || fail "панель не отдаёт index.html (HTTP ${code_index})"
if [[ "$GW_CHECK" == "soft" && "$code_api" != "401" ]]; then
    say "ВНИМАНИЕ: шлюз до API пока не отвечает (HTTP ${code_api}) — настройте шлюз панели в прокси сервера бота по инструкции (proxy/README.txt)"
    echo "OK"
    exit 0
fi
case "$code_api" in
    401) say "шлюз до API работает" ;;
    403) fail "сервер бота отклонил панель по IP (HTTP 403). IP этого сервера для исходящих: $(curl -4 -s -m 8 https://api.ipify.org || echo ?)" ;;
    404) fail "сервер бота не принял шлюз (HTTP 404): чужой IP или секрет — запустите установку на сервере бота ещё раз" ;;
    502|504) fail "не удаётся подключиться к серверу бота ${BOT_IP}:${PORT} по HTTPS (HTTP ${code_api}): фаервол или сертификат" ;;
    *) fail "неожиданный ответ API через шлюз: HTTP ${code_api}" ;;
esac
echo "OK"
