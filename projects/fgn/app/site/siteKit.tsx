// FGN сайт: общие части кабинета/оплаты — форматирование, шапка страницы, плитки, модалка, иконки, стили.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../utils/api";
import { copyText } from "../components/SubLinkBox";
import { C } from "../components/fgn";
import { IcBack, IcChevron, IcClose, Svg } from "./SiteDownload";

// навигация страниц кабинета
export type CabNav = { go: (href: string) => void; expired: () => void };

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 10, b = Math.abs(n) % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
export const daysWord = (n: number) => plural(n, "день", "дня", "дней");
export const periodTitle = (m: number) => (m === 12 ? "1 год" : `${m} ${plural(m, "месяц", "месяца", "месяцев")}`);
export const PERIOD_DAYS: Record<number, number> = { 1: 30, 3: 90, 6: 180, 12: 365 };
// «1 100 ₽»
export const rub = (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;

export const isAuthErr = (e: unknown) => e instanceof ApiError && e.status === 401;
export function errText(e: unknown, fallback = "Не получилось. Попробуйте ещё раз."): string {
  if (e instanceof Error && e.message && !/^HTTP \d+$/.test(e.message)) return e.message;
  return fallback;
}

// копирование с отметкой «Скопировано» на 1.6 с
export function useCopied(): [string, (text: string, key?: string) => Promise<void>] {
  const [done, setDone] = useState("");
  const t = useRef<number>();
  const copy = useCallback(async (text: string, key = "1") => {
    if (!text) return;
    if (await copyText(text)) {
      setDone(key);
      window.clearTimeout(t.current);
      t.current = window.setTimeout(() => setDone(""), 1600);
    }
  }, []);
  useEffect(() => () => window.clearTimeout(t.current), []);
  return [done, copy];
}

// загрузка данных страницы: 401 → выход, остальное — текст ошибки
export function useLoad<T>(load: () => Promise<T>, nav: CabNav, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const reload = useCallback(async () => {
    try {
      const d = await load();
      setData(d);
      setErr("");
    } catch (e) {
      if (isAuthErr(e)) nav.expired();
      else setErr(errText(e, "Не удалось загрузить данные. Обновите страницу."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, err, reload, setData };
}

// статус подписки → бейдж
export function subBadge(status?: string | null): { text: string; tone: "" | "grey" | "warn" } {
  switch (status) {
    case "active":
      return { text: "Активна", tone: "" };
    case "trial":
      return { text: "Пробная", tone: "" };
    case "expired":
      return { text: "Истекла", tone: "warn" };
    case "blocked":
    case "banned":
      return { text: "Заблокирована", tone: "warn" };
    default:
      return { text: "Нет подписки", tone: "grey" };
  }
}

export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - Date.now()) / 86_400_000));
}

export const CAB_CSS = `
.fs-cab { position: relative; z-index: 1; }
.fs-cab .fs-wrap { padding-top: 56px; padding-bottom: 88px; }
.fs-cab-in { animation: fsFade .35s ease both; }
.fs-cab-hello { text-align: center; }
.fs-cab-eyebrow { font-size: 12px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: rgba(196,196,206,.62); }
.fs-cab-hello h1 { margin: 22px 0 0; font-size: 46px; line-height: 1.12; font-weight: 800; letter-spacing: -.015em; overflow-wrap: anywhere; }
.fs-cab-lead { margin: 16px auto 0; max-width: 520px; font-size: 16px; line-height: 1.6; color: rgba(196,196,206,.8); }
.fs-cab-top { display: flex; align-items: center; gap: 16px; min-height: 46px; }
.fs-cab-top h1 { margin: 0; flex: 1; min-width: 0; font-size: 40px; line-height: 1.1; font-weight: 800; letter-spacing: -.015em; }
.fs-cab-top .r { flex-shrink: 0; margin-left: auto; }
.fs-cab-back { width: 46px; height: 46px; flex-shrink: 0; border-radius: 12px; border: 1px solid rgba(255,255,255,.08); background: #18191B; color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; transition: border-color .15s; }
.fs-cab-back:hover { border-color: rgba(255,255,255,.22); }
.fs-cab-sub { margin: 14px 0 0; font-size: 15.5px; line-height: 1.55; color: rgba(196,196,206,.78); }
.fs-cab-label { margin: 36px 0 14px; font-size: 12px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: rgba(196,196,206,.62); }
.fs-cab-card { background: #18191B; border: 1px solid rgba(255,255,255,.07); border-radius: 16px; padding: 24px; box-sizing: border-box; min-width: 0; }
.fs-cab-card h3 { margin: 0; font-size: 19px; font-weight: 700; line-height: 24px; }
.fs-cab-k { font-size: 12px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: rgba(196,196,206,.62); }
.fs-cab-muted { color: rgba(196,196,206,.7); font-size: 14px; line-height: 1.55; }
.fs-cab-grid { display: grid; gap: 16px; }
.fs-cab-grid.c2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.fs-cab-grid.c3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.fs-cab-grid + .fs-cab-grid { margin-top: 16px; }
.fs-cab-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.fs-cab-split.wide { grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); }
.fs-cab-center { max-width: 480px; margin: 0 auto; }
.fs-cab-tile { width: 100%; min-height: 80px; display: flex; align-items: center; gap: 16px; padding: 16px 20px; box-sizing: border-box; text-align: left;
  border-radius: 16px; border: 1px solid rgba(255,255,255,.07); background: #18191B; color: #fff; font: inherit; cursor: pointer;
  text-decoration: none; transition: border-color .15s, filter .15s; }
.fs-cab-tile:hover:not(:disabled) { border-color: rgba(255,255,255,.18); }
.fs-cab-tile:disabled { opacity: .55; cursor: default; }
.fs-cab-tile .ic { width: 46px; height: 46px; flex-shrink: 0; border-radius: 12px; background: #222326; display: flex; align-items: center; justify-content: center; color: #fff; }
.fs-cab-tile .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.fs-cab-tile b { font-size: 18px; font-weight: 600; line-height: 22px; }
.fs-cab-tile small { font-size: 14px; line-height: 18px; color: rgba(196,196,206,.68); }
.fs-cab-tile.red { background: #241616; border-color: #5A3030; } .fs-cab-tile.red .ic { background: #3A2222; color: #E7B4B4; }
.fs-cab-tile.green { background: #13241C; border-color: #24543A; } .fs-cab-tile.green .ic { background: #1C3A2A; color: #B7E7C8; }
.fs-cab-tile.yellow { background: #262014; border-color: #5A4C28; } .fs-cab-tile.yellow .ic { background: #3A3218; color: #EAD7A2; }
.fs-cab-tile.red:hover, .fs-cab-tile.green:hover, .fs-cab-tile.yellow:hover { filter: brightness(1.12); }
.fs-badge { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 16px; border-radius: 17px; font-size: 14px; font-weight: 600;
  white-space: nowrap; border: 1px solid rgba(52,214,124,.45); color: ${C.green}; background: rgba(52,214,124,.06); box-sizing: border-box; }
.fs-badge.sm { height: 28px; padding: 0 11px; font-size: 12.5px; }
.fs-badge.grey { border-color: rgba(255,255,255,.14); color: rgba(220,220,228,.8); background: rgba(255,255,255,.03); }
.fs-badge.warn { border-color: rgba(255,178,63,.45); color: ${C.warn}; background: rgba(255,178,63,.06); }
.fs-cbtn { height: 52px; padding: 0 22px; border-radius: 14px; border: 1px solid transparent; background: #fff; color: #0A0A0A;
  font: 600 16px ${C.font}; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 9px; box-sizing: border-box;
  text-decoration: none; transition: opacity .15s, border-color .15s; white-space: nowrap; }
.fs-cbtn:hover:not(:disabled) { opacity: .9; }
.fs-cbtn.block { width: 100%; }
.fs-cbtn.dark { background: #0F1011; color: #fff; border-color: rgba(255,255,255,.1); }
.fs-cbtn.dark:hover:not(:disabled) { opacity: 1; border-color: rgba(255,255,255,.24); }
.fs-cbtn:disabled { background: #8A8A8C; color: #262628; cursor: default; }
.fs-cbtn.dark:disabled { background: #0F1011; color: rgba(255,255,255,.35); }
.fs-cbtn.sm { height: 42px; padding: 0 16px; border-radius: 12px; font-size: 14.5px; }
.fs-cbtn.danger { height: 38px; padding: 0 14px; border-radius: 11px; font-size: 14px; background: #241616; color: #E7B4B4; border-color: #5A3030; }
.fs-cbtn.danger:disabled { opacity: .5; background: #241616; color: #E7B4B4; }
.fs-cinput { width: 100%; height: 52px; padding: 0 16px; border-radius: 14px; border: 1px solid rgba(255,255,255,.1); background: #0E0F10; color: #fff;
  font: 500 16px ${C.font}; box-sizing: border-box; outline: none; transition: border-color .15s; }
.fs-cinput:focus { border-color: rgba(255,255,255,.3); }
.fs-cinput::placeholder { color: rgba(196,196,206,.45); }
.fs-cab-row { display: flex; gap: 10px; }
.fs-cab-row > .fs-cinput { flex: 1; min-width: 0; }
.fs-cab-note { margin-top: 12px; padding: 12px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; border: 1px solid; }
.fs-cab-note.ok { background: #13241C; border-color: #24543A; color: #B7E7C8; }
.fs-cab-note.err { background: #241616; border-color: #5A3030; color: #E7B4B4; }
.fs-cab-note.info { background: #262014; border-color: #5A4C28; color: #EAD7A2; }
.fs-cab-lines > div { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; font-size: 15.5px; }
.fs-cab-lines > div + div { border-top: 1px solid rgba(255,255,255,.07); }
.fs-cab-lines span { color: rgba(196,196,206,.75); }
.fs-cab-lines b { font-weight: 600; text-align: right; }
.fs-cab-loader { display: flex; justify-content: center; padding: 120px 0; }
.fs-cab-loader i { width: 30px; height: 30px; border-radius: 50%; border: 3px solid rgba(255,255,255,.12); border-top-color: ${C.green}; animation: fsSpin .8s linear infinite; }
@keyframes fsSpin { to { transform: rotate(360deg); } }
.fs-cab-empty { padding: 36px 24px; text-align: center; color: rgba(196,196,206,.7); font-size: 15px; line-height: 1.55; }
.fs-cab-link { background: none; border: 0; padding: 0; font: inherit; color: rgba(196,196,206,.75); cursor: pointer; text-decoration: none; }
.fs-cab-link:hover { color: #fff; }
.fs-cab-link.g { color: ${C.green}; }
@media (max-width: 860px) {
  .fs-cab .fs-wrap { padding-top: 32px; padding-bottom: 64px; }
  .fs-cab-hello h1 { font-size: 32px; }
  .fs-cab-lead { font-size: 15px; }
  .fs-cab-top { gap: 12px; flex-wrap: wrap; }
  .fs-cab-top h1 { font-size: 28px; }
  .fs-cab-back { width: 42px; height: 42px; }
  .fs-cab-grid.c2, .fs-cab-grid.c3, .fs-cab-split, .fs-cab-split.wide { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .fs-cab-grid + .fs-cab-grid { margin-top: 12px; }
  .fs-cab-card { padding: 20px; }
  .fs-cab-label { margin-top: 28px; }
  .fs-cab-tile { min-height: 72px; padding: 14px 16px; gap: 14px; }
  .fs-cab-tile b { font-size: 16.5px; }
  .fs-cab-tile .ic { width: 42px; height: 42px; }
}
@media (max-width: 420px) {
  .fs-cab-hello h1 { font-size: 28px; }
  .fs-cab-top h1 { font-size: 25px; }
  .fs-cab-row { flex-direction: column; }
  .fs-cab-row > .fs-cbtn { width: 100%; }
}
`;

// шапка страницы: ‹ Заголовок ……… [справа]
export function CabTop({ title, onBack, right, sub }: { title: React.ReactNode; onBack?: () => void; right?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <>
      <div className="fs-cab-top">
        {onBack ? (
          <button type="button" className="fs-cab-back" aria-label="Назад" onClick={onBack}>
            <IcBack />
          </button>
        ) : null}
        <h1>{title}</h1>
        {right ? <div className="r">{right}</div> : null}
      </div>
      {sub ? <p className="fs-cab-sub">{sub}</p> : null}
    </>
  );
}

export function Tile({ tone, icon, title, sub, onClick, disabled, chevron = true }: {
  tone?: "red" | "green" | "yellow";
  icon: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  chevron?: boolean;
}) {
  return (
    <button type="button" className={`fs-cab-tile${tone ? ` ${tone}` : ""}`} onClick={onClick} disabled={disabled}>
      <span className="ic">{icon}</span>
      <span className="tx">
        <b>{title}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
      {chevron ? <IcChevron /> : null}
    </button>
  );
}

export function Loader() {
  return (
    <div className="fs-cab-loader">
      <i />
    </div>
  );
}

export function Note({ kind, children }: { kind: "ok" | "err" | "info"; children: React.ReactNode }) {
  return <div className={`fs-cab-note ${kind}`}>{children}</div>;
}

// модалка (на телефоне — шторка снизу; стили .fs-sheet из SiteDownload)
export function Modal({ title, onClose, children, busy }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; busy?: boolean }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose, busy]);
  return (
    <div className="fs-sheet-bg" onClick={() => !busy && onClose()}>
      <div className="fs-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="fs-sheet-head">
          <div>{title}</div>
          <button type="button" className="fs-round" aria-label="Закрыть" onClick={() => !busy && onClose()}>
            <IcClose />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── иконки 24×24 ──
const I = (size: number, stroke: number, d: React.ReactNode) => <Svg size={size} stroke={stroke}>{d}</Svg>;
export const Ic = {
  gift: (s = 20) => I(s, 1.8, <><rect x="3.5" y="8" width="17" height="4" rx="1" /><path d="M5 12v8h14v-8M12 8v12M12 8c-1.5-3-5-3.5-5-1.2C7 8 9.5 8 12 8zM12 8c1.5-3 5-3.5 5-1.2C17 8 14.5 8 12 8z" /></>),
  users: (s = 20) => I(s, 1.8, <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><circle cx="16.5" cy="9" r="2.4" /><path d="M16.5 14.4c2.1 0 3.6 1.3 4 3.6" /></>),
  userPlus: (s = 20) => I(s, 1.8, <><circle cx="10" cy="8.5" r="3.2" /><path d="M4 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5M18.5 7v6M15.5 10h6" /></>),
  logout: (s = 20) => I(s, 1.8, <><path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10M15 8l4 4-4 4M19 12H9.5" /></>),
  download: (s = 20) => I(s, 1.9, <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />),
  bag: (s = 20) => I(s, 1.8, <><path d="M5.5 8h13l-1 12h-11z" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></>),
  phone: (s = 20) => I(s, 1.8, <><rect x="7" y="3" width="10" height="18" rx="2.2" /><path d="M12 9v4M10 11h4" /></>),
  monitor: (s = 20) => I(s, 1.8, <><rect x="3.5" y="4.5" width="17" height="11.5" rx="2" /><path d="M9 20h6M12 16v4" /></>),
  check: (s = 20) => I(s, 2.4, <path d="M5 12.5l4.5 4.5L19 7.5" />),
  plus: (s = 17) => I(s, 2, <path d="M5 12h14M12 5v14" />),
  minus: (s = 17) => I(s, 2, <path d="M5 12h14" />),
  copy: (s = 18) => I(s, 2, <><rect x="8.5" y="8.5" width="11" height="11" rx="2.2" /><path d="M15.5 8.5V6.2a1.7 1.7 0 0 0-1.7-1.7H6.2a1.7 1.7 0 0 0-1.7 1.7v7.6c0 .94.76 1.7 1.7 1.7h2.3" /></>),
  sbp: (s = 22) => I(s, 1.7, <><path d="M4 7l4.5 2.6v5L4 17z" /><path d="M8.5 9.6L13 7v10l-4.5-2.4M13 7l7 4-7 4" /></>),
  card: (s = 22) => I(s, 1.7, <><rect x="3" y="5.5" width="18" height="13" rx="2.2" /><path d="M3 10h18M7 15h3" /></>),
  wallet: (s = 22) => I(s, 1.7, <><rect x="3" y="6" width="18" height="13" rx="2.4" /><path d="M16 12.5h2M3 9h14.5a2.5 2.5 0 0 0 0-5H6a3 3 0 0 0-3 3" /></>),
  key: (s = 20) => I(s, 1.8, <><circle cx="8" cy="15" r="4" /><path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2" /></>),
  x: (s = 22) => I(s, 2.2, <path d="M6 6l12 12M18 6L6 18" />),
};
