# Переопределения мини-приложения Hustler

Любой файл из `src/app/` можно заменить своей версией для Hustler: положите файл сюда по тому же пути.

    src/app/pages/Home.tsx         →  projects/hustler/app/pages/Home.tsx
    src/app/components/noir.tsx    →  projects/hustler/app/components/noir.tsx   (цвета, шрифты, стиль)
    src/app/global.css             →  projects/hustler/app/global.css

Относительные импорты внутри файла-переопределения пишутся так же, как в оригинале
(`../utils/api` и т.п.) — сборка ищет их в `src/app/`, а если там тоже есть переопределение — берёт его.
Общие компоненты дизайна проекта удобно держать в одном файле (как у FGN — `components/fgn.tsx`).

Картинки и видео — `projects/hustler/assets/` (поверх общих `assets/`).
Название, канал, тексты бота, фичи — `projects/hustler/project.json`.

Сейчас Hustler — точная копия BatmanVPN (те же ассеты и фичи, без переопределений). Дизайн — позже.

Локально: `$env:PROJECT="hustler"; npx vite --config src/app/vite.config.ts` (PowerShell),
сборка — `node scripts/build-miniapps.mjs hustler`.
