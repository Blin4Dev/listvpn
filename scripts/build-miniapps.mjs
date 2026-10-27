// сборка мини-приложений всех проектов сети: dist/miniapp/<id>/
//   node scripts/build-miniapps.mjs            — все проекты из projects/*/project.json
//   node scripts/build-miniapps.mjs fgn batman — только указанные
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const all = fs.readdirSync(path.join(root, "projects"))
  .filter((d) => fs.existsSync(path.join(root, "projects", d, "project.json")))
  .filter((d) => JSON.parse(fs.readFileSync(path.join(root, "projects", d, "project.json"), "utf8")).enabled !== false)
  .sort();
const want = process.argv.slice(2);
const list = want.length ? want : all;
for (const id of list) {
  if (!all.includes(id)) {
    console.error(`нет проекта ${id} (есть: ${all.join(", ")})`);
    process.exit(1);
  }
  console.log(`\n▶ мини-приложение ${id}`);
  execFileSync(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "build", "--config", "src/app/vite.config.ts"],
    { cwd: root, stdio: "inherit", env: { ...process.env, PROJECT: id } });
}
