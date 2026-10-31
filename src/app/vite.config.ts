import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// ── сеть проектов (listvpn) ──
// Одно мини-приложение на все проекты; проект выбирается при сборке: PROJECT=fgn npm run build:miniapp
//   projects/<id>/project.json — имя, канал (бренд)
//   projects/<id>/assets/      — свои картинки/видео (поверх общих assets/)
//   projects/<id>/app/<путь>   — переопределение любого файла src/app/<путь> (дизайн, эксклюзивные фишки)
const REPO = path.resolve(__dirname, "../..");
const APP_DIR = path.resolve(__dirname);
const PROJECT = (process.env.PROJECT || "batman").trim().toLowerCase();
const PROJECT_DIR = path.join(REPO, "projects", PROJECT);
if (!/^[a-z][a-z0-9]{0,23}$/.test(PROJECT) || !fs.existsSync(path.join(PROJECT_DIR, "project.json"))) {
  throw new Error(`Проект «${PROJECT}» не найден: нет projects/${PROJECT}/project.json`);
}
const CFG = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "project.json"), "utf8"));
const OVERRIDE_DIR = path.join(PROJECT_DIR, "app");
const SHARED_ASSETS = path.join(REPO, "assets");
const PROJECT_ASSETS = path.join(PROJECT_DIR, "assets");
const OUT_DIR = path.join(REPO, "dist", "miniapp", PROJECT);
const OUT_ASSETS = path.join(OUT_DIR, "assets");

const BRAND = {
  id: PROJECT,
  name: String(CFG.name || PROJECT),
  channelUrl: String(CFG.channel?.url || (CFG.channel?.id ? `https://t.me/${String(CFG.channel.id).replace(/^@/, "")}` : "")),
  version: String(CFG.app_version || "1.0"),
  features: Object.fromEntries(Object.entries(CFG.features || {}).map(([k, v]) => [k, !!v])),
};

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

// файл проекта вместо общего: src/app/pages/Home.tsx → projects/<id>/app/pages/Home.tsx (если есть)
// vite отдаёт id с прямыми слэшами (на Windows тоже: C:/Users/...), поэтому сравниваем в posix-виде
const toPosix = (p: string) => p.replace(/\\/g, "/");
const IS_WIN = process.platform === "win32";
const sameStart = (p: string, dir: string) =>
  IS_WIN ? p.toLowerCase().startsWith(dir.toLowerCase() + "/") : p.startsWith(dir + "/");
const APP_DIR_P = toPosix(APP_DIR);
const OVERRIDE_DIR_P = toPosix(OVERRIDE_DIR);

function projectOverrides(): Plugin {
  const exts = ["", ".tsx", ".ts", ".jsx", ".js", ".css", "/index.tsx", "/index.ts"];
  return {
    name: "listvpn-project-overrides",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || source.startsWith("\0") || !fs.existsSync(OVERRIDE_DIR)) return null;
      // импорт ИЗ файла-переопределения резолвим так, будто файл лежит на месте оригинала в src/app:
      // относительные пути ведут к общим модулям, а пакеты (react и т.п.) берутся из src/app/node_modules
      let base = toPosix(importer.split("?")[0]);
      if (sameStart(base, OVERRIDE_DIR_P)) {
        base = APP_DIR_P + base.slice(OVERRIDE_DIR_P.length);
      }
      const resolved = await this.resolve(source, base, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      const file = toPosix(resolved.id.split("?")[0]);
      if (!sameStart(file, APP_DIR_P)) return resolved;
      const rel = file.slice(APP_DIR_P.length + 1).replace(/\.(tsx?|jsx?|css)$/, "");
      for (const ext of exts) {
        const cand = path.join(OVERRIDE_DIR, rel + ext);
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return toPosix(cand);
      }
      return resolved;
    },
  };
}

function assetFile(rel: string): string | null {
  for (const dir of [PROJECT_ASSETS, SHARED_ASSETS]) {
    const file = path.join(dir, rel);
    if (file.startsWith(dir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

function copyDir(src: string, dst: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    if (entry.toLowerCase() === "readme.md") continue;
    const from = path.join(src, entry);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(dst, entry));
  }
}

// /assets/* в dev (проект поверх общих) и копирование в сборку
function projectAssets(): Plugin {
  return {
    name: "listvpn-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ? req.url.split("?")[0] : "";
        if (!url.startsWith("/assets/")) return next();
        const file = assetFile(decodeURIComponent(url.slice("/assets/".length)));
        if (!file) return next();
        res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
    transformIndexHtml(html) {
      return html.replace(/%LISTVPN_BRAND%/g, BRAND.name);
    },
    closeBundle() {
      // redirect.html для deep link incy/happ (tg не открывает эти схемы) — с названием проекта;
      // свой дизайн проекта — projects/<id>/site/redirect.html (у FGN — сетка, частицы, белая кнопка)
      const ownRedirect = path.join(PROJECT_DIR, "site", "redirect.html");
      const redirectSrc = fs.existsSync(ownRedirect) ? ownRedirect : path.resolve(REPO, "src/site/redirect.html");
      if (fs.existsSync(redirectSrc)) {
        const html = fs.readFileSync(redirectSrc, "utf8").replace(/BatmanVPN/g, BRAND.name);
        fs.writeFileSync(path.join(OUT_DIR, "redirect.html"), html);
      }
      copyDir(SHARED_ASSETS, OUT_ASSETS);
      copyDir(PROJECT_ASSETS, OUT_ASSETS); // свои картинки проекта поверх общих
    },
  };
}

export default defineConfig({
  plugins: [projectOverrides(), react(), projectAssets()],
  define: {
    __LISTVPN_PROJECT__: JSON.stringify(BRAND),
  },
  // cwd — корень репо, root относительный
  root: "src/app",
  base: "/",
  server: {
    fs: { allow: [REPO] },
  },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
  },
});
