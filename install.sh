#!/usr/bin/env bash
set -Eeuo pipefail

# версия установщика: пункты меню 2–4 работают с кодом в папке проекта — он должен быть той же версии
INSTALLER_VERSION="2026.10.14-4"

GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
RED=$'\033[0;31m'
NC=$'\033[0m'
BOLD=$'\033[1m'
DIM=$'\033[2m'

log_info() { echo -e "${CYAN}$1${NC}"; }
log_warn() { echo -e "${YELLOW}$1${NC}"; }
log_success() { echo -e "${GREEN}$1${NC}"; }
log_error() { echo -e "${RED}$1${NC}" >&2; }

on_error() {
    log_error "Ошибка на строке $1. Установка прервана."
}
trap 'on_error $LINENO' ERR

# utf-8 локаль: иначе backspace ломает русские буквы в .env
if locale -a 2>/dev/null | grep -qiE '^(C|en_US)\.utf-?8$'; then
    export LC_ALL="$(locale -a 2>/dev/null | grep -iE '^C\.utf-?8$' | head -n1)"
    [[ -z "$LC_ALL" ]] && export LC_ALL="$(locale -a 2>/dev/null | grep -iE '^en_US\.utf-?8$' | head -n1)"
fi

# битые utf-8, \r и пробелы по краям
clean_input() {
    local v="$1"
    if command -v iconv >/dev/null 2>&1; then
        v="$(printf '%s' "$v" | iconv -f UTF-8 -t UTF-8 -c 2>/dev/null || printf '%s' "$v")"
    fi
    v="${v//$'\r'/}"
    v="${v#"${v%%[![:space:]]*}"}"
    v="${v%"${v##*[![:space:]]}"}"
    printf '%s' "$v"
}

prompt() {
    local message="$1"
    local __var="$2"
    local value
    read -r -p "$message" value < /dev/tty
    value="$(clean_input "$value")"
    printf -v "$__var" '%s' "$value"
}

# prompt с проверкой по regex; пустой ок при allow_empty=1
prompt_valid() {
    local message="$1" __var="$2" regex="$3" hint_text="$4" allow_empty="${5:-0}"
    local value
    while true; do
        read -r -p "$message" value < /dev/tty
        value="$(clean_input "$value")"
        if [[ -z "$value" && "$allow_empty" == "1" ]]; then break; fi
        if [[ "$value" =~ $regex ]]; then break; fi
        log_warn "     ✗ ${hint_text}. Попробуйте ещё раз (проверьте раскладку — нужны латинские буквы)."
    done
    printf -v "$__var" '%s' "$value"
}

# .env в utf-8; битые байты вырезаем (бэкап сохраняем)
ensure_env_utf8() {
    local f="${1:-.env}"
    [[ -f "$f" ]] || return 0
    command -v iconv >/dev/null 2>&1 || return 0
    if iconv -f UTF-8 -t UTF-8 "$f" >/dev/null 2>&1; then
        return 0
    fi
    local backup="${f}.broken-$(date +%Y%m%d-%H%M%S)"
    cp "$f" "$backup"
    log_warn "⚠️  В ${f} есть повреждённые символы (обычно — русская буква, стёртая наполовину при вводе)."
    log_warn "   Исходный файл сохранён: ${backup}. Проблемные строки:"
    local n=0 line
    while IFS= read -r line || [[ -n "$line" ]]; do
        n=$((n + 1))
        if ! printf '%s' "$line" | iconv -f UTF-8 -t UTF-8 >/dev/null 2>&1; then
            # значение не печатаем: там могут быть секреты
            printf '     строка %s: %s\n' "$n" "$(printf '%s' "${line%%=*}" | iconv -f UTF-8 -t UTF-8 -c 2>/dev/null)"
        fi
    done < "$f"
    iconv -f UTF-8 -t UTF-8 -c "$f" > "${f}.tmp" && cat "${f}.tmp" > "$f" && rm -f "${f}.tmp"
    chmod 600 "$f" 2>/dev/null || true
    log_warn "   Битые символы удалены. Проверьте значения в этих строках: sudo nano ${f}"
}

confirm() {
    local message="$1"
    local reply
    read -r -n1 -p "$message" reply < /dev/tty || true
    echo
    [[ "$reply" =~ ^[Yy]$ ]]
}

sanitize_domain() {
    local input="$1"
    echo "$input" \
        | sed -e 's%^https\?://%%' -e 's%/.*$%%' \
        | tr -cd 'A-Za-z0-9.-' \
        | tr '[:upper:]' '[:lower:]'
}

get_server_ip() {
    local ipv4_re='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
    local ip
    for url in \
        "https://api.ipify.org" \
        "https://ifconfig.co/ip" \
        "https://ipv4.icanhazip.com"; do
        ip=$(curl -fsS "$url" 2>/dev/null | tr -d '\r\n\t ')
        if [[ $ip =~ $ipv4_re ]]; then
            echo "$ip"
            return 0
        fi
    done
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [[ $ip =~ $ipv4_re ]]; then
        echo "$ip"
    fi
}

resolve_domain_ip() {
    local domain="$1"
    local ipv4_re='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
    local ip
    ip=$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | head -n1)
    if [[ $ip =~ $ipv4_re ]]; then
        echo "$ip"
        return 0
    fi
    if command -v dig >/dev/null 2>&1; then
        ip=$(dig +short A "$domain" 2>/dev/null | grep -E "$ipv4_re" | head -n1)
        if [[ $ip =~ $ipv4_re ]]; then
            echo "$ip"
            return 0
        fi
    fi
    if command -v nslookup >/dev/null 2>&1; then
        ip=$(nslookup -type=A "$domain" 2>/dev/null | awk '/^Address: /{print $2; exit}')
        if [[ $ip =~ $ipv4_re ]]; then
            echo "$ip"
            return 0
        fi
    fi
    return 1
}

ensure_packages() {
    log_info "\nШаг 1: установка системных зависимостей"
    declare -A packages=(
        [git]='git'
        [docker]='docker.io'
        [curl]='curl'
        [dig]='dnsutils'
        [rsync]='rsync'
    )
    local missing=()
    for cmd in "${!packages[@]}"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            log_warn "«$cmd» не найден — устанавливаем пакет «${packages[$cmd]}»..."
            missing+=("${packages[$cmd]}")
        else
            log_success "✔ $cmd уже установлен."
        fi
    done
    if ((${#missing[@]})); then
        export DEBIAN_FRONTEND=noninteractive
        export DEBCONF_NONINTERACTIVE_SEEN=true
        sudo apt-get update
        sudo apt-get install -y --no-install-recommends "${missing[@]}"
        unset DEBIAN_FRONTEND
        unset DEBCONF_NONINTERACTIVE_SEEN
    else
        log_info "Все необходимые пакеты уже установлены."
    fi
}

# docker compose v2; старый 1.29 несовместим с новым docker
ensure_compose() {
    if sudo docker compose version >/dev/null 2>&1; then
        log_success "✔ Docker Compose v2 установлен."
        return 0
    fi
    log_warn "Docker Compose v2 не найден — устанавливаем…"
    export DEBIAN_FRONTEND=noninteractive
    sudo apt-get update -qq || true
    sudo apt-get install -y --no-install-recommends docker-compose-v2 2>/dev/null \
        || sudo apt-get install -y --no-install-recommends docker-compose-plugin 2>/dev/null || true
    unset DEBIAN_FRONTEND
    if ! sudo docker compose version >/dev/null 2>&1; then
        # fallback: официальный бинарник плагина
        local arch; arch="$(uname -m)"; [[ "$arch" == "aarch64" ]] && arch="aarch64" || arch="x86_64"
        sudo mkdir -p /usr/local/lib/docker/cli-plugins
        sudo curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${arch}" \
            -o /usr/local/lib/docker/cli-plugins/docker-compose && sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose || true
    fi
    if sudo docker compose version >/dev/null 2>&1; then
        log_success "✔ Docker Compose v2 установлен."
    elif command -v docker-compose >/dev/null 2>&1; then
        log_warn "Не удалось поставить Compose v2 — работаю через старый docker-compose."
    else
        log_error "Docker Compose не установлен. Установите пакет docker-compose-v2 и запустите снова."
        exit 1
    fi
}

# v2 если есть, иначе docker-compose
dc() {
    if sudo docker compose version >/dev/null 2>&1; then
        sudo docker compose "$@"
    else
        sudo docker-compose "$@"
    fi
}

# сборка с повторами (сеть/pypi); до остановки контейнеров
dc_build() {
    local i
    for i in 1 2 3; do
        if dc build "$@"; then
            return 0
        fi
        if [[ $i -lt 3 ]]; then
            log_warn "Сборка не удалась (попытка ${i} из 3). Обычно это обрыв связи с pypi.org или npm — повторяю через 20 секунд…"
            sleep 20
        fi
    done
    log_error "Сборка не удалась 3 раза подряд. Работающие контейнеры не тронуты."
    hint "Если сервер плохо достаёт до pypi.org / npm, укажите зеркала в ${PWD}/.env (строки PIP_INDEX_URL=… и NPM_REGISTRY=…) и запустите установку ещё раз."
    return 1
}

# ═══════════════ Caddy: reverse proxy + автоматический HTTPS ═══════════════
CADDY_MAIN="/etc/caddy/Caddyfile"
CADDY_SITES="/etc/caddy/sites"
CADDY_SITE="${CADDY_SITES}/blinvpn.caddy"
CADDY_MARKER="# managed-by-blinvpn"
CADDY_MIN_VERSION="2.7.0"
CADDY_FALLBACK_VERSION="2.8.4"

# ── порт HTTPS (по умолчанию 443) ──
HTTPS_PORT="${HTTPS_PORT:-443}"
# порты, занятые сервисами BatmanVPN на 127.0.0.1 (+80 для сертификатов/редиректа)
RESERVED_PORTS="80 3000 4100 5000 8000 9741 9742"

# https://host или https://host:порт
pub_url() { if [[ "$HTTPS_PORT" == "443" ]]; then printf 'https://%s' "$1"; else printf 'https://%s:%s' "$1" "$HTTPS_PORT"; fi; }
# адрес сайта для Caddy: host или host:порт
site_addr() { if [[ "$HTTPS_PORT" == "443" ]]; then printf '%s' "$1"; else printf '%s:%s' "$1" "$HTTPS_PORT"; fi; }

load_https_port() {
    local p
    p="$(get_env_var HTTPS_PORT .env 2>/dev/null || true)"
    HTTPS_PORT="${p:-443}"
}

# спросить порт HTTPS; Enter — 443
ask_https_port() {
    local p
    while true; do
        prompt_valid "Порт HTTPS для сайта и панели (Enter = ${1:-443}): " p '^[0-9]{1,5}$' "Порт — число" 1
        p="${p:-${1:-443}}"
        if (( p < 1 || p > 65535 )); then log_warn "Порт должен быть от 1 до 65535."; continue; fi
        if [[ " $RESERVED_PORTS " == *" $p "* ]]; then log_warn "Порт ${p} занят сервисами BatmanVPN, выберите другой."; continue; fi
        break
    done
    HTTPS_PORT="$p"
    if [[ "$p" != "443" ]]; then
        log_warn "Порт ${p}: адреса будут вида https://домен:${p}"
        hint "Порт 80 всё равно должен быть свободен и открыт — через него Caddy получает сертификат."
        if [[ "$p" != "8443" && "$p" != "88" ]]; then
            hint "ЮKassa шлёт уведомления только на 443 или 8443, Telegram webhook — только на 443/80/88/8443. С этим портом оплаты через ЮKassa не подтвердятся автоматически."
            confirm "Всё равно использовать порт ${p}? (y/n): " || { ask_https_port "$@"; return; }
        fi
    fi
}

# кто держит порт 80 и порт HTTPS
_port_owners() {
    sudo ss -ltnpH 2>/dev/null | awk -v p="$HTTPS_PORT" '$4 ~ ("[:.](80|" p ")$") {print "   " $4 "  " $6}' || true
}

_ver_ge() { [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]; }

caddy_version() { caddy version 2>/dev/null | awk '{print $1}' | sed 's/^v//'; }

# официальный apt-репозиторий Caddy; если недоступен — бинарник с GitHub (с проверкой sha512)
install_caddy() {
    local v
    v="$(caddy_version || true)"
    if [[ -n "$v" ]] && _ver_ge "$v" "$CADDY_MIN_VERSION"; then
        log_success "✔ Caddy ${v} установлен."
        return 0
    fi
    log_info "Установка Caddy..."
    export DEBIAN_FRONTEND=noninteractive
    if sudo apt-get install -y --no-install-recommends debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null 2>&1 \
        && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
        && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null \
        && sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list \
        && sudo apt-get update >/dev/null 2>&1 \
        && sudo apt-get install -y caddy >/dev/null 2>&1; then
        :
    else
        log_warn "Репозиторий Caddy недоступен — ставлю бинарник с GitHub."
        sudo rm -f /etc/apt/sources.list.d/caddy-stable.list
        _install_caddy_binary || { unset DEBIAN_FRONTEND; return 1; }
    fi
    unset DEBIAN_FRONTEND
    v="$(caddy_version || true)"
    if [[ -z "$v" ]] || ! _ver_ge "$v" "$CADDY_MIN_VERSION"; then
        log_error "Нужен Caddy ≥ ${CADDY_MIN_VERSION}, установлен: ${v:-нет}."
        return 1
    fi
    log_success "✔ Caddy ${v} установлен."
}

_install_caddy_binary() {
    local arch ver="$CADDY_FALLBACK_VERSION" tmp base
    case "$(uname -m)" in
        x86_64|amd64) arch=amd64 ;;
        aarch64|arm64) arch=arm64 ;;
        *) log_error "Архитектура $(uname -m) не поддерживается."; return 1 ;;
    esac
    tmp="$(mktemp -d)"
    base="https://github.com/caddyserver/caddy/releases/download/v${ver}"
    if ! curl -fsSL -o "$tmp/caddy.tgz" "${base}/caddy_${ver}_linux_${arch}.tar.gz" \
       || ! curl -fsSL -o "$tmp/sums.txt" "${base}/caddy_${ver}_checksums.txt"; then
        rm -rf "$tmp"; log_error "Не удалось скачать Caddy."; return 1
    fi
    local want got
    want="$(awk -v f="caddy_${ver}_linux_${arch}.tar.gz" '$2==f {print $1}' "$tmp/sums.txt")"
    got="$(sha512sum "$tmp/caddy.tgz" | awk '{print $1}')"
    if [[ -z "$want" || "$want" != "$got" ]]; then
        rm -rf "$tmp"; log_error "Контрольная сумма Caddy не совпала — установка остановлена."; return 1
    fi
    tar -xzf "$tmp/caddy.tgz" -C "$tmp" caddy
    sudo install -m 755 -o root -g root "$tmp/caddy" /usr/bin/caddy
    rm -rf "$tmp"
    getent group caddy >/dev/null || sudo groupadd --system caddy
    id caddy >/dev/null 2>&1 || sudo useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
    sudo mkdir -p /etc/caddy
    sudo tee /etc/systemd/system/caddy.service >/dev/null <<'UNIT'
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
    sudo systemctl daemon-reload
}

# главный Caddyfile: глобальные опции + сайты из /etc/caddy/sites/*.caddy
caddy_prepare_main() {
    local email="$1"
    local email_re='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    if [[ ! "$email" =~ $email_re ]]; then
        log_error "Некорректный email для Let's Encrypt: ${email}"
        return 1
    fi
    sudo mkdir -p "$CADDY_SITES"
    if [[ -s "$CADDY_MAIN" ]] && ! sudo grep -qF "$CADDY_MARKER" "$CADDY_MAIN" \
       && ! sudo grep -q 'root \* /usr/share/caddy' "$CADDY_MAIN"; then
        log_error "В ${CADDY_MAIN} уже есть чужая конфигурация Caddy."
        hint "Перенесите свои сайты в ${CADDY_SITES}/<имя>.caddy (без глобального блока { }) и удалите ${CADDY_MAIN}, затем запустите установку снова."
        return 1
    fi
    local tmp; tmp="$(mktemp)"
    cat > "$tmp" <<EOF
${CADDY_MARKER}
# Главный файл Caddy. Сайты — в ${CADDY_SITES}/*.caddy (BatmanVPN: blinvpn.caddy).
{
	email ${email}
	servers {
		protocols h1 h2
	}
}

import ${CADDY_SITES}/*.caddy
EOF
    sudo install -m 644 -o root -g root "$tmp" "$CADDY_MAIN"
    rm -f "$tmp"
}

# освободить 80/443 от нашего старого nginx; чужие сайты в nginx — стоп
free_ports_for_caddy() {
    NGINX_STOPPED_BY_US=0
    if command -v nginx >/dev/null 2>&1 && sudo systemctl is-active --quiet nginx; then
        local others
        others="$(ls -1 /etc/nginx/sites-enabled/ 2>/dev/null | grep -vxE "default|${PROJECT_DIR}\.conf|blinvpn-acme\.conf" || true)"
        others+="$(ls -1 /etc/nginx/conf.d/*.conf 2>/dev/null | sed 's#.*/##' | tr '\n' ' ' || true)"
        if [[ -n "${others// /}" ]]; then
            log_error "На сервере nginx обслуживает другие сайты: ${others}"
            hint "Caddy и nginx не могут одновременно занимать порты 80/${HTTPS_PORT}. Перенесите эти сайты в Caddy или на другой сервер."
            return 1
        fi
        log_warn "Останавливаю nginx (его место займёт Caddy)…"
        sudo systemctl stop nginx
        sudo systemctl disable nginx >/dev/null 2>&1 || true
        NGINX_STOPPED_BY_US=1
    fi
    local owners
    owners="$(_port_owners | grep -v '"caddy"' || true)"
    if [[ -n "$owners" ]]; then
        log_error "Порты 80/${HTTPS_PORT} заняты другим процессом:"
        echo "$owners"
        hint "Остановите его (например: sudo systemctl disable --now apache2) и запустите установку снова."
        return 1
    fi
}

# вернуть nginx, если переход на Caddy не удался
rollback_to_nginx() {
    if [[ "${NGINX_STOPPED_BY_US:-0}" == "1" ]]; then
        log_warn "Возвращаю nginx…"
        sudo systemctl stop caddy >/dev/null 2>&1 || true
        sudo systemctl enable nginx >/dev/null 2>&1 || true
        sudo systemctl start nginx || true
    fi
}

# применить файл сайта: проверка конфигурации, при ошибке — откат
caddy_apply_site() {
    local src="$1" backup=""
    sudo mkdir -p "$CADDY_SITES"
    if sudo test -f "$CADDY_SITE"; then
        backup="$(mktemp)"; sudo cp -p "$CADDY_SITE" "$backup"
    fi
    sudo install -m 640 -o root -g caddy "$src" "$CADDY_SITE"
    local vlog; vlog="$(mktemp)"
    if ! sudo caddy validate --adapter caddyfile --config "$CADDY_MAIN" >"$vlog" 2>&1; then
        sed 's/^/   /' "$vlog" | tail -n 15
        if [[ -n "$backup" ]]; then sudo install -m 640 -o root -g caddy "$backup" "$CADDY_SITE"; else sudo rm -f "$CADDY_SITE"; fi
        rm -f "$backup" "$vlog"
        log_error "Конфигурация Caddy не прошла проверку — откатил."
        return 1
    fi
    rm -f "$backup" "$vlog"
    sudo systemctl enable caddy >/dev/null 2>&1 || true
    if sudo systemctl is-active --quiet caddy; then
        sudo systemctl reload caddy || sudo systemctl restart caddy
    else
        sudo systemctl start caddy
    fi
    log_success "✔ конфигурация Caddy применена."
}

# дождаться валидного сертификата (Caddy выпускает его сам)
caddy_wait_https() {
    local d i
    for d in "$@"; do
        log_info "Жду сертификат для ${d}…"
        for i in $(seq 1 45); do
            if curl -s --noproxy "*" -o /dev/null -m 5 --resolve "${d}:${HTTPS_PORT}:127.0.0.1" "$(pub_url "$d")/" 2>/dev/null; then
                log_success "✔ HTTPS для ${d} работает."
                continue 2
            fi
            sleep 3
        done
        log_error "Caddy не получил сертификат для ${d}."
        sudo journalctl -u caddy --no-pager -n 60 2>/dev/null | grep -iE 'error|acme|challenge|certificate' | tail -n 8 | sed 's/^/   /' || true
        hint "Проверьте: A-запись ${d} указывает на этот сервер, порты 80 и ${HTTPS_PORT} открыты, домен не проксируется через Cloudflare."
        return 1
    done
}

# A-запись домена должна вести на этот сервер (иначе Caddy не получит сертификат)
dns_preflight() {
    local d="$1" my_ip dip
    my_ip="$(get_server_ip || true)"
    dip="$(resolve_domain_ip "$d" || true)"
    if [[ -z "$dip" ]]; then
        log_warn "У ${d} нет A-записи — сертификат не выпустится."
        confirm "Продолжить? (y/n): " || return 1
    elif [[ -n "$my_ip" && "$dip" != "$my_ip" ]]; then
        log_warn "A-запись ${d} → ${dip}, а IP сервера — ${my_ip}."
        confirm "Продолжить? (y/n): " || return 1
    fi
}

# заголовки к API: реальный IP клиента ставит только наш прокси (подделку CF-/True-Client-IP режем)
_caddy_api_headers() {
    cat <<'EOF'
			header_up X-Real-IP {client_ip}
			header_up X-Forwarded-For {client_ip}
			header_up -CF-Connecting-IP
			header_up -True-Client-IP
			header_up -X-Panel-Gateway
EOF
}

# порт не 443: проверка TLS-ALPN идёт только на 443 (там может быть, например, Xray) — сертификат через HTTP-01 на порту 80
_caddy_tls_block() {
    [[ "$HTTPS_PORT" == "443" ]] && return 0
    printf '\ttls {\n\t\tissuer acme {\n\t\t\tdisable_tlsalpn_challenge\n\t\t}\n\t}\n'
}

# с двумя последними аргументами панель живёт на отдельном сервере: здесь её нет,
# а /api/panel открыт только для IP сервера панели с секретным заголовком.
# render_bot_caddy <файл> <miniapp> <panel> [<ip_сервера_панели> <секрет_шлюза>]
render_bot_caddy() {
    local tmp="$1" miniapp_domain="$2" panel_domain="$3" remote_ip="${4:-}" gw_secret="${5:-}"
    local remote=0
    [[ -n "$remote_ip" && -n "$gw_secret" ]] && remote=1

    local gw_block
    if [[ $remote -eq 1 ]]; then
        gw_block="		# /api/panel — только шлюз панели (отдельный сервер ${remote_ip}) с секретным заголовком
		@panel_gw {
			path /api/panel /api/panel/*
			remote_ip ${remote_ip}
			header X-Panel-Gateway ${gw_secret}
		}
		handle @panel_gw {
			reverse_proxy 127.0.0.1:8000 {
				# IP клиента передаёт шлюз (доверяем только ему — см. remote_ip выше)
				header_up X-Real-IP {http.request.header.X-Real-IP}
				header_up X-Forwarded-For {http.request.header.X-Real-IP}
				header_up -CF-Connecting-IP
				header_up -True-Client-IP
				header_up -X-Panel-Gateway
				flush_interval -1
			}
		}"
    else
        gw_block="		# /api/panel только на домене панели"
    fi

    local tls_block; tls_block="$(_caddy_tls_block)"
    ( umask 077; cat > "$tmp" <<EOF
# BatmanVPN — сгенерировано install.sh (правки затрутся при обновлении)

(blin_sec) {
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
		defer
	}
}

# мини-приложение + api + webhooks
$(site_addr "$miniapp_domain") {
	import blin_sec
${tls_block}
	# вложения поддержки: до 50 мб
	request_body {
		max_size 55MB
	}
	route {
		# /api/internal недоступен снаружи
		handle /api/internal* {
			respond 404
		}
${gw_block}
		handle /api/panel* {
			respond 404
		}
		handle /api* {
			reverse_proxy 127.0.0.1:8000 {
$(_caddy_api_headers)
			}
		}
		handle /yookassa* {
			reverse_proxy 127.0.0.1:5000 {
$(_caddy_api_headers)
			}
		}
		handle {
			reverse_proxy 127.0.0.1:9741 {
				header_up X-Real-IP {client_ip}
				header_up X-Forwarded-For {client_ip}
			}
		}
	}
}
EOF
    )
    if [[ $remote -eq 0 ]]; then
        cat >> "$tmp" <<EOF

# панель
$(site_addr "$panel_domain") {
	import blin_sec
${tls_block}
	header X-Frame-Options "DENY"
	request_body {
		max_size 55MB
	}
	route {
		handle /api/internal* {
			respond 404
		}
		handle /api* {
			reverse_proxy 127.0.0.1:8000 {
$(_caddy_api_headers)
				flush_interval -1
			}
		}
		handle {
			reverse_proxy 127.0.0.1:9742 {
				header_up X-Real-IP {client_ip}
			}
		}
	}
}
EOF
    fi
}

# configure_caddy <miniapp> <panel> [<ip_сервера_панели> <секрет_шлюза>]
configure_caddy() {
    log_info "\nНастройка Caddy (HTTPS)"
    local tmp; tmp="$(mktemp)"; chmod 600 "$tmp"
    render_bot_caddy "$tmp" "$@"
    if ! caddy_apply_site "$tmp"; then
        rm -f "$tmp"
        return 1
    fi
    rm -f "$tmp"
}

ensure_services() {
    if sudo systemctl is-active --quiet docker; then
        log_success "✔ сервис docker активен."
    else
        log_warn "Сервис docker не запущен — запускаем..."
        sudo systemctl enable docker
        sudo systemctl start docker
    fi
}

# старые сертификаты certbot для наших доменов больше не нужны (Caddy выпускает свои)
cleanup_legacy_certbot() {
    command -v certbot >/dev/null 2>&1 || return 0
    local d
    for d in "$@"; do
        [[ -n "$d" && -d "/etc/letsencrypt/live/${d}" ]] || continue
        sudo certbot delete --cert-name "$d" --non-interactive >/dev/null 2>&1 \
            && log_info "Удалён старый сертификат certbot: ${d}" || true
    done
}

# прокси сервера бота в нужном режиме (панель здесь или на отдельном сервере)
apply_bot_proxy() {
    local mini="$1" panel="$2"
    if panel_is_remote && panel_remote_load; then
        configure_caddy "$mini" "$panel" "$PR_EGRESS_IP" "$PR_SECRET"
    else
        configure_caddy "$mini" "$panel"
    fi
}

# папка для инструкций (ручная настройка прокси на сервере панели)
PROXY_DIR="proxy"

proxy_up() { caddy_proxy_up "$@"; }

# полный подъём прокси: Caddy, главный файл, порты, сайт, сертификаты. При ошибке nginx возвращается.
caddy_proxy_up() {
    local mini="$1" panel="$2" email="$3"
    local -a domains=("$mini")
    panel_is_remote || domains+=("$panel")
    install_caddy || return 1
    caddy_prepare_main "$email" || return 1
    free_ports_for_caddy || return 1
    if ! apply_bot_proxy "$mini" "$panel" || ! caddy_wait_https "${domains[@]}"; then
        rollback_to_nginx
        return 1
    fi
    # переход с nginx завершён: убрать наш старый конфиг и сертификаты certbot
    if [[ -f "$NGINX_CONF" ]]; then
        sudo rm -f "$NGINX_LINK" /etc/nginx/sites-enabled/blinvpn-acme.conf
        sudo mv -f "$NGINX_CONF" "${NGINX_CONF}.migrated-to-caddy" 2>/dev/null || true
        cleanup_legacy_certbot "$mini" "$panel"
        log_success "✔ переход с nginx на Caddy завершён."
    fi
}

section() {
    local title="$1"
    local width=62
    local pad=$(( (width - ${#title} - 2) / 2 ))
    printf '\n'
    printf "${CYAN}╭%s╮${NC}\n" "$(printf '─%.0s' $(seq 1 $width))"
    printf "${CYAN}│${NC}%*s${BOLD}%s${NC}%*s${CYAN}│${NC}\n" \
        $((pad + 1)) "" "$title" $((width - pad - ${#title} - 1)) ""
    printf "${CYAN}╰%s╯${NC}\n" "$(printf '─%.0s' $(seq 1 $width))"
}

step() {
    printf "  ${GREEN}%s${NC}  %s\n" "$1" "$2"
}

hint() {
    printf "     ${DIM}↳ %s${NC}\n" "$1"
}

gen_secret_hex() {
    openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p
}

create_env_file() {
    local domain="$1"
    local panel_domain="$2"
    local email="$3"

    section "Настройка переменных окружения"

    section "Основной Telegram-бот"
    prompt_valid "  ${BOLD}Токен бота${NC}  (основной бот): " TELEGRAM_BOT_TOKEN \
        '^[0-9]{5,}:[A-Za-z0-9_-]{30,}$' "Токен выглядит так: 1234567890:AAH…, его выдаёт @BotFather"
    prompt_valid "  ${BOLD}ID админа${NC}   (ваш Telegram ID): " TELEGRAM_ADMIN_ID \
        '^[0-9]{3,15}$' "ID — только цифры (узнать можно у @userinfobot)"
    prompt_valid "  ${BOLD}Username бота${NC} (без @, по умолч. blinvpn_bot): " BOT_USERNAME_INPUT \
        '^@?[A-Za-z0-9_]{3,32}$' "Username — латиница, цифры и _" 1
    BOT_USERNAME="${BOT_USERNAME_INPUT:-blinvpn_bot}"
    BOT_USERNAME="${BOT_USERNAME#@}"

    # форум-группа уведомлений: в панели (настройки → форум)

    section "Remnawave · панель VPN"
    prompt_valid "  ${BOLD}Panel URL${NC}  (по умолч. http://localhost:3000): " REMWAVE_PANEL_URL_INPUT \
        '^https?://[A-Za-z0-9._:/-]+$' "Адрес вида https://panel.example.com" 1
    REMWAVE_PANEL_URL="${REMWAVE_PANEL_URL_INPUT:-http://localhost:3000}"
    REMWAVE_PANEL_URL="${REMWAVE_PANEL_URL%/}"
    prompt_valid "  ${BOLD}API Token${NC}  (из панели Remnawave): " REMWAVE_API_KEY \
        '^[!-~]{10,}$' "Токен — латинские символы без пробелов (Remnawave → API Tokens)"

    section "Домены ссылок подписки"
    hint "Пусто — ссылка как её отдаёт Remnawave / FurkVPN. Иначе домен в ссылке заменится на ваш, путь останется."
    prompt_valid "  ${BOLD}Домен обычного VPN${NC} (например sub.example.com, Enter — не менять): " VPN_SUB_DOMAIN \
        '^[A-Za-z0-9.-]+(:[0-9]{1,5})?$' "Только домен, без https:// и пути" 1
    prompt_valid "  ${BOLD}Домен белых списков${NC} (Enter — не менять): " WHITELIST_SUB_DOMAIN \
        '^[A-Za-z0-9.-]+(:[0-9]{1,5})?$' "Только домен, без https:// и пути" 1

    section "Белые списки · FurkVPN"
    hint "Ключ партнёра из @VPNpartenrsbot (карточка приложения). Пусто — белые списки будут скрыты, ключ можно добавить в .env позже."
    prompt_valid "  ${BOLD}FURK API-ключ${NC} (Enter — пропустить): " FURK_API_KEY \
        '^[!-~]{10,}$' "Ключ — латинские символы без пробелов" 1

    TELEGRAM_WEBHOOK_SECRET="$(gen_secret_hex)"
    PANEL_SETUP_TOKEN="$(gen_secret_hex)"
    INTERNAL_API_SECRET="$(gen_secret_hex)"
    MONITOR_SECRET_KEY="$(gen_secret_hex)"

    # .env с секретами: chmod 600
    ( umask 077; : > .env )
    chmod 600 .env
    cat > .env <<EOF
# бот telegram
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_ADMIN_ID=${TELEGRAM_ADMIN_ID}
BOT_USERNAME=${BOT_USERNAME}
VITE_BOT_USERNAME=${BOT_USERNAME}

# форум-группа: в панели (настройки → форум)

# панель remnawave
REMWAVE_PANEL_URL=${REMWAVE_PANEL_URL}
REMWAVE_API_KEY=${REMWAVE_API_KEY}

# домены ссылок подписки: путь берётся из Remnawave / FurkVPN, домен — отсюда (пусто — без замены)
# пример: Remnawave отдала https://domain1.com/hIeb, VPN_SUB_DOMAIN=domain2.com → пользователь получит https://domain2.com/hIeb
VPN_SUB_DOMAIN=${VPN_SUB_DOMAIN:-}
WHITELIST_SUB_DOMAIN=${WHITELIST_SUB_DOMAIN:-}

# белые списки: FurkVPN Partner API v2 (https://api.furkvpn.com/docs/v2)
FURK_API_KEY=${FURK_API_KEY}
FURK_BASE_URL=https://api.furkvpn.com/api/v2

# платежи: ЮKassa / telegram stars (ключи позже в .env)

# ЮKassa: shopId и секретный ключ из личного кабинета (Интеграция → Ключи API)
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=
# чеки 54-ФЗ через ЮKassa: 1 — отправлять чек (нужна почта покупателя или YOOKASSA_RECEIPT_EMAIL)
YOOKASSA_RECEIPT=0
YOOKASSA_RECEIPT_EMAIL=
# ставка НДС в чеке (1 — без НДС) и система налогообложения (пусто — как в кабинете)
YOOKASSA_VAT_CODE=1
YOOKASSA_TAX_SYSTEM_CODE=
# принимать уведомления только с IP ЮKassa (1 — да; статус всё равно перепроверяется через API)
YOOKASSA_CHECK_IP=0
# return url после оплаты задавать не нужно

# telegram stars: bot = polling, webhook = /api/telegram/webhook
TELEGRAM_STARS_DELIVERY=bot

# почта: в панели → настройки → почта
MAIL_ENABLED=0

# публичные url
MINIAPP_URL=$(pub_url "$domain")
PANEL_URL=$(pub_url "$panel_domain")
WEBHOOK_URL=$(pub_url "$domain")
API_URL=$(pub_url "$domain")/api
# порт HTTPS (Caddy); смена — install.sh → «Сменить порт»
HTTPS_PORT=${HTTPS_PORT}

# порты сервисов
API_PORT=8000
WEBHOOK_PORT=5000
MINIAPP_PORT=9741
PANEL_PORT=9742

# путь к базе
DB_PATH=data/data.db

# безопасность
ENV=production
CORS_ORIGINS=$(pub_url "$domain"),$(pub_url "$panel_domain"),https://web.telegram.org
# лендинг в cors не добавляем
TELEGRAM_INITDATA_MAX_AGE=86400
TELEGRAM_WEBHOOK_SECRET=${TELEGRAM_WEBHOOK_SECRET}
PANEL_SETUP_TOKEN=${PANEL_SETUP_TOKEN}
INTERNAL_API_SECRET=${INTERNAL_API_SECRET}
# шифрование ключей нод мониторинга (не менять после выдачи)
MONITOR_SECRET_KEY=${MONITOR_SECRET_KEY}
MINIAPP_ALLOW_UNAUTH=0

# ssl / домены
SSL_EMAIL=${email}
MINIAPP_DOMAIN=${domain}
PANEL_DOMAIN=${panel_domain}
WEBHOOK_DOMAIN=${domain}
EOF

    # .env с секретами: chmod 600
    chmod 600 .env 2>/dev/null || true
    log_success "✔ Файл .env создан (права 600)."
    log_warn "\n⚠️  Логин и пароль панели будут показаны ниже, после запуска (один раз)."
    log_warn "⚠️  Платежи (ЮKassa, Telegram Stars) — ключи в .env."
}

# stars: bot polling; webhook только при TELEGRAM_STARS_DELIVERY=webhook
register_telegram_webhook() {
    local bot_token="$1"
    local domain="$2"

    if [[ "${TELEGRAM_STARS_DELIVERY:-bot}" == "bot" ]]; then
        log_info "\nTelegram Stars: режим bot (polling) — webhook на API не регистрируется."
        hint "Для webhook-режима: TELEGRAM_STARS_DELIVERY=webhook в .env"
        return 0
    fi

    if [[ -z "$bot_token" ]]; then
        log_warn "TELEGRAM_BOT_TOKEN не задан — регистрация webhook пропущена."
        return 0
    fi

    local webhook_url; webhook_url="$(pub_url "$domain")/api/telegram/webhook"
    case "$HTTPS_PORT" in 443|80|88|8443) ;; *)
        log_warn "Telegram принимает webhook только на портах 443/80/88/8443 — с портом ${HTTPS_PORT} регистрация не пройдёт."
        hint "Оставьте TELEGRAM_STARS_DELIVERY=bot (polling) — с ним порт не важен."
        return 0 ;;
    esac
    local allowed_updates='["message","callback_query","pre_checkout_query","shipping_query"]'
    local secret_token
    secret_token="$(get_env_var TELEGRAM_WEBHOOK_SECRET .env 2>/dev/null || true)"
    if [[ -z "$secret_token" ]]; then
        secret_token="$(gen_secret_hex)"
        set_env_var TELEGRAM_WEBHOOK_SECRET "$secret_token" .env 2>/dev/null || true
    fi

    log_info "\nРегистрация Telegram webhook (Stars)..."
    log_info "  URL: ${webhook_url}"

    local response http_code body
    local payload
    payload=$(printf '{"url":"%s","allowed_updates":%s,"secret_token":"%s"}' \
        "$webhook_url" "$allowed_updates" "$secret_token")
    response=$(curl -s -w "\n%{http_code}" -X POST \
        "https://api.telegram.org/bot${bot_token}/setWebhook" \
        -H "Content-Type: application/json" \
        -d "${payload}" \
        --max-time 15 2>/dev/null || true)

    body=$(echo "$response" | head -n -1)
    http_code=$(echo "$response" | tail -n1)

    if echo "$body" | grep -q '"ok":true'; then
        log_success "✔ Telegram webhook зарегистрирован."
    else
        log_warn "Не удалось зарегистрировать Telegram webhook (HTTP ${http_code})."
        log_warn "  Ответ: ${body}"
    fi
}

print_payment_webhooks() {
    local domain="$1"
    printf "\n"
    printf "${GREEN}───────────────────────────────────────────────────────────────${NC}\n"
    printf "${BOLD}  Payment webhooks${NC}\n"
    printf "${GREEN}───────────────────────────────────────────────────────────────${NC}\n"
    printf "  ЮKassa:           ${YELLOW}%s/yookassa${NC}\n" "$(pub_url "$domain")"
    printf "                    события: payment.succeeded, payment.canceled\n"
    printf "  Telegram Stars:   ${YELLOW}bot polling${NC} (или /api/telegram/webhook)\n"
    printf "\n"
}

get_env_var() {
    local key="$1"
    local file="${2:-.env}"
    [[ -f "$file" ]] || return 1
    local line
    line=$(grep -E "^${key}=" "$file" | tail -n1) || true
    [[ -n "$line" ]] || return 1
    printf '%s' "${line#*=}"
}

set_env_var() {
    local key="$1"
    local val="$2"
    local file="${3:-.env}"
    local esc="$val"
    esc=${esc//\\/\\\\}
    esc=${esc//&/\\&}
    esc=${esc//|/\\|}
    if grep -qE "^${key}=" "$file"; then
        sed -i "s|^${key}=.*|${key}=${esc}|" "$file"
    else
        printf '%s=%s\n' "$key" "$val" >> "$file"
    fi
}

ensure_env_var() {
    local key="$1"
    local val="$2"
    local file="${3:-.env}"
    local cur=""
    cur="$(get_env_var "$key" "$file" 2>/dev/null || true)"
    if [[ -z "$cur" ]]; then
        set_env_var "$key" "$val" "$file"
        return 0
    fi
    return 1
}

build_cors_origins_from_env() {
    local file="${1:-.env}"
    local origins=()
    local u key
    for key in MINIAPP_URL PANEL_URL; do
        u="$(get_env_var "$key" "$file" 2>/dev/null || true)"
        u="${u%/}"
        if [[ -n "$u" ]]; then
            origins+=("$u")
        fi
    done
    origins+=("https://web.telegram.org")
    local IFS=,
    printf '%s' "${origins[*]}"
}

fix_container_data_permissions() {
    mkdir -p data src/monitoring/logs
    # контейнер (gid 1000) пишет data; секреты не ослабляем
    chmod 750 data 2>/dev/null || true
    # uid/gid 1000; data/host остаётся root
    local as_root=""
    [ "$(id -u)" -ne 0 ] && as_root="sudo"
    $as_root find data src/monitoring/logs -path data/host -prune -o -exec chown -h 1000:1000 {} + 2>/dev/null || true
    $as_root find data src/monitoring/logs -path data/host -prune -o ! -type l -exec chmod u+rwX,g+rwX {} + 2>/dev/null || true
    if [ -d data/host ] && [ ! -L data/host ]; then
        $as_root chown -h 0:0 data/host 2>/dev/null || true
        $as_root chmod 755 data/host 2>/dev/null || true
    fi
    # секреты после рекурсивного chmod (ссылки не трогаем)
    [ -d data/dkim ] && [ ! -L data/dkim ] && chmod 700 data/dkim 2>/dev/null || true
    find data/dkim -type f -name '*.private' -exec chmod 600 {} \; 2>/dev/null || true
    [ -f data/data.db ] && [ ! -L data/data.db ] && chmod 640 data/data.db 2>/dev/null || true
    find data/backups -type f -name '*.db' -exec chmod 640 {} \; 2>/dev/null || true
    chmod o-rwx data 2>/dev/null || true
}

migrate_security_update() {
    local file="${1:-.env}"
    if [[ -f "$file" ]]; then
        grep -q '^VPN_SUB_DOMAIN=' "$file" || printf '\n# домены ссылок подписки (пусто — без замены): путь из Remnawave/FurkVPN, домен отсюда\nVPN_SUB_DOMAIN=\nWHITELIST_SUB_DOMAIN=\n' >> "$file"
    fi
    if [[ ! -f "$file" ]]; then
        log_warn "Файл ${file} не найден — миграция пропущена."
        return 0
    fi

    section "Миграция .env"

    local secret
    if ensure_env_var TELEGRAM_INITDATA_MAX_AGE "86400" "$file"; then
        log_info "  + TELEGRAM_INITDATA_MAX_AGE=86400"
    fi

    secret="$(gen_secret_hex)"
    if ensure_env_var TELEGRAM_WEBHOOK_SECRET "$secret" "$file"; then
        log_info "  + TELEGRAM_WEBHOOK_SECRET сгенерирован"
    fi

    secret="$(gen_secret_hex)"
    if ensure_env_var PANEL_SETUP_TOKEN "$secret" "$file"; then
        log_info "  + PANEL_SETUP_TOKEN сгенерирован"
        log_warn "    Сброс пароля панели: https://<панель>/#setup_token=$(get_env_var PANEL_SETUP_TOKEN "$file")&reset=1"
    fi

    secret="$(gen_secret_hex)"
    if ensure_env_var INTERNAL_API_SECRET "$secret" "$file"; then
        log_info "  + INTERNAL_API_SECRET сгенерирован"
    fi

    secret="$(gen_secret_hex)"
    if ensure_env_var MONITOR_SECRET_KEY "$secret" "$file"; then
        log_info "  + MONITOR_SECRET_KEY сгенерирован (шифрование ключей нод мониторинга)"
    fi

    # переход с Platega на ЮKassa: добавить ключи (пустые — заполнить вручную)
    local yk
    for yk in "YOOKASSA_SHOP_ID=" "YOOKASSA_SECRET_KEY=" "YOOKASSA_RECEIPT=0" "YOOKASSA_RECEIPT_EMAIL=" \
              "YOOKASSA_VAT_CODE=1" "YOOKASSA_TAX_SYSTEM_CODE=" "YOOKASSA_CHECK_IP=0"; do
        if ! grep -q "^${yk%%=*}=" "$file"; then
            set_env_var "${yk%%=*}" "${yk#*=}" "$file"
            log_info "  + ${yk%%=*}"
        fi
    done
    if [[ -z "$(get_env_var YOOKASSA_SHOP_ID "$file" 2>/dev/null || true)" ]]; then
        log_warn "  ЮKassa: заполните YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY в .env, уведомления — https://<домен>/yookassa"
    fi

    if ensure_env_var TELEGRAM_STARS_DELIVERY "bot" "$file"; then
        log_info "  + TELEGRAM_STARS_DELIVERY=bot"
    fi

    local cors
    cors="$(get_env_var CORS_ORIGINS "$file" 2>/dev/null || true)"
    if [[ -z "$cors" ]]; then
        cors="$(build_cors_origins_from_env "$file")"
        set_env_var CORS_ORIGINS "$cors" "$file"
        log_info "  + CORS_ORIGINS=${cors}"
    fi

    if ensure_env_var ENV "production" "$file"; then
        log_info "  + ENV=production"
    fi

    local unauth
    unauth="$(get_env_var MINIAPP_ALLOW_UNAUTH "$file" 2>/dev/null || true)"
    if [[ "${unauth,,}" =~ ^(1|true|yes)$ ]]; then
        set_env_var MINIAPP_ALLOW_UNAUTH "0" "$file"
        log_warn "  ! MINIAPP_ALLOW_UNAUTH отключён (нельзя в production)"
    fi

    # устаревшие ключи из прошлых проектов
    for stale in \
        HELEKET_API_URL HELEKET_MERCHANT HELEKET_API_KEY \
        PAYPEAR_RETURN_URL PAYPEAR_WEBHOOK_URL PAYPEAR_API_KEY PAYPEAR_MERCHANT \
        ROLLYPAY_API_URL ROLLYPAY_API_KEY \
        CRYPTOPAY_API_TOKEN CRYPTOPAY_WEBHOOK_URL \
        SSL_PORT; do
        if grep -qE "^${stale}=" "$file" 2>/dev/null; then
            sed -i "/^${stale}=/d" "$file"
            log_info "  − удалён устаревший ${stale}"
        fi
    done

    fix_container_data_permissions
    log_success "✔ миграция завершена."
}

update_env_domains() {
    local miniapp="$1"
    local panel="$2"

    set_env_var MINIAPP_DOMAIN "$miniapp"
    set_env_var WEBHOOK_DOMAIN "$miniapp"
    set_env_var PANEL_DOMAIN   "$panel"

    set_env_var MINIAPP_URL         "$(pub_url "$miniapp")"
    set_env_var WEBHOOK_URL         "$(pub_url "$miniapp")"
    set_env_var API_URL             "$(pub_url "$miniapp")/api"
    set_env_var PANEL_URL           "$(pub_url "$panel")"
    set_env_var CORS_ORIGINS        "$(pub_url "$miniapp"),$(pub_url "$panel"),https://web.telegram.org"
    set_env_var HTTPS_PORT          "$HTTPS_PORT"

    log_success "✔ .env обновлён."
}

replace_domains_flow() {
    section "Замена доменов и перевыпуск сертификатов"

    if [[ ! -f ".env" ]]; then
        log_error "Файл .env не найден в $(pwd)."
        exit 1
    fi

    local cur_miniapp cur_panel cur_email
    cur_miniapp=$(get_env_var MINIAPP_DOMAIN || true)
    cur_panel=$(get_env_var PANEL_DOMAIN || true)
    cur_email=$(get_env_var SSL_EMAIL || true)

    log_info "Текущие домены:"
    printf "  Мини-приложение : ${BOLD}%s${NC}\n" "${cur_miniapp:-—}"
    printf "  Панель          : ${BOLD}%s${NC}\n" "${cur_panel:-—}"
    echo

    if [[ -z "$cur_email" ]]; then
        prompt "Email для Let's Encrypt: " cur_email
        [[ -n "$cur_email" ]] || { log_error "Email обязателен."; exit 1; }
    fi

    local new_miniapp="$cur_miniapp" new_panel="$cur_panel"
    local -a changed=()
    local -a old_domains=()
    local tmp

    if [[ -n "$cur_miniapp" ]] && confirm "Заменить домен мини-приложения (${cur_miniapp})? (y/n): "; then
        prompt "  Новый домен мини-приложения: " tmp
        tmp=$(sanitize_domain "$tmp")
        [[ -n "$tmp" ]] || { log_error "Некорректный домен."; exit 1; }
        new_miniapp="$tmp"; changed+=("$new_miniapp"); old_domains+=("$cur_miniapp")
    fi

    if [[ -n "$cur_panel" ]] && confirm "Заменить домен панели (${cur_panel})? (y/n): "; then
        prompt "  Новый домен панели: " tmp
        tmp=$(sanitize_domain "$tmp")
        [[ -n "$tmp" ]] || { log_error "Некорректный домен."; exit 1; }
        new_panel="$tmp"; changed+=("$new_panel"); old_domains+=("$cur_panel")
    fi

    if ((${#changed[@]} == 0)); then
        log_warn "Ни один домен не выбран. Изменений нет."
        return 0
    fi

    log_info "\nНовые домены:"
    printf "  Мини-приложение : ${BOLD}%s${NC}\n" "$new_miniapp"
    printf "  Панель          : ${BOLD}%s${NC}\n" "$new_panel"
    echo
    confirm "Применить замену? (y/n): " || { log_info "Отменено."; return 0; }

    # панель на отдельном сервере: её сертификат выпускается там, не здесь
    local remote_panel=0
    local -a local_changed=()
    panel_is_remote && panel_remote_load && remote_panel=1
    for tmp in "${changed[@]}"; do
        if [[ $remote_panel -eq 1 && "$tmp" == "$new_panel" && "$tmp" != "$new_miniapp" ]]; then
            panel_remote_check_dns "$tmp" || exit 1
            continue
        fi
        local_changed+=("$tmp")
    done

    local server_ip; server_ip=$(get_server_ip || true)
    if [[ -n "$server_ip" ]]; then
        log_info "IP сервера: ${server_ip}"
        local dip
        for tmp in "${local_changed[@]}"; do
            dip=$(resolve_domain_ip "$tmp" || true)
            if [[ -z "$dip" ]]; then
                log_warn "Не удалось определить A-запись для ${tmp} (нужен ${server_ip})."
                confirm "Продолжить всё равно? (y/n): " || exit 1
            elif [[ "$dip" != "$server_ip" ]]; then
                log_warn "DNS ${tmp} → ${dip} ≠ IP сервера (${server_ip})."
                confirm "Продолжить всё равно? (y/n): " || exit 1
            fi
        done
    fi

    if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q 'Status: active'; then
        log_warn "UFW активен — открываю 80 и ${HTTPS_PORT}."
        sudo ufw allow 80/tcp || true
        sudo ufw allow "${HTTPS_PORT}/tcp" || true
    fi

    section "Caddy и сертификаты"
    # новые домены в .env раньше прокси: proxy_up смотрит на режим панели
    proxy_up "$new_miniapp" "$new_panel" "$cur_email" || exit 1

    section "Обновление .env"
    update_env_domains "$new_miniapp" "$new_panel"

    section "Перезапуск Docker"
    ensure_env_utf8 .env
    dc_build || exit 1
    if [[ -n "$(dc ps -q 2>/dev/null)" ]]; then
        dc down
    fi
    dc up -d

    # панель на отдельном сервере: новый домен панели и/или новый адрес API
    if [[ $remote_panel -eq 1 ]]; then
        dc stop panel >/dev/null 2>&1 || true
        if ! panel_remote_deploy "$new_miniapp" "$new_panel" "$cur_email"; then
            log_warn "Домены заменены, но панель на ${PR_HOST} не обновлена. Повторите: install.sh → «Панель на отдельном сервере»."
        fi
    fi

    if [[ "$new_miniapp" != "$cur_miniapp" ]]; then
        section "Telegram Stars"
        local bot_token; bot_token=$(get_env_var TELEGRAM_BOT_TOKEN || true)
        TELEGRAM_STARS_DELIVERY="$(get_env_var TELEGRAM_STARS_DELIVERY || true)"
        TELEGRAM_STARS_DELIVERY="${TELEGRAM_STARS_DELIVERY:-bot}"
        register_telegram_webhook "$bot_token" "$new_miniapp"
        print_payment_webhooks "$new_miniapp"
    fi

    # старые certbot-сертификаты прежних доменов (если остались от nginx-версии)
    ((${#old_domains[@]})) && cleanup_legacy_certbot "${old_domains[@]}"

    section "Замена доменов завершена"
    printf "  Мини-приложение : ${YELLOW}%s${NC}\n" "$(pub_url "$new_miniapp")"
    printf "  Панель          : ${YELLOW}%s${NC}\n" "$(pub_url "$new_panel")"
    if [[ "$new_miniapp" != "$cur_miniapp" ]]; then
        echo
        log_warn "Обновите Web App URL в @BotFather:"
        printf "     ${CYAN}%s${NC}\n" "$(pub_url "$new_miniapp")"
    fi
}

# host helper: задания панели (xbm и т.п.) через host_runner.py, без сетевых портов
install_host_runner() {
    local unit=/etc/systemd/system/blinvpn-host.service
    command -v python3 >/dev/null 2>&1 || sudo apt-get install -y --no-install-recommends python3 >/dev/null
    sudo tee "$unit" >/dev/null <<UNIT
[Unit]
Description=BatmanVPN host helper (задания панели)
After=docker.service
Wants=docker.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 "${PWD}/src/core/host_runner.py" --project "${PWD}"
Restart=always
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT
    sudo systemctl daemon-reload
    sudo systemctl enable blinvpn-host.service >/dev/null 2>&1 || true
    sudo systemctl restart blinvpn-host.service || log_warn "Не удалось запустить помощник blinvpn-host — мастер XBM в панели будет недоступен."
}

# ═══════════════ панель на отдельном сервере ═══════════════
# Настройки (не в .env — чтобы секрет не попадал в контейнеры): .env.panel-remote, права 600.
PANEL_REMOTE_FILE=".env.panel-remote"
PR_SSH_DIR="${HOME}/.ssh"
PR_KEY="${PR_SSH_DIR}/blinvpn_panel_ed25519"
PR_KNOWN="${PR_SSH_DIR}/blinvpn_panel_known_hosts"
PR_IPV4_RE='^([0-9]{1,3}\.){3}[0-9]{1,3}$'

panel_is_remote() {
    [[ -f "$PANEL_REMOTE_FILE" ]] && [[ -n "$(get_env_var PANEL_REMOTE_HOST "$PANEL_REMOTE_FILE" 2>/dev/null || true)" ]]
}

panel_remote_load() {
    PR_HOST="$(get_env_var PANEL_REMOTE_HOST "$PANEL_REMOTE_FILE" 2>/dev/null || true)"
    PR_PORT="$(get_env_var PANEL_REMOTE_PORT "$PANEL_REMOTE_FILE" 2>/dev/null || true)"
    PR_USER="$(get_env_var PANEL_REMOTE_USER "$PANEL_REMOTE_FILE" 2>/dev/null || true)"
    PR_EGRESS_IP="$(get_env_var PANEL_REMOTE_EGRESS_IP "$PANEL_REMOTE_FILE" 2>/dev/null || true)"
    PR_SECRET="$(get_env_var PANEL_GATEWAY_SECRET "$PANEL_REMOTE_FILE" 2>/dev/null || true)"
    PR_PROXY="$(get_env_var PANEL_REMOTE_PROXY "$PANEL_REMOTE_FILE" 2>/dev/null || true)"
    [[ "$PR_PROXY" == "manual" ]] || PR_PROXY="caddy"
    PR_PORT="${PR_PORT:-22}"
    PR_USER="${PR_USER:-root}"
    [[ -n "$PR_HOST" && -n "$PR_EGRESS_IP" && -n "$PR_SECRET" ]]
}

panel_remote_save() {
    local tmp
    tmp="$(mktemp)"
    chmod 600 "$tmp"
    cat > "$tmp" <<EOF
# панель BatmanVPN на отдельном сервере (заполняет install.sh; не публиковать — тут секрет шлюза)
PANEL_REMOTE_HOST=${PR_HOST}
PANEL_REMOTE_PORT=${PR_PORT}
PANEL_REMOTE_USER=${PR_USER}
PANEL_REMOTE_EGRESS_IP=${PR_EGRESS_IP}
PANEL_GATEWAY_SECRET=${PR_SECRET}
# caddy — установщик ставит Caddy и сертификат на сервер панели; manual — только файлы + инструкция
PANEL_REMOTE_PROXY=${PR_PROXY:-caddy}
EOF
    mv -f "$tmp" "$PANEL_REMOTE_FILE"
    chmod 600 "$PANEL_REMOTE_FILE"
}

# ssh на сервер панели: только наш ключ, только сохранённый отпечаток хоста, только IPv4
_pr_ssh() {
    ssh -i "$PR_KEY" -p "$PR_PORT" \
        -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none \
        -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$PR_KNOWN" \
        -o AddressFamily=inet -o ConnectTimeout=15 \
        -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
        -o LogLevel=ERROR \
        "${PR_USER}@${PR_HOST}" "$@"
}

# префикс для root-команд на сервере панели
_pr_sudo() {
    if [[ "$PR_USER" == "root" ]]; then echo ""; else echo "sudo -n"; fi
}

# отпечаток хоста: показать и подтвердить (защита от подмены сервера)
_pr_trust_host() {
    local scan
    scan="$(mktemp)"
    if ! ssh-keyscan -4 -T 10 -p "$PR_PORT" -t ed25519,ecdsa,rsa "$PR_HOST" 2>/dev/null > "$scan" || [[ ! -s "$scan" ]]; then
        rm -f "$scan"
        log_error "Не удалось подключиться к ${PR_HOST}:${PR_PORT} по SSH."
        hint "Проверьте адрес, порт и что SSH открыт в фаерволе сервера панели."
        return 1
    fi
    local known_name="$PR_HOST"
    [[ "$PR_PORT" != "22" ]] && known_name="[${PR_HOST}]:${PR_PORT}"
    if [[ -f "$PR_KNOWN" ]] && ssh-keygen -F "$known_name" -f "$PR_KNOWN" >/dev/null 2>&1; then
        # уже доверяли: при смене ключа ssh сам откажет (StrictHostKeyChecking=yes)
        rm -f "$scan"
        return 0
    fi
    echo
    log_info "Отпечатки SSH-ключа сервера ${PR_HOST}:"
    ssh-keygen -lf "$scan" | sed 's/^/     /'
    hint "Сверить на сервере панели: ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub"
    if ! confirm "Отпечаток верный, доверять этому серверу? (y/n): "; then
        rm -f "$scan"
        return 1
    fi
    mkdir -p "$PR_SSH_DIR"
    chmod 700 "$PR_SSH_DIR"
    cat "$scan" >> "$PR_KNOWN"
    chmod 600 "$PR_KNOWN"
    rm -f "$scan"
}

# ключ установщика на сервере панели (from= — вход только с этого сервера)
_pr_install_key() {
    local mode="$1" auth_key="${2:-}" my_ip pub line_from line_plain remote_cmd
    pub="$(cat "${PR_KEY}.pub")"
    my_ip="$(get_server_ip || true)"
    line_plain="no-agent-forwarding,no-X11-forwarding ${pub}"
    line_from="$line_plain"
    [[ "$my_ip" =~ $PR_IPV4_RE ]] && line_from="from=\"${my_ip}\",${line_plain}"
    # убрать прежние записи этого ключа и дописать новую
    remote_cmd='umask 077; mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && IFS= read -r l && body="$(printf "%s" "$l" | awk "{print \$(NF-1)}")" && { grep -vF "$body" ~/.ssh/authorized_keys || true; } > ~/.ssh/authorized_keys.blinvpn && printf "%s\n" "$l" >> ~/.ssh/authorized_keys.blinvpn && mv -f ~/.ssh/authorized_keys.blinvpn ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
    local -a base=(-p "$PR_PORT" -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$PR_KNOWN"
                   -o AddressFamily=inet -o ConnectTimeout=15 -o LogLevel=ERROR)
    local line
    for line in "$line_from" "$line_plain"; do
        if [[ "$mode" == "password" ]]; then
            printf '%s\n' "$line" | SSHPASS="${SSHPASS:-}" sshpass -e ssh "${base[@]}" -o PubkeyAuthentication=no \
                -o PreferredAuthentications=password,keyboard-interactive \
                "${PR_USER}@${PR_HOST}" "$remote_cmd" || return 1
        else
            printf '%s\n' "$line" | ssh "${base[@]}" -i "$auth_key" -o IdentitiesOnly=yes -o BatchMode=yes \
                "${PR_USER}@${PR_HOST}" "$remote_cmd" || return 1
        fi
        if _pr_ssh true 2>/dev/null; then
            [[ "$line" == "$line_plain" && "$line_from" != "$line_plain" ]] && \
                log_warn "Вход по ключу с ограничением по IP не прошёл — ключ установлен без ограничения по IP."
            return 0
        fi
        [[ "$line_from" == "$line_plain" ]] && break
    done
    return 1
}

# сервер панели: Caddy + сертификат автоматически или свой прокси с инструкцией
ask_panel_proxy_mode() {
    echo
    hint "На сервере панели установщик может сам поставить Caddy и выпустить сертификат (нужны свободные порты 80 и ${HTTPS_PORT})."
    hint "Если там уже есть свой прокси (например, Remnawave) — откажитесь: выложу файлы панели и дам инструкцию."
    if confirm "На сервере панели настроить Caddy и сертификат автоматически? (y — да, n — настрою сам): "; then
        PR_PROXY="caddy"
    else
        PR_PROXY="manual"
    fi
}

# инструкция и примеры для своего прокси на сервере панели
_pr_render_manual_docs() {
    local panel_domain="$1" miniapp_domain="$2" bot_ip="$3" dir="$4"
    local panel_url bot_url
    panel_url="$(pub_url "$panel_domain")"
    bot_url="https://${bot_ip}:${HTTPS_PORT}"
    _pr_render_caddy "$panel_domain" "$miniapp_domain" "$bot_ip" "$dir/panel.caddy.example"
    ( umask 077; cat > "$dir/panel.nginx.example" <<EOF
# BatmanVPN — панель на своём nginx (пример; сертификат — ваш)
server {
    listen ${HTTPS_PORT} ssl http2;
    server_name ${panel_domain};
    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    root /var/www/blinvpn-panel/current/html;
    index index.html;
    client_max_body_size 55m;
    server_tokens off;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # API панели → сервер бота (HTTPS, сертификат проверяется), с секретом шлюза
    location /api/panel {
        proxy_pass ${bot_url};
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_ssl_server_name on;
        proxy_ssl_name ${miniapp_domain};
        proxy_ssl_verify on;
        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
        proxy_set_header Host ${miniapp_domain};
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Panel-Gateway "${PR_SECRET}";
        proxy_set_header CF-Connecting-IP "";
        proxy_set_header True-Client-IP "";
        proxy_read_timeout 300s;
        proxy_buffering off;
    }
    location /api/ { return 404; }

    location ^~ /assets/ {
        root /var/www/blinvpn-panel/current/live;
        try_files \$uri @built;
    }
    location @built { root /var/www/blinvpn-panel/current/html; }
    location / { try_files \$uri \$uri/ /index.html; }
}
EOF
    cat > "$dir/PROXY-README.txt" <<EOF
BatmanVPN — панель на своём прокси (сервер ${PR_HOST})
=====================================================
Установщик НЕ ставил Caddy и НЕ выпускал сертификат. Файлы панели уже на сервере:
  /var/www/blinvpn-panel/current/html   — сама панель (index.html и т.д.)
  /var/www/blinvpn-panel/current/live   — свежие картинки (/assets/*), если есть

Что настроить в своём прокси для ${panel_url}:
  1) HTTPS для ${panel_domain} на порту ${HTTPS_PORT} (сертификат — ваш).
  2) Отдавать файлы из /var/www/blinvpn-panel/current/html,
     неизвестные пути → /index.html (это одностраничное приложение).
  3) /api/panel* → ${bot_url} по HTTPS, с заголовками:
       Host: ${miniapp_domain}            (и SNI ${miniapp_domain}, проверка сертификата)
       X-Panel-Gateway: <секрет>          (секрет — в примерах ниже и в .env.panel-remote на сервере бота)
       X-Real-IP и X-Forwarded-For = IP клиента
       CF-Connecting-IP и True-Client-IP — удалить
  4) Остальные /api/* → 404.
  5) Заголовок X-Frame-Options: DENY, размер тела до 55 МБ.

Готовые примеры (с секретом, права 600):
  /var/www/blinvpn-panel/proxy/panel.caddy.example
  /var/www/blinvpn-panel/proxy/panel.nginx.example
Если прокси работает в Docker (как у Remnawave) — примонтируйте в контейнер
/var/www/blinvpn-panel (только чтение), иначе он не увидит файлы панели.

Сервер бота пускает к /api/panel только IP ${PR_EGRESS_IP} — запросы должны уходить с него.
Проверка: curl -s -o /dev/null -w '%{http_code}' ${panel_url}/api/panel/auth/me   → 401
EOF
    )
}

panel_remote_collect() {
    section "Панель на отдельном сервере · SSH"
    hint "Установщик подключится по SSH, поставит Caddy (сам выпускает сертификат) и разместит там панель."
    hint "Пароль никуда не сохраняется: он нужен один раз, чтобы добавить на сервер отдельный ключ."
    local v
    prompt_valid "  ${BOLD}IP или домен сервера панели${NC}: " PR_HOST \
        '^([A-Za-z0-9-]+\.)+[A-Za-z0-9-]+$' "Нужен IPv4 или домен, например 203.0.113.10"
    prompt_valid "  ${BOLD}SSH-порт${NC} (Enter = 22): " v '^[0-9]{1,5}$' "Порт — число" 1
    PR_PORT="${v:-22}"
    prompt_valid "  ${BOLD}Пользователь${NC} (Enter = root): " v '^[a-z_][a-z0-9_-]{0,31}$' "Имя пользователя латиницей" 1
    PR_USER="${v:-root}"

    for cmd in ssh ssh-keygen ssh-keyscan; do
        command -v "$cmd" >/dev/null 2>&1 || sudo apt-get install -y --no-install-recommends openssh-client >/dev/null
    done
    _pr_trust_host || return 1

    mkdir -p "$PR_SSH_DIR"; chmod 700 "$PR_SSH_DIR"
    if [[ ! -f "$PR_KEY" ]]; then
        ssh-keygen -q -t ed25519 -N "" -C "blinvpn-panel-deploy@$(hostname)" -f "$PR_KEY"
    fi
    chmod 600 "$PR_KEY"

    if _pr_ssh true 2>/dev/null; then
        log_success "✔ вход по ключу установщика уже настроен."
    else
        step "1)" "Войти по паролю (рекомендуется)"
        step "2)" "Войти по своему SSH-ключу"
        prompt "  Способ входа [1-2] (Enter = 1): " v
        if [[ "${v:-1}" == "2" ]]; then
            local kp
            prompt "  Путь к приватному ключу: " kp
            kp="${kp/#\~/$HOME}"
            [[ -f "$kp" ]] || { log_error "Файл ключа не найден."; return 1; }
            _pr_install_key key "$kp" || { log_error "Не удалось войти по этому ключу."; return 1; }
        else
            command -v sshpass >/dev/null 2>&1 || sudo apt-get install -y --no-install-recommends sshpass >/dev/null
            local pw=""
            read -r -s -p "  Пароль ${PR_USER}@${PR_HOST}: " pw < /dev/tty; echo
            [[ -n "$pw" ]] || { log_error "Пароль пустой."; return 1; }
            # пароль только в окружении этого вызова (не в аргументах, не на диске)
            if ! SSHPASS="$pw" _pr_install_key password; then
                pw=""
                log_error "Не удалось войти по паролю (проверьте пароль и что вход по паролю разрешён)."
                return 1
            fi
            pw=""
        fi
        log_success "✔ ключ установщика добавлен на сервер панели."
    fi

    local priv
    priv="$(_pr_ssh 'if [ "$(id -u)" = 0 ]; then echo root; elif sudo -n true 2>/dev/null; then echo sudo; else echo none; fi' 2>/dev/null || true)"
    if [[ "$priv" == "none" || -z "$priv" ]]; then
        log_error "У пользователя ${PR_USER} нет прав root (нужен root или sudo без пароля)."
        return 1
    fi
    if ! _pr_ssh 'command -v apt-get >/dev/null && command -v systemctl >/dev/null' 2>/dev/null; then
        log_error "Сервер панели должен быть на Debian/Ubuntu с systemd."
        return 1
    fi

    # IPv4, с которого сервер панели ходит наружу — его пускаем к /api/panel
    local a_ip
    a_ip="$(get_server_ip || true)"
    PR_EGRESS_IP="$(_pr_ssh "curl -4 -fsS -m 10 https://api.ipify.org 2>/dev/null || curl -4 -fsS -m 10 https://ipv4.icanhazip.com 2>/dev/null || wget -4 -qO- -T 10 https://api.ipify.org 2>/dev/null || ip -4 route get ${a_ip:-1.1.1.1} 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p'" 2>/dev/null | tr -d '\r\n\t ' || true)"
    if [[ ! "$PR_EGRESS_IP" =~ $PR_IPV4_RE ]]; then
        PR_EGRESS_IP="$(resolve_domain_ip "$PR_HOST" 2>/dev/null || true)"
        [[ "$PR_HOST" =~ $PR_IPV4_RE ]] && PR_EGRESS_IP="$PR_HOST"
    fi
    [[ "$PR_EGRESS_IP" =~ $PR_IPV4_RE ]] || { log_error "Не удалось определить IPv4 сервера панели."; return 1; }
    log_info "IPv4 сервера панели: ${PR_EGRESS_IP}"

    local old_secret
    old_secret="$(get_env_var PANEL_GATEWAY_SECRET "$PANEL_REMOTE_FILE" 2>/dev/null || true)"
    PR_SECRET="${old_secret:-$(gen_secret_hex)$(gen_secret_hex)}"
    ask_panel_proxy_mode
    panel_remote_save
    log_success "✔ сервер панели подключён."
}

# сайт Caddy для сервера панели: статика + шлюз только на /api/panel
_pr_render_caddy() {
    local panel_domain="$1" miniapp_domain="$2" bot_ip="$3" out="$4"
    ( umask 077; cat > "$out" <<EOF
# BatmanVPN — панель (сгенерировано install.sh на сервере бота; правки затрутся при обновлении)
$(site_addr "$panel_domain") {
$(_caddy_tls_block)
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Frame-Options "DENY"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
		defer
	}
	# вложения поддержки: до 50 мб
	request_body {
		max_size 55MB
	}
	route {
		# API панели → сервер бота по HTTPS (сертификат проверяется), с секретом шлюза
		handle /api/panel* {
			reverse_proxy https://${bot_ip}:${HTTPS_PORT} {
				header_up Host ${miniapp_domain}
				header_up X-Real-IP {client_ip}
				header_up X-Forwarded-For {client_ip}
				header_up X-Panel-Gateway "${PR_SECRET}"
				header_up -CF-Connecting-IP
				header_up -True-Client-IP
				flush_interval -1
				transport http {
					tls_server_name ${miniapp_domain}
					dial_timeout 15s
				}
			}
		}
		# остальное API панели не нужно
		handle /api* {
			respond 404
		}
		handle /node.sh {
			root * /var/www/blinvpn-panel/current/html
			header Content-Type "text/plain; charset=utf-8"
			header Cache-Control "no-store"
			file_server
		}
		handle /sw.js {
			root * /var/www/blinvpn-panel/current/html
			header Cache-Control "no-cache"
			header Service-Worker-Allowed "/"
			file_server
		}
		handle /manifest.webmanifest {
			root * /var/www/blinvpn-panel/current/html
			header Content-Type "application/manifest+json"
			header Cache-Control "no-cache"
			file_server
		}
		# assets: свежие из проекта, иначе собранные
		@live_asset {
			path /assets/*
			file {
				root /var/www/blinvpn-panel/current/live
			}
		}
		handle @live_asset {
			root * /var/www/blinvpn-panel/current/live
			header Cache-Control "public, max-age=600"
			file_server
		}
		@static path *.js *.css *.woff *.woff2 *.png *.jpg *.jpeg *.svg *.ico *.webp *.gif
		handle @static {
			root * /var/www/blinvpn-panel/current/html
			header Cache-Control "public, max-age=604800"
			file_server
		}
		handle {
			root * /var/www/blinvpn-panel/current/html
			try_files {path} /index.html
			file_server
		}
	}
}
EOF
    )
}

# собрать статику панели здесь и разместить на сервере панели
panel_remote_deploy() {
    local miniapp_domain="$1" panel_domain="$2" email="$3"
    panel_remote_load || { log_error "Сервер панели не настроен (${PANEL_REMOTE_FILE})."; return 1; }
    local email_re='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    [[ "$email" =~ $email_re ]] || { log_error "Некорректный email для Let's Encrypt: ${email}"; return 1; }

    section "Панель → ${PR_HOST}"
    local bot_ip
    bot_ip="$(resolve_domain_ip "$miniapp_domain" || true)"
    [[ "$bot_ip" =~ $PR_IPV4_RE ]] || bot_ip="$(get_server_ip || true)"
    [[ "$bot_ip" =~ $PR_IPV4_RE ]] || { log_error "Не удалось определить IPv4 сервера бота."; return 1; }

    log_info "Сборка панели..."
    local npm_reg i built=0
    npm_reg="$(get_env_var NPM_REGISTRY .env 2>/dev/null || true)"
    for i in 1 2 3; do
        if sudo docker build -q -f docker/Dockerfile.panel \
                --build-arg NPM_REGISTRY="${npm_reg:-https://registry.npmjs.org/}" \
                -t blinvpn-panel-static:latest . >/dev/null; then
            built=1; break
        fi
        [[ $i -lt 3 ]] && { log_warn "Сборка панели не удалась (попытка ${i}/3), повтор через 20 с…"; sleep 20; }
    done
    [[ $built -eq 1 ]] || { log_error "Не удалось собрать панель."; return 1; }

    local stage cid
    stage="$(mktemp -d)"
    chmod 700 "$stage"
    mkdir -p "$stage/release/live"
    cid="$(sudo docker create blinvpn-panel-static:latest)"
    if ! sudo docker cp "${cid}:/srv/html" "$stage/release/html"; then
        sudo docker rm -f "$cid" >/dev/null 2>&1 || true
        sudo rm -rf "$stage"
        log_error "Не удалось извлечь статику панели из образа."
        return 1
    fi
    sudo docker rm -f "$cid" >/dev/null 2>&1 || true
    if [[ -d assets ]]; then
        cp -a assets "$stage/release/live/assets"
    else
        mkdir -p "$stage/release/live/assets"
    fi
    sudo tar -C "$stage/release" --owner=0 --group=0 -czf "$stage/release.tgz" .
    _pr_render_caddy "$panel_domain" "$miniapp_domain" "$bot_ip" "$stage/site.caddy"
    if [[ "${PR_PROXY:-caddy}" == "manual" ]]; then
        _pr_render_manual_docs "$panel_domain" "$miniapp_domain" "$bot_ip" "$stage"
    fi

    local sudo_r inc
    sudo_r="$(_pr_sudo)"
    inc="$(_pr_ssh "${sudo_r} sh -c 'umask 077; mkdir -p /var/lib/blinvpn-panel/incoming && chmod 700 /var/lib/blinvpn-panel /var/lib/blinvpn-panel/incoming && mktemp -d /var/lib/blinvpn-panel/incoming/rel.XXXXXX'" | tr -d '\r\n' || true)"
    if [[ ! "$inc" =~ ^/var/lib/blinvpn-panel/incoming/rel\.[A-Za-z0-9]+$ ]]; then
        sudo rm -rf "$stage"
        log_error "Не удалось подготовить каталог на сервере панели."
        return 1
    fi
    log_info "Загрузка на ${PR_HOST}..."
    local ok=1
    sudo cat "$stage/release.tgz" | _pr_ssh "${sudo_r} sh -c 'umask 077; cat > ${inc}/release.tgz'" || ok=0
    [[ $ok -eq 1 ]] && { _pr_ssh "${sudo_r} sh -c 'umask 077; cat > ${inc}/site.caddy'" < "$stage/site.caddy" || ok=0; }
    if [[ "${PR_PROXY:-caddy}" == "manual" ]]; then
        local mf
        for mf in PROXY-README.txt panel.caddy.example panel.nginx.example; do
            [[ $ok -eq 1 ]] && { _pr_ssh "${sudo_r} sh -c 'umask 077; cat > ${inc}/${mf}'" < "$stage/${mf}" || ok=0; }
        done
        # копия инструкции на сервере бота
        mkdir -p "${PROXY_DIR}/panel-server"; chmod 700 "${PROXY_DIR}" "${PROXY_DIR}/panel-server"
        for mf in PROXY-README.txt panel.caddy.example panel.nginx.example; do
            install -m 600 "$stage/${mf}" "${PROXY_DIR}/panel-server/${mf}"
        done
    fi
    sudo rm -rf "$stage"
    if [[ $ok -ne 1 ]]; then
        _pr_ssh "${sudo_r} rm -rf ${inc}" >/dev/null 2>&1 || true
        log_error "Не удалось загрузить файлы на сервер панели."
        return 1
    fi

    log_info "Установка на сервере панели..."
    local args out
    # ручной прокси на сервере бота: шлюз может быть ещё не настроен — его проверка не роняет установку
    local gw_check="strict"
    args="$(printf '%q ' "$panel_domain" "$email" "$inc" "$bot_ip" "$HTTPS_PORT" "$gw_check" "${PR_PROXY:-caddy}")"
    if out="$(_pr_ssh "${sudo_r} bash -s -- ${args}" < docker/panel-remote/setup.sh 2>&1)" && [[ "$(printf '%s' "$out" | tail -n1)" == "OK" ]]; then
        printf '%s\n' "$out" | sed '$d'
        if [[ "${PR_PROXY:-caddy}" == "manual" ]]; then
            log_success "✔ Файлы панели выложены на ${PR_HOST}. Caddy и сертификат не трогал — настройте свой прокси:"
            sed 's/^/  /' "${PROXY_DIR}/panel-server/PROXY-README.txt"
            hint "Инструкция и примеры: на сервере панели — /var/www/blinvpn-panel/proxy/, здесь — ${PWD}/${PROXY_DIR}/panel-server/"
        else
            log_success "✔ Панель работает: $(pub_url "$panel_domain")"
        fi
        return 0
    fi
    printf '%s\n' "$out"
    log_error "Установка панели на ${PR_HOST} не завершена."
    return 1
}

# A-запись панели должна смотреть на сервер панели
panel_remote_check_dns() {
    local panel_domain="$1" pip host_ip
    pip="$(resolve_domain_ip "$panel_domain" || true)"
    host_ip="$PR_HOST"
    [[ "$host_ip" =~ $PR_IPV4_RE ]] || host_ip="$(resolve_domain_ip "$PR_HOST" || true)"
    if [[ -n "$pip" && -n "$host_ip" && "$pip" != "$host_ip" && "$pip" != "$PR_EGRESS_IP" ]]; then
        log_warn "A-запись ${panel_domain} → ${pip}, а сервер панели — ${host_ip}."
        confirm "Продолжить? (y/n): " || return 1
    elif [[ -z "$pip" ]]; then
        log_warn "У ${panel_domain} нет A-записи — сертификат не выпустится."
        confirm "Продолжить? (y/n): " || return 1
    fi
}

# перенос существующей панели на отдельный сервер
move_panel_to_remote_flow() {
    section "Перенос панели на отдельный сервер"
    local mini panel email
    mini="$(get_env_var MINIAPP_DOMAIN .env 2>/dev/null || true)"
    panel="$(get_env_var PANEL_DOMAIN .env 2>/dev/null || true)"
    email="$(get_env_var SSL_EMAIL .env 2>/dev/null || true)"
    [[ -n "$mini" && -n "$panel" ]] || { log_error "В .env нет MINIAPP_DOMAIN/PANEL_DOMAIN."; exit 1; }
    if [[ -z "$email" ]]; then
        prompt "Email для Let's Encrypt: " email
        set_env_var SSL_EMAIL "$email"
    fi
    log_info "Домен панели: ${panel}"
    hint "Перед переносом направьте A-запись ${panel} на новый сервер панели."
    panel_remote_collect || exit 1
    panel_remote_check_dns "$panel" || exit 1
    proxy_up "$mini" "$panel" "$email" || exit 1
    if ! panel_remote_deploy "$mini" "$panel" "$email"; then
        log_warn "Сервер бота уже переключён на удалённую панель. Исправьте ошибку и запустите install.sh → «Панель на отдельном сервере» ещё раз."
        exit 1
    fi
    dc stop panel >/dev/null 2>&1 || true
    cleanup_legacy_certbot "$panel"
    log_success "\nГотово: панель — $(pub_url "$panel") (сервер ${PR_HOST})."
}

# смена порта HTTPS у готовой установки
change_port_flow() {
    section "Смена порта HTTPS"
    local mini panel email old="$HTTPS_PORT"
    mini="$(get_env_var MINIAPP_DOMAIN .env 2>/dev/null || true)"
    panel="$(get_env_var PANEL_DOMAIN .env 2>/dev/null || true)"
    email="$(get_env_var SSL_EMAIL .env 2>/dev/null || true)"
    [[ -n "$mini" && -n "$panel" ]] || { log_error "В .env нет MINIAPP_DOMAIN/PANEL_DOMAIN."; exit 1; }
    if [[ -z "$email" ]]; then
        prompt "Email для Let's Encrypt: " email
        set_env_var SSL_EMAIL "$email"
    fi
    log_info "Сейчас: порт ${old}"
    ask_https_port "$old"
    if [[ "$HTTPS_PORT" == "$old" ]]; then log_info "Порт не изменился."; return 0; fi
    if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q 'Status: active'; then
        sudo ufw allow "${HTTPS_PORT}/tcp" || true
    fi
    if ! proxy_up "$mini" "$panel" "$email"; then
        HTTPS_PORT="$old"
        log_warn "Возвращаю порт ${old}…"
        proxy_up "$mini" "$panel" "$email" || true
        exit 1
    fi
    update_env_domains "$mini" "$panel"
    ensure_env_utf8 .env
    dc up -d
    if panel_is_remote; then
        dc stop panel >/dev/null 2>&1 || true
        panel_remote_deploy "$mini" "$panel" "$email" \
            || log_warn "Панель на отдельном сервере не обновлена — повторите: install.sh → «Панель на отдельном сервере»."
    fi
    TELEGRAM_STARS_DELIVERY="$(get_env_var TELEGRAM_STARS_DELIVERY || true)"
    register_telegram_webhook "$(get_env_var TELEGRAM_BOT_TOKEN || true)" "$mini"
    if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q 'Status: active' && [[ "$old" != "443" ]]; then
        sudo ufw delete allow "${old}/tcp" >/dev/null 2>&1 || true
    fi
    section "Порт изменён: ${old} → ${HTTPS_PORT}"
    printf "  Мини-приложение : ${YELLOW}%s${NC}\n" "$(pub_url "$mini")"
    printf "  Панель          : ${YELLOW}%s${NC}\n" "$(pub_url "$panel")"
    log_warn "Обновите Web App URL в @BotFather и адрес уведомлений в ЮKassa:"
    printf "     ${CYAN}%s${NC}   и   ${CYAN}%s/yookassa${NC}\n" "$(pub_url "$mini")" "$(pub_url "$mini")"
}

REPO_URL="${BLINVPN_REPO_URL:-https://github.com/Blin4Dev/listvpn.git}"
REPO_BRANCH="${BLINVPN_BRANCH:-main}"
PROJECT_DIR="blinvpn"
NGINX_CONF="/etc/nginx/sites-available/${PROJECT_DIR}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${PROJECT_DIR}.conf"

log_success "--- Установка / обновление BatmanVPN ---"

# обновление существующей установки
# установка до перехода на Caddy определяется по конфигу nginx
if [[ -f "$NGINX_CONF" || -f "$CADDY_SITE" ]]; then
    log_info "\nОбнаружена существующая конфигурация BatmanVPN."
    if [[ ! -d "$PROJECT_DIR" ]]; then
        log_error "Конфиг BatmanVPN есть (${CADDY_SITE} или ${NGINX_CONF}), но каталог «${PROJECT_DIR}» отсутствует. Удалите конфиг и повторите установку."
        exit 1
    fi
    cd "$PROJECT_DIR"
    ensure_compose
    load_https_port

    if [[ "${BLINVPN_POST_UPDATE:-}" == "1" ]]; then
        unset BLINVPN_POST_UPDATE
        section "Пост-обновление"
        migrate_security_update ".env"
        ensure_env_utf8 .env
        dc_build || exit 1
        dc down --remove-orphans
        fix_container_data_permissions
        dc up -d
        fix_container_data_permissions
        dc restart api webhook bot monitor 2>/dev/null || true
        install_host_runner

        _upd_mini="$(get_env_var MINIAPP_DOMAIN .env 2>/dev/null || get_env_var WEBHOOK_DOMAIN .env 2>/dev/null || true)"
        _upd_panel="$(get_env_var PANEL_DOMAIN .env 2>/dev/null || true)"
        _upd_email="$(get_env_var SSL_EMAIL .env 2>/dev/null || true)"
        if [[ -n "$_upd_mini" && -n "$_upd_panel" ]]; then
            # с nginx-версии переезжаем на Caddy автоматически (при ошибке nginx возвращается)
            if [[ -z "$_upd_email" ]]; then
                prompt "Email для Let's Encrypt: " _upd_email
                set_env_var SSL_EMAIL "$_upd_email"
            fi
            if ! proxy_up "$_upd_mini" "$_upd_panel" "$_upd_email"; then
                log_error "Не удалось применить Caddy. Контейнеры обновлены; прокси оставлен как был."
                exit 1
            fi
        else
            log_warn "В .env нет MINIAPP_DOMAIN/PANEL_DOMAIN — прокси не перенастроен."
        fi

        # панель на отдельном сервере: выкатить новую версию туда
        if panel_is_remote; then
            dc stop panel >/dev/null 2>&1 || true
            if ! panel_remote_deploy "$_upd_mini" "$_upd_panel" "$_upd_email"; then
                log_warn "Бот обновлён, но панель на отдельном сервере — нет. Повторите: install.sh → «Панель на отдельном сервере»."
            fi
        fi

        log_success "\nОбновление завершено."
        hint "Код обновлён. Если нужно другое действие (домены, панель, порт) — запустите install.sh ещё раз и выберите пункт."
        _upd_pst="$(get_env_var PANEL_SETUP_TOKEN .env 2>/dev/null || true)"
        if [[ -n "$_upd_pst" ]]; then
            log_info "PANEL_SETUP_TOKEN в .env (сброс пароля панели)."
        fi
        exit 0
    fi

    section "Существующая установка — выберите действие"
    step "1)" "Обновить код и перезапустить контейнеры (по умолчанию)"
    step "2)" "Заменить домены"
    if panel_is_remote; then
        step "3)" "Панель на отдельном сервере: переустановить / сменить сервер"
    else
        step "3)" "Перенести панель на отдельный сервер"
    fi
    step "4)" "Сменить порт HTTPS (сейчас ${HTTPS_PORT})"
    step "5)" "Выход"
    echo
    prompt "Ваш выбор [1-5] (Enter = 1): " ACTION_CHOICE
    ACTION_CHOICE="${ACTION_CHOICE:-1}"

    # запущен свежий install.sh (например, через curl), а код в папке старый → сначала обновить
    if [[ "$ACTION_CHOICE" =~ ^[234]$ ]] && ! grep -qF "INSTALLER_VERSION=\"${INSTALLER_VERSION}\"" ./install.sh 2>/dev/null; then
        log_warn "Код в $(pwd) старее этого установщика — без обновления выбранное действие сработает неправильно."
        if confirm "Обновить код сейчас (как пункт 1), затем повторить выбор? (y/n): "; then
            ACTION_CHOICE=1
        else
            log_error "Отменено. Сначала выполните пункт 1 «Обновить код»."
            exit 1
        fi
    fi

    case "$ACTION_CHOICE" in
        2)
            replace_domains_flow
            exit 0
            ;;
        3)
            if panel_is_remote; then
                _m_mini="$(get_env_var MINIAPP_DOMAIN .env 2>/dev/null || true)"
                _m_panel="$(get_env_var PANEL_DOMAIN .env 2>/dev/null || true)"
                _m_email="$(get_env_var SSL_EMAIL .env 2>/dev/null || true)"
                panel_remote_load || true
                if confirm "Сменить сервер панели (сейчас ${PR_HOST:-?})? (y/n): "; then
                    panel_remote_collect || exit 1
                    panel_remote_check_dns "$_m_panel" || exit 1
                else
                    ask_panel_proxy_mode
                    panel_remote_save
                fi
                proxy_up "$_m_mini" "$_m_panel" "$_m_email" || exit 1
                panel_remote_deploy "$_m_mini" "$_m_panel" "$_m_email" || exit 1
                dc stop panel >/dev/null 2>&1 || true
            else
                move_panel_to_remote_flow
            fi
            exit 0
            ;;
        4)
            change_port_flow
            exit 0
            ;;
        5)
            log_info "Выход без изменений."
            exit 0
            ;;
        *)
            log_info "\nОбновление исходного кода..."
            # репозиторий переехал: старые установки тоже тянут из нового адреса
            git remote set-url origin "$REPO_URL" 2>/dev/null || true
            git fetch origin
            git reset --hard origin/"$REPO_BRANCH"
            git checkout "$REPO_BRANCH" 2>/dev/null || git checkout -b "$REPO_BRANCH" --track origin/"$REPO_BRANCH"
            git reset --hard origin/"$REPO_BRANCH"
            log_success "✔ Репозиторий обновлён."

            if [[ ! -f ./install.sh ]]; then
                log_error "После обновления не найден ./install.sh."
                exit 1
            fi
            log_info "\nЗапуск свежего install.sh..."
            export BLINVPN_POST_UPDATE=1
            cd ..
            exec bash "$PROJECT_DIR/install.sh"
            ;;
    esac
fi

# новая установка
log_info "\nСуществующая конфигурация не найдена. Новая установка."

ensure_packages
ensure_services
ensure_compose

log_info "\nШаг 2: клонирование репозитория"
if [[ ! -d "$PROJECT_DIR/.git" ]]; then
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$PROJECT_DIR"
else
    log_warn "Каталог $PROJECT_DIR уже есть — используем текущую версию."
fi
cd "$PROJECT_DIR"
log_success "✔ Репозиторий BatmanVPN готов."

log_info "\nШаг 3: домены и SSL"

prompt "Домен мини-приложения (например app.example.com): " USER_DOMAIN_INPUT
DOMAIN=$(sanitize_domain "$USER_DOMAIN_INPUT")
[[ -n "$DOMAIN" ]] || { log_error "Некорректный домен."; exit 1; }

prompt "Домен панели (например panel.example.com): " USER_PANEL_DOMAIN_INPUT
PANEL_DOMAIN=$(sanitize_domain "$USER_PANEL_DOMAIN_INPUT")
[[ -n "$PANEL_DOMAIN" ]] || { log_error "Некорректный домен панели."; exit 1; }

prompt_valid "Email для Let's Encrypt: " EMAIL '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' "Email вида name@example.com"
ask_https_port 443

PANEL_REMOTE=0
echo
hint "Панель можно поставить на отдельный сервер: установщик сам зайдёт туда по SSH."
if confirm "Установить панель на ОТДЕЛЬНЫЙ сервер? (y/n): "; then
    PANEL_REMOTE=1
    hint "A-запись ${PANEL_DOMAIN} должна указывать на сервер панели, а не на этот."
    panel_remote_collect || exit 1
else
    rm -f "$PANEL_REMOTE_FILE" 2>/dev/null || true
fi

SERVER_IP=$(get_server_ip || true)
DOMAIN_IP=$(resolve_domain_ip "$DOMAIN" || true)
PANEL_DOMAIN_IP=$(resolve_domain_ip "$PANEL_DOMAIN" || true)

[[ -n "$SERVER_IP" ]] && log_info "IP сервера: ${SERVER_IP}"
[[ -n "$DOMAIN_IP" ]] && log_info "IP ${DOMAIN}: ${DOMAIN_IP}"
[[ -n "$PANEL_DOMAIN_IP" ]] && log_info "IP ${PANEL_DOMAIN}: ${PANEL_DOMAIN_IP}"

if [[ -n "$SERVER_IP" && -n "$DOMAIN_IP" && "$SERVER_IP" != "$DOMAIN_IP" ]]; then
    log_warn "DNS ${DOMAIN} не совпадает с IP сервера."
    confirm "Продолжить? (y/n): " || exit 1
fi
if [[ $PANEL_REMOTE -eq 1 ]]; then
    panel_remote_check_dns "$PANEL_DOMAIN" || exit 1
elif [[ -n "$SERVER_IP" && -n "$PANEL_DOMAIN_IP" && "$SERVER_IP" != "$PANEL_DOMAIN_IP" ]]; then
    log_warn "DNS ${PANEL_DOMAIN} не совпадает с IP сервера."
    confirm "Продолжить? (y/n): " || exit 1
fi


if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q 'Status: active'; then
    log_warn "UFW активен — открываю порты 80 и ${HTTPS_PORT}, закрываю внутренние."
    sudo ufw allow 80/tcp
    sudo ufw allow "${HTTPS_PORT}/tcp"
    # api/webhook только на 127.0.0.1; ufw deny снаружи на всякий случай
    sudo ufw deny "${API_PORT:-8000}/tcp" 2>/dev/null || true
    sudo ufw deny "${WEBHOOK_PORT:-5000}/tcp" 2>/dev/null || true
fi

log_info "\nШаг 4: Caddy и SSL-сертификаты"
# сертификаты Caddy выпускает и продлевает сам
proxy_up "$DOMAIN" "$PANEL_DOMAIN" "$EMAIL" || exit 1

log_info "\nШаг 5: .env"
if [[ -f ".env" ]]; then
    log_warn "Файл .env уже существует."
    if ! confirm "Перезаписать .env? (y/n): "; then
        log_info "Используется существующий .env."
        migrate_security_update ".env"
        set_env_var HTTPS_PORT "$HTTPS_PORT"
    else
        create_env_file "$DOMAIN" "$PANEL_DOMAIN" "$EMAIL"
    fi
else
    create_env_file "$DOMAIN" "$PANEL_DOMAIN" "$EMAIL"
fi

log_info "\nШаг 6: Docker"
ensure_env_utf8 .env
fix_container_data_permissions
dc_build || exit 1
if [[ -n "$(dc ps -q 2>/dev/null)" ]]; then
    dc down
fi
dc up -d
fix_container_data_permissions
dc restart api webhook bot monitor 2>/dev/null || true
install_host_runner

PANEL_DEPLOY_FAILED=0
if [[ $PANEL_REMOTE -eq 1 ]]; then
    log_info "\nШаг 6.1: Панель на отдельном сервере"
    dc stop panel >/dev/null 2>&1 || true
    # API должен подняться: проверка шлюза ждёт ответ 401
    for _i in $(seq 1 30); do
        curl -fsS --noproxy "*" -m 3 "http://127.0.0.1:${API_PORT:-8000}/api/health" >/dev/null 2>&1 && break
        sleep 2
    done
    if ! panel_remote_deploy "$DOMAIN" "$PANEL_DOMAIN" "$EMAIL"; then
        PANEL_DEPLOY_FAILED=1
        log_warn "Бот установлен, но панель на отдельном сервере — нет. Исправьте ошибку выше и запустите install.sh → «Панель на отдельном сервере»."
    fi
fi

log_info "\nШаг 7: Telegram Stars"
TELEGRAM_STARS_DELIVERY="$(get_env_var TELEGRAM_STARS_DELIVERY || true)"
TELEGRAM_STARS_DELIVERY="${TELEGRAM_STARS_DELIVERY:-bot}"
register_telegram_webhook "${TELEGRAM_BOT_TOKEN:-}" "$DOMAIN"

# логин/пароль панели: data/first_run_credentials.txt, показать один раз и удалить
log_info "\nШаг 8: Доступ в панель"
PANEL_CREDS_FILE="data/first_run_credentials.txt"
for _i in $(seq 1 30); do
    [[ -f "$PANEL_CREDS_FILE" ]] && break
    sleep 1
done
if [[ -f "$PANEL_CREDS_FILE" ]]; then
    PANEL_LOGIN="$(get_env_var login "$PANEL_CREDS_FILE" 2>/dev/null || true)"
    PANEL_PASS="$(get_env_var password "$PANEL_CREDS_FILE" 2>/dev/null || true)"
    printf "${BOLD}  Доступ в панель:${NC}\n"
    printf "  Логин:  ${YELLOW}%s${NC}\n" "$PANEL_LOGIN"
    printf "  Пароль: ${YELLOW}%s${NC}\n" "$PANEL_PASS"
    sudo rm -f "$PANEL_CREDS_FILE" 2>/dev/null || rm -f "$PANEL_CREDS_FILE" 2>/dev/null || true
else
    log_warn "Не удалось получить логин/пароль автоматически."
    log_warn "Посмотрите их в логах: ${BOLD}dc logs api | grep -A3 'доступ в панель'${NC}"
fi

printf "\n"
printf "${GREEN}┃${NC}    ${BOLD}Установка завершена${NC}                              ${GREEN}┃${NC}\n"
printf "\n"
printf "${BOLD}  Адреса${NC}\n"
printf "  Мини-приложение:  ${YELLOW}%s${NC}\n" "$(pub_url "$DOMAIN")"
if [[ $PANEL_REMOTE -eq 1 ]]; then
    printf "  Панель:           ${YELLOW}%s${NC}  (сервер %s)\n" "$(pub_url "$PANEL_DOMAIN")" "$PR_HOST"
    [[ $PANEL_DEPLOY_FAILED -eq 1 ]] && printf "                    ${RED}не установлена — см. ошибку выше${NC}\n"
else
    printf "  Панель:           ${YELLOW}%s${NC}\n" "$(pub_url "$PANEL_DOMAIN")"
fi
printf "  API:              ${YELLOW}%s/api${NC}\n" "$(pub_url "$DOMAIN")"
print_payment_webhooks "$DOMAIN"
