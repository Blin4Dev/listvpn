# Переопределения мини-приложения Лям200VPN

Любой файл из `src/app/` можно заменить своей версией для Лям200VPN: положите файл сюда по тому же пути.

    src/app/pages/Home.tsx         →  projects/lyam200/app/pages/Home.tsx
    src/app/components/noir.tsx    →  projects/lyam200/app/components/noir.tsx   (цвета, шрифты, стиль)
    src/app/global.css             →  projects/lyam200/app/global.css

Относительные импорты внутри файла-переопределения пишутся так же, как в оригинале
(`../utils/api` и т.п.) — сборка ищет их в `src/app/`, а если там тоже есть переопределение — берёт его.
Общие компоненты дизайна проекта удобно держать в одном файле (как у FGN — `components/fgn.tsx`).

Картинки и видео — `projects/lyam200/assets/` (поверх общих `assets/`).
Название, канал, тексты бота, фичи — `projects/lyam200/project.json`.

Сейчас Лям200VPN — точная копия BatmanVPN (те же ассеты и фичи, без переопределений). Дизайн — позже.

Локально: `$env:PROJECT="lyam200"; npx vite --config src/app/vite.config.ts` (PowerShell),
сборка — `node scripts/build-miniapps.mjs lyam200`.
