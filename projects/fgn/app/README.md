# Переопределения мини-приложения FGN

Любой файл из `src/app/` можно заменить своей версией для FGN: положите файл сюда по тому же пути.

    src/app/pages/Home.tsx         →  projects/fgn/app/pages/Home.tsx
    src/app/components/noir.tsx    →  projects/fgn/app/components/noir.tsx   (цвета, шрифты, стиль)
    src/app/global.css             →  projects/fgn/app/global.css

Относительные импорты внутри файла-переопределения пишутся так же, как в оригинале
(`../utils/api` и т.п.) — сборка ищет их в `src/app/`, а если там тоже есть переопределение — берёт его.

Картинки и видео — `projects/fgn/assets/` (поверх общих `assets/`).
Название, канал, тексты бота — `projects/fgn/project.json`.

Сейчас FGN — точная копия BatmanVPN (те же ассеты, без переопределений).
