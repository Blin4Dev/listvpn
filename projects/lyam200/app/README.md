# Переопределения мини-приложения ЛЯМ200

Любой файл из `src/app/` можно заменить своей версией для ЛЯМ200: положите файл сюда по тому же пути.

    src/app/pages/Home.tsx         →  projects/lyam/app/pages/Home.tsx
    src/app/components/noir.tsx    →  projects/lyam/app/components/noir.tsx   (цвета, шрифты, стиль)
    src/app/global.css             →  projects/lyam/app/global.css

Относительные импорты внутри файла-переопределения пишутся так же, как в оригинале
(`../utils/api` и т.п.) — сборка ищет их в `src/app/`, а если там тоже есть переопределение — берёт его.
Общие компоненты дизайна проекта удобно держать в одном файле (как у FGN — `components/fgn.tsx`).

Картинки и видео — `projects/lyam/assets/` (поверх общих `assets/`).
Название, канал, тексты бота, фичи — `projects/lyam/project.json`.

Дизайн — по макету Figma (FGN без семьи): компоненты в `components/lyam.tsx`, иконки — `components/lyamIcons.ts`.

Локально: `$env:PROJECT="lyam"; npx vite --config src/app/vite.config.ts` (PowerShell),
сборка — `node scripts/build-miniapps.mjs lyam`.
