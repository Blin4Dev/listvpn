#!/bin/sh
# мини-приложения проектов для их серверов: сборка (+ живые assets) → /export/<id>/ (./data/miniapp-dist на хосте).
# Агент сервера мини-приложения скачивает её через панель (/api/agent/bundle/<id>), см. src/core/miniapps.py.
if [ -d /export ]; then
    for d in /srv/projects/*/; do
        [ -d "$d" ] || continue
        id="$(basename "$d")"
        tmp="/export/.${id}.tmp"
        rm -rf "$tmp"
        cp -a "$d" "$tmp" || continue
        mkdir -p "$tmp/assets"
        [ -d /srv/live/shared/assets ] && cp -a /srv/live/shared/assets/. "$tmp/assets/" 2>/dev/null
        [ -d "/srv/live/projects/${id}/assets" ] && cp -a "/srv/live/projects/${id}/assets/." "$tmp/assets/" 2>/dev/null
        chmod -R a+rX "$tmp" 2>/dev/null
        rm -rf "/export/${id}.old"
        [ -d "/export/${id}" ] && mv "/export/${id}" "/export/${id}.old"
        mv "$tmp" "/export/${id}"
        rm -rf "/export/${id}.old"
    done
fi
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
