// Сайт проекта: «/rules» — правила использования = договор оферты и политика из панели
// (Настройки → «Оферта» / «Политика», свои у каждого проекта) — тот же текст, что в мини-приложении.
// Разделы — строки «1. Заголовок»; «- …» — пункты списка. Слева оглавление (на телефоне скрыто).
// У проекта может быть свой статичный текст: projects/<id>/app/site/SiteRules.tsx (так у FGN).
import React, { useEffect, useMemo, useState } from "react";
import { fetchLegal } from "../utils/api";
import { C, T } from "./theme";

export const RULES_CSS = `
.fs-rules .fs-wrap { position: relative; z-index: 1; padding-top: 64px; padding-bottom: 96px; }
.fs-rules-head { text-align: center; animation: fsFade .35s ease both; }
.fs-rules-eyebrow { font-size: 12px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: rgba(var(--fs-mut-rgb), .62); }
.fs-rules-head h1 { margin: 22px 0 0; font-size: 46px; line-height: 1.12; font-weight: 800; letter-spacing: -.015em; }
.fs-rules-lead { margin: 18px auto 0; max-width: 480px; font-size: 16px; line-height: 1.6; color: rgba(var(--fs-mut-rgb), .8); }
.fs-rules-date { margin-top: 18px; font-size: 13.5px; color: rgba(var(--fs-mut-rgb), .62); }
.fs-rules-body { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 112px; margin-top: 64px; }
.fs-rules-toc { position: sticky; top: 28px; align-self: start; display: flex; flex-direction: column; gap: 4px; }
.fs-rules-toc a { display: block; padding: 6px 0; font-size: 14px; line-height: 20px; color: rgba(var(--fs-mut-rgb), .62);
  text-decoration: none; transition: color .15s; }
.fs-rules-toc a:hover { color: #fff; }
.fs-rules-toc a.on { color: #fff; }
.fs-rules-text { max-width: 860px; }
.fs-rules-text section { scroll-margin-top: 24px; }
.fs-rules-text section + section { margin-top: 40px; }
.fs-rules-text h2 { margin: 0 0 16px; font-size: 24px; line-height: 1.3; font-weight: 700; letter-spacing: -.005em; color: #fff; }
.fs-rules-text p { margin: 0; font-size: 16px; line-height: 1.75; color: rgba(var(--fs-mut-rgb), .8); }
.fs-rules-text p + p, .fs-rules-text p + ul, .fs-rules-text ul + p { margin-top: 16px; }
.fs-rules-text p b { color: #fff; font-weight: 700; }
.fs-rules-text ul { margin: 16px 0 0; padding: 0; list-style: none; }
.fs-rules-text li { position: relative; padding-left: 22px; font-size: 16px; line-height: 1.75; color: rgba(var(--fs-mut-rgb), .8); }
.fs-rules-text li::before { content: ""; position: absolute; left: 6px; top: .78em; width: 5px; height: 5px; border-radius: 50%; background: rgba(var(--fs-mut-rgb), .7); }
.fs-rules-text a { color: ${C.green}; text-decoration: none; }
.fs-rules-text a:hover { text-decoration: underline; }
.fs-rules-note { margin-top: 72px; font-size: 17px; line-height: 1.6; color: #fff; }
@media (max-width: 860px) {
  .fs-rules .fs-wrap { padding-top: 44px; padding-bottom: 64px; }
  .fs-rules-head h1 { font-size: 32px; }
  .fs-rules-lead { font-size: 15px; }
  .fs-rules-body { display: block; margin-top: 40px; }
  .fs-rules-toc { display: none; }
  .fs-rules-text section + section { margin-top: 32px; }
  .fs-rules-text h2 { font-size: 20px; margin-bottom: 12px; }
  .fs-rules-text p, .fs-rules-text li { font-size: 15px; line-height: 1.7; }
  .fs-rules-note { margin-top: 48px; font-size: 15.5px; }
}
.fs-rules-empty { margin-top: 48px; text-align: center; font-size: 16px; line-height: 1.6; color: rgba(var(--fs-mut-rgb), .8); }
`;

type Block = { p: string } | { ul: string[] };
type Section = { id: string; title: string; body: Block[] };

// «1. Заголовок» / «1) Заголовок» — новый раздел; короткая строка без точки в конце
const HEAD_RE = /^(\d{1,2})[.)]\s+(.{2,90})$/;

function clean(line: string): string {
  return line.replace(/<[^>]+>/g, "").replace(/\*\*|__/g, "").replace(/^#{1,3}\s+/, "").trim();
}

function parse(text: string, prefix: string): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  let list: string[] | null = null;
  const push = (b: Block) => {
    if (!cur) {
      cur = { id: `${prefix}0`, title: "", body: [] };
      out.push(cur);
    }
    cur.body.push(b);
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = clean(raw);
    if (!line) {
      list = null;
      continue;
    }
    const h = line.match(HEAD_RE);
    if (h && !/[.;:]$/.test(h[2])) {
      cur = { id: `${prefix}${out.length + 1}`, title: h[2], body: [] };
      out.push(cur);
      list = null;
      continue;
    }
    if (/^[-•–]\s+/.test(line)) {
      const item = line.replace(/^[-•–]\s+/, "");
      if (list) list.push(item);
      else {
        list = [item];
        push({ ul: list });
      }
      continue;
    }
    list = null;
    push({ p: line });
  }
  return out;
}

export default function SiteRules({ email }: { email: string }) {
  const [legal, setLegal] = useState<{ offer: string; privacy: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetchLegal().then(setLegal).catch(() => setFailed(true));
  }, []);

  const list = useMemo(() => {
    if (!legal) return [];
    const offer = parse(legal.offer || "", "o");
    const privacy = parse(legal.privacy || "", "p");
    if (privacy.length) privacy.unshift({ id: "privacy", title: "Политика конфиденциальности", body: [] });
    return [...offer, ...privacy].filter((s) => s.title || s.body.length);
  }, [legal]);
  const titled = list.filter((s) => s.title);
  const [active, setActive] = useState("");

  // подсветка текущего раздела в оглавлении
  useEffect(() => {
    if (!titled.length) return;
    const onScroll = () => {
      let cur = titled[0].id;
      for (const s of titled) {
        const el = document.getElementById(`r-${s.id}`);
        if (el && el.getBoundingClientRect().top <= 140) cur = s.id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = titled[titled.length - 1].id;
      setActive(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [titled]);

  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(`r-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const mail = email ? <a href={`mailto:${email}`}>{email}</a> : null;

  return (
    <main className="fs-rules">
      <div className="fs-wrap">
        <div className="fs-rules-head">
          <div className="fs-rules-eyebrow">{T.name}</div>
          <h1>Правила использования</h1>
        </div>

        {!legal && !failed ? <div className="fs-rules-empty">Загрузка…</div> : null}
        {(failed || (legal && !list.length)) ? (
          <div className="fs-rules-empty">
            {failed ? "Не удалось загрузить правила. Обновите страницу." : "Правила скоро появятся здесь."}
            {mail ? <> Вопросы — {mail}.</> : null}
          </div>
        ) : null}

        {list.length ? (
          <div className="fs-rules-body">
            <nav className="fs-rules-toc" aria-label="Содержание">
              {titled.map((s) => (
                <a key={s.id} href={`#r-${s.id}`} className={active === s.id ? "on" : undefined} onClick={jump(s.id)}>
                  {s.title}
                </a>
              ))}
            </nav>

            <div className="fs-rules-text">
              {list.map((s) => (
                <section key={s.id} id={`r-${s.id}`}>
                  {s.title ? <h2>{s.title}</h2> : null}
                  {s.body.map((b, j) =>
                    "ul" in b ? (
                      <ul key={j}>
                        {b.ul.map((li, k) => (
                          <li key={k}>{li}</li>
                        ))}
                      </ul>
                    ) : (
                      <p key={j}>{b.p}</p>
                    ),
                  )}
                </section>
              ))}
              {mail ? <p className="fs-rules-note">Вопросы по правилам — {mail}</p> : null}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
