# Переопределения мини-приложения O-VPN

Любой файл из `src/app/` можно заменить своей версией для O-VPN: положите файл сюда по тому же пути.

    src/app/pages/Home.tsx         →  projects/ovpn/app/pages/Home.tsx
    src/app/components/noir.tsx    →  projects/ovpn/app/components/noir.tsx   (цвета, шрифты, стиль)
    src/app/global.css             →  projects/ovpn/app/global.css

Относительные импорты внутри файла-переопределения пишутся так же, как в оригинале
(`../utils/api` и т.п.) — сборка ищет их в `src/app/`, а если там тоже есть переопределение — берёт его.
Общие компоненты дизайна проекта удобно держать в одном файле (как у FGN — `components/fgn.tsx`).

Картинки и видео — `projects/ovpn/assets/` (поверх общих `assets/`).
Название, канал, тексты бота, фичи — `projects/ovpn/project.json`.

Сейчас O-VPN — точная копия BatmanVPN (те же ассеты и фичи, без переопределений). Дизайн — позже.

Локально: `$env:PROJECT="ovpn"; npx vite --config src/app/vite.config.ts` (PowerShell),
сборка — `node scripts/build-miniapps.mjs ovpn`.
