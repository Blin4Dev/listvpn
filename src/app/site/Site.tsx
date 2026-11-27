// Сайт проекта в браузере (features.site) — вместо мини-приложения вне Telegram.
// Отличия проектов (цвета, шрифты, логотип, главная, тексты) — в теме: ./theme (projects/<id>/app/site/theme.tsx).
// В Telegram открывается мини-апп, в обычном браузере main.tsx рисует эту страницу.
// Ссылки на установщики и версия — из /api/app/config → desktop (панель: Настройки → Проект → «Сайт»).
// Страницы — по пути (history API, nginx/caddy отдают index.html): «/» — главная, «/support» — поддержка.
// «/login» — вход, «/tariffs» — тарифы, «/download» — установка на любое устройство. «/rules» — правила.
// «/cabinet…» — кабинет (SiteCabinet), «/cabinet/gifts», «/gifts/*» — подарки, «/cabinet/referral» — рефералка,
// «/checkout» — оплата, «/payment/return» — возврат из ЮKassa. Без входа эти страницы ведут на /login?next=…
import React, { useCallback, useEffect, useState } from "react";
import { PROJECT_ID } from "../utils/brand";
import { ApiError, appFetch, clearAppToken, getAppToken, getWebRef } from "../utils/api";
import { Backdrop, C, HeroArt, Logo, T, THEME_CSS, VARS, rootVars } from "./theme";
import SiteSupport, { SUPPORT_CSS } from "./SiteSupport";
import SiteLogin, { LOGIN_CSS } from "./SiteLogin";
import SiteTariffs, { TARIFFS_CSS } from "./SiteTariffs";
import SiteRules, { RULES_CSS } from "./SiteRules";
import SiteDownload, { DOWNLOAD_CSS } from "./SiteDownload";
import SiteCabinet, { CABINET_CSS } from "./SiteCabinet";
import SiteGifts, { GIFTS_CSS } from "./SiteGifts";
import SiteReferral, { REFERRAL_CSS } from "./SiteReferral";
import SiteCheckout, { CHECKOUT_CSS } from "./SiteCheckout";
import { CAB_CSS, Loader, daysWord, type CabNav } from "./siteKit";
import TrialButton, { TRIAL_CSS } from "./SiteTrial";
import SiteMigration, { MIGRATION_CSS } from "./SiteMigration";
import type { CaptchaPublic } from "../components/CaptchaBox";

const LINKS = {
  login: "/login",
  cabinet: "/cabinet",
  tariffs: "/tariffs",
  rules: "/rules",
  support: "/support",
  download: "/download",
  email: T.email,
};

// ── маршрут сайта: путь + переход без перезагрузки ──
function usePath() {
  const [path, setPath] = useState(() => window.location.pathname.replace(/\/+$/, "") || "/");
  useEffect(() => {
    const on = () => setPath(window.location.pathname.replace(/\/+$/, "") || "/");
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  const go = useCallback((href: string) => {
    const u = new URL(href, window.location.origin);
    const next = u.pathname.replace(/\/+$/, "") || "/";
    if (u.pathname + u.search + u.hash !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.pushState(null, "", u.pathname + u.search + u.hash);
    }
    setPath(next);
    // якорь — после отрисовки страницы
    window.setTimeout(() => {
      const el = u.hash ? document.getElementById(u.hash.slice(1)) : null;
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo(0, 0);
    }, 0);
  }, []);
  return { path, go };
}

// куда вернуть после входа: ?next=/путь (только свой сайт)
function loginNext(): string {
  try {
    const n = new URLSearchParams(window.location.search).get("next") || "/";
    return /^\/(?!\/)/.test(n) && !n.startsWith("/login") ? n : "/";
  } catch {
    return "/";
  }
}

// вход на сайте: сессия X-App-Session (localStorage), проверка через /me
function useAuth() {
  const [authed, setAuthed] = useState<boolean | null>(() => (getAppToken() ? null : false));
  useEffect(() => {
    if (!getAppToken()) return;
    let alive = true;
    appFetch("/me")
      .then(() => alive && setAuthed(true))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          clearAppToken();
          setAuthed(false);
        } else setAuthed(true); // сеть моргнула — не выкидываем
      });
    return () => {
      alive = false;
    };
  }, []);
  const expired = useCallback(() => {
    clearAppToken();
    setAuthed(false);
  }, []);
  const signedIn = useCallback(() => setAuthed(true), []);
  return { authed, expired, signedIn };
}

type Desktop = { windows_url?: string; macos_url?: string; version?: string };

function useSiteConfig() {
  const [desktop, setDesktop] = useState<Desktop>({});
  const [bot, setBot] = useState("");
  const [botId, setBotId] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaPublic | null>(null);
  const [trialDays, setTrialDays] = useState(0);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/app/config", { headers: { "X-Project": PROJECT_ID } });
        const body = (await res.json().catch(() => null)) as {
          botUsername?: string;
          miniappLink?: string;
          supportUrl?: string;
          telegramOauthBotId?: string;
          captcha?: CaptchaPublic;
          desktop?: Desktop;
          trialDays?: number;
        } | null;
        if (!res.ok || !body) return;
        if (body.telegramOauthBotId) setBotId(String(body.telegramOauthBotId));
        if (body.captcha && typeof body.captcha === "object") setCaptcha(body.captcha);
        if (body.desktop && typeof body.desktop === "object") setDesktop(body.desktop);
        if (typeof body.trialDays === "number") setTrialDays(body.trialDays);
        // бот: имя из настроек проекта; нет — из ссылки на мини-приложение (t.me/<бот>/app) или поддержки (t.me/<бот>)
        const fromLink = (u?: string) => (String(u || "").match(/t\.me\/([A-Za-z0-9_]{4,64}?bot)(?:[/?#]|$)/i) || [])[1] || "";
        const name = String(body.botUsername || "").trim().replace(/^@/, "") || fromLink(body.miniappLink) || fromLink(body.supportUrl);
        if (name) setBot(name);
      } catch {
        /* без конфига — кнопки ведут в бота / никуда */
      }
    })();
  }, []);
  return { desktop, bot, botId, captcha, trialDays };
}

// бот проекта: из конфига (/api/app/config → botUsername), пока не пришёл — из темы
const DEFAULT_BOT = T.defaultBot;

function TgIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.6 4.2 2.9 11.4c-1.3.5-1.3 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.4-2.3 4.9 3.6c.9.5 1.5.2 1.8-.8l3.2-15.2c.3-1.3-.5-1.9-1.8-1.5ZM8.3 14.1l9.9-6.3c.5-.3.9-.1.5.2l-8.4 7.6-.3 3.6-1.7-5.1Z" />
    </svg>
  );
}

// ── иконки (24×24, контур) ──
const ICON: Record<string, React.ReactNode> = {
  download: (
    <>
      <path d="M12 4v11" />
      <path d="m7 10.5 5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  checkbox: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="m8 12.2 2.8 2.8L16.2 9.4" />
    </>
  ),
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z" />,
  infinity: (
    <path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z" transform="rotate(90 12 12)" />
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" />
    </>
  ),
  shield: <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  devices: (
    <>
      <rect x="3" y="4" width="13" height="10" rx="1.8" />
      <path d="M7 18h5" />
      <rect x="16.5" y="9" width="5" height="11" rx="1.4" />
    </>
  ),
  headset: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="3" y="14" width="4" height="6" rx="1.5" />
      <rect x="17" y="14" width="4" height="6" rx="1.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};

function Icon({ name, size = 18, stroke = 1.8, color }: { name: string; size?: number; stroke?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || "currentColor"}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      {ICON[name]}
    </svg>
  );
}

const CSS = `
.fs { position: relative; min-height: 100vh; background: var(--fs-page); color: ${C.text}; font-family: ${C.font};
  overflow: hidden; -webkit-font-smoothing: antialiased; }
.fs a { color: inherit; text-decoration: none; }
.fs * { box-sizing: border-box; }
.fs-wrap { position: relative; width: 100%; max-width: 1038px; margin: 0 auto; padding: 0 24px; }

.fs-banner { position: relative; z-index: 3; height: 40px; display: flex; align-items: center; justify-content: center;
  gap: 14px; background: var(--fs-acc-tint); border-bottom: 1px solid rgba(var(--fs-acc-rgb), 0.28); font-size: 13px; color: var(--fs-text2); }
.fs-banner a { color: ${C.green}; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
.fs-banner button { position: absolute; right: 18px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px;
  border: 0; padding: 4px; background: none; color: rgba(255,255,255,.7); cursor: pointer; }
.fs-banner button:hover { color: #fff; }

.fs-head { position: relative; z-index: 3; border-bottom: 1px solid rgba(255,255,255,.05); }
.fs-head .fs-wrap { height: 68px; display: flex; align-items: center; }
.fs-logo { display: inline-flex; align-items: center; gap: 9px; font-weight: 800; font-size: 15px; letter-spacing: .2em; }
.fs-logo i { width: 6px; height: 6px; border-radius: 50%; background: ${C.green}; box-shadow: 0 0 8px rgba(var(--fs-acc-rgb), .8); }
.fs-nav { display: flex; align-items: center; gap: 33px; margin-left: 56px; font-size: 13px; color: rgba(var(--fs-mut-rgb), .82); }
/* кнопка бота — сразу за меню; «Скачать / Кабинет» прижаты вправо */
.fs-tg { display: inline-flex; align-items: center; gap: 8px; height: 34px; margin-left: 30px; padding: 0 14px 0 11px; border-radius: 999px;
  font-size: 13px; font-weight: 600; color: #fff; white-space: nowrap; background: rgba(var(--fs-acc-rgb), .1); border: 1px solid rgba(var(--fs-acc-rgb), .35);
  transition: background .15s, border-color .15s; }
.fs-tg:hover { background: rgba(var(--fs-acc-rgb), .18); border-color: rgba(var(--fs-acc-rgb), .6); }
.fs-tg svg { flex: none; color: ${C.green}; }
@media (max-width: 1060px) { .fs-nav { margin-left: 36px; gap: 24px; } .fs-tg { margin-left: 20px; } }
.fs-nav a:hover { color: #fff; }
.fs-nav a.on { color: #fff; position: relative; }
.fs-nav a.on::after { content: ""; position: absolute; left: 0; right: 0; bottom: -8px; height: 1.5px; border-radius: 1px; background: #fff; }
.fs-actions { display: flex; gap: 13px; margin-left: auto; }
.fs-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; height: 39px; padding: 0 18px;
  border-radius: 10px; font: 600 13px ${C.font}; cursor: pointer; border: 1px solid transparent; transition: filter .15s, background .15s; white-space: nowrap; }
.fs-btn:hover { filter: brightness(1.12); }
.fs-btn.dark { background: var(--fs-card); border-color: rgba(255,255,255,.1); color: #fff; }
.fs-btn.white { background: var(--fs-primary); color: var(--fs-on-primary); }
.fs-burger { display: none; margin-left: auto; width: 40px; height: 40px; border-radius: 10px; border: 1px solid rgba(255,255,255,.1);
  background: var(--fs-card-lo); color: #fff; align-items: center; justify-content: center; cursor: pointer; }
.fs-menu { display: none; }

.fs-hero .fs-wrap { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 24px; padding-top: 46px; padding-bottom: 96px; }
.fs-eyebrow { display: flex; align-items: center; gap: 10px; font-size: 11px; font-weight: 600; letter-spacing: .14em;
  color: rgba(var(--fs-mut-rgb), .7); text-transform: uppercase; }
.fs-eyebrow::before { content: ""; width: 20px; height: 1.5px; background: ${C.greenDeep}; }
.fs-h1 { font-family: ${C.display}; margin: 26px 0 0; font-size: 46px; line-height: 1.12; font-weight: 800; letter-spacing: -.01em; max-width: 520px; }
.fs-lead { margin: 22px 0 0; font-size: 15px; line-height: 1.6; color: rgba(var(--fs-mut-rgb), .8); max-width: 500px; }
.fs-dl { display: flex; gap: 12px; margin-top: 30px; }
.fs-dl a { height: 48px; padding: 0 26px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center;
  gap: 12px; font-size: 14px; font-weight: 600; border: 1px solid transparent; transition: filter .15s; }
.fs-dl a:hover { filter: brightness(1.12); }
.fs-dl a.primary { background: var(--fs-cta-bg); color: #111; border-color: rgba(255,255,255,.18); }
.fs-dl a.secondary { background: var(--fs-deep); color: rgba(var(--fs-mut-rgb), .7); border-color: rgba(255,255,255,.07); }
.fs-meta { margin-top: 26px; display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: rgba(var(--fs-mut-rgb), .72); }
.fs-note { margin-top: 18px; font-size: 11.5px; color: rgba(var(--fs-mut-rgb), .72); }

.fs-orb { position: relative; height: 420px; display: flex; align-items: center; justify-content: center; }
.fs-ring { position: absolute; border-radius: 50%; border: 1px solid rgba(255,255,255,.05); }
.fs-sphere { position: relative; width: 300px; height: 300px; border-radius: 50%;
  background: radial-gradient(circle at 42% 38%, #EDEDE4 0%, #E2E2D8 38%, #C8C9BC 72%, #A0A293 100%);
  box-shadow: 0 0 60px 6px rgba(225,226,214,.18), 0 0 140px 30px rgba(225,226,214,.06), inset -14px -18px 40px rgba(60,62,50,.28);
  display: flex; align-items: center; justify-content: center; }
.fs-pill { position: absolute; z-index: 2; display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 16px;
  border-radius: 999px; background: rgba(18,19,20,.92); border: 1px solid rgba(255,255,255,.12); font-size: 11.5px; font-weight: 600;
  color: var(--fs-text2); white-space: nowrap; box-shadow: 0 8px 24px rgba(0,0,0,.5); animation: fsBob 6s ease-in-out infinite; }
.fs-pill.p1 { left: 4%; top: 18%; }
.fs-pill.p2 { right: -1%; bottom: 25%; animation-delay: -3s; }

.fs-sec { position: relative; z-index: 1; border-top: 1px solid rgba(255,255,255,.03); }
.fs-sec .fs-wrap { padding-top: 76px; padding-bottom: 76px; }
.fs-h2 { font-family: ${C.display}; margin: 18px 0 0; font-size: 28px; line-height: 1.22; font-weight: 800; letter-spacing: -.005em; }
.fs-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 36px; }
.fs-card { background: var(--fs-card); border: 1px solid rgba(255,255,255,.07); border-radius: 14px; }
.fs-feat { min-height: 108px; padding: 24px 20px; display: flex; align-items: center; gap: 14px; }
.fs-feat .ic { width: 36px; height: 36px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  background: var(--fs-acc-soft); border: 1px solid rgba(var(--fs-acc-rgb), .3); color: ${C.green}; }
.fs-feat b { display: block; font-size: 13.5px; font-weight: 700; }
.fs-feat span { display: block; margin-top: 7px; font-size: 11.5px; line-height: 1.6; color: rgba(var(--fs-mut-rgb), .66); }
.fs-step { min-height: 192px; padding: 24px; display: flex; flex-direction: column; justify-content: flex-end; }
.fs-step b { font-size: 16px; font-weight: 700; }
.fs-step span { margin-top: 11px; font-size: 11.5px; line-height: 1.65; color: rgba(var(--fs-mut-rgb), .66); }

.fs-price { margin-top: 0; padding: 74px 24px; text-align: center; border-radius: 16px; border: 1px solid rgba(255,255,255,.07);
  background: var(--fs-price-bg); }
.fs-price .fs-eyebrow { justify-content: center; }
.fs-price p { margin: 16px auto 0; max-width: 450px; font-size: 13px; line-height: 1.6; color: rgba(var(--fs-mut-rgb), .7); }
.fs-price .fs-btn { margin-top: 34px; height: 48px; padding: 0 26px; background: var(--fs-deep); border-color: rgba(255,255,255,.08); color: #fff; }

.fs-foot { position: relative; z-index: 1; border-top: 1px solid rgba(255,255,255,.05); }
.fs-foot .fs-wrap { min-height: 76px; display: flex; align-items: center; gap: 24px; font-size: 12px; color: rgba(var(--fs-mut-rgb), .75); }
.fs-foot .fs-logo { font-size: 13px; color: #fff; }
.fs-foot nav { flex: 1; display: flex; justify-content: center; flex-wrap: wrap; gap: 8px 24px; }
.fs-foot a:hover { color: #fff; }

.fs-dot { position: absolute; z-index: 0; pointer-events: none; animation: fsFloat 7s ease-in-out infinite; }
.fs-dot.w > i, .fs-dot.g > i { display: block; width: 6px; height: 6px; border-radius: 50%; animation: fsTwinkle 4.2s ease-in-out infinite; }
.fs-dot.w > i { background: #fff; box-shadow: 0 0 6px 2px rgba(255,255,255,.9), 0 0 18px 6px rgba(255,255,255,.3); }
.fs-dot.g > i { background: var(--fs-acc-hi); box-shadow: 0 0 6px 2px rgba(var(--fs-acc-rgb), .9), 0 0 18px 6px rgba(var(--fs-acc-rgb), .35); }
.fs-dot.leaf > div { filter: drop-shadow(0 0 8px rgba(var(--fs-acc-rgb), .55)); opacity: .9; }

@keyframes fsFloat { 0%,100% { transform: translate(-50%,-50%); } 50% { transform: translate(-50%, calc(-50% - 8px)); } }
@keyframes fsTwinkle { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
@keyframes fsBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
@media (prefers-reduced-motion: reduce) { .fs-dot, .fs-dot > i, .fs-pill { animation: none !important; } }

@media (max-width: 860px) {
  .fs-nav, .fs-actions, .fs-tg { display: none; }
  .fs-menu a.item.tg { display: flex; align-items: center; gap: 10px; color: #fff; }
  .fs-menu a.item.tg svg { color: ${C.green}; }
  .fs-burger { display: inline-flex; }
  .fs-menu { display: block; position: relative; z-index: 3; border-bottom: 1px solid rgba(255,255,255,.06); background: var(--fs-page); }
  .fs-menu .fs-wrap { padding-top: 6px; padding-bottom: 18px; }
  .fs-menu a.item { display: block; padding: 15px 0; font-size: 14px; color: var(--fs-text2); border-bottom: 1px solid rgba(255,255,255,.07); }
  .fs-menu .fs-btn { width: 100%; height: 46px; margin-top: 18px; font-size: 14px; }
  .fs-hero .fs-wrap { grid-template-columns: 1fr; padding-top: 18px; padding-bottom: 64px; gap: 8px; }
  .fs-orb { order: -1; height: 340px; }
  .fs-sphere { width: 220px; height: 220px; }
  .fs-pill.p1 { left: 0; top: 12%; }
  .fs-pill.p2 { right: 0; bottom: 14%; }
  .fs-h1 { font-size: 34px; }
  .fs-dl { flex-direction: column; }
  .fs-dl a { width: 100%; }
  .fs-grid { grid-template-columns: 1fr; }
  .fs-step { min-height: 150px; }
  .fs-sec .fs-wrap { padding-top: 56px; padding-bottom: 56px; }
  .fs-h2 { font-size: 24px; }
  .fs-price { padding: 54px 20px; }
  .fs-foot .fs-wrap { flex-direction: column; align-items: flex-start; padding-top: 28px; padding-bottom: 28px; gap: 16px; }
  .fs-foot nav { justify-content: flex-start; }
  .fs-banner { font-size: 12px; padding: 0 44px; }
}
@media (max-width: 420px) {
  .fs-wrap { padding: 0 18px; }
  .fs-h1 { font-size: 30px; }
  .fs-pill { font-size: 10.5px; height: 32px; padding: 0 12px; }
}
`;

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="fs-eyebrow">{children}</div>;
}

export default function Site() {
  const { desktop, bot, botId, captcha, trialDays } = useSiteConfig();
  const { path, go } = usePath();
  const { authed, expired, signedIn } = useAuth();
  const [banner, setBanner] = useState(true);
  const [menu, setMenu] = useState(false);
  const page = path === "/support" ? "support" : path === "/login" ? "login" : path === "/tariffs" ? "tariffs"
    : path === "/download" ? "download" : path === "/rules" ? "rules"
      : path === "/cabinet/referral" ? "referral"
        : path === "/cabinet/gifts" || path.startsWith("/gifts/") ? "gifts"
          : path === "/cabinet" || path.startsWith("/cabinet/") ? "cabinet"
            : path === "/checkout" || path === "/payment/return" ? "checkout" : "home";
  // страницы только для вошедших
  const privatePage = page === "cabinet" || page === "gifts" || page === "referral" || page === "checkout";

  useEffect(() => {
    document.title =
      page === "home" ? T.homeTitle
        : `${{ support: "Поддержка", login: "Вход", tariffs: "Тарифы", download: "Скачать", rules: "Правила использования",
          cabinet: "Кабинет", gifts: "Подарки", referral: "Реферальная программа", checkout: "Оплата" }[page]} — ${T.name}`;
  }, [page]);

  // вошёл, а открыт /login — уходим туда, откуда пришли
  useEffect(() => {
    if (page === "login" && authed) go(loginNext());
  }, [page, authed, go]);

  // закрытая страница без входа — на вход с возвратом сюда (вместе с ?параметрами)
  useEffect(() => {
    if (privatePage && authed === false) go(`${LINKS.login}?next=${encodeURIComponent(path + window.location.search)}`);
  }, [privatePage, authed, path, go]);

  // первый заход по /#download и т.п.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 50);
  }, []);

  // внутренние ссылки (/…) — без перезагрузки; «#» (заглушки) — никуда
  const link = (href: string) => ({
    href,
    onClick: (e: React.MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (href === "#") {
        e.preventDefault();
        return;
      }
      if (href.startsWith("/")) {
        e.preventDefault();
        setMenu(false);
        go(href);
      }
    },
  });
  const back = () => {
    if (window.history.length > 1 && document.referrer.startsWith(window.location.origin)) window.history.back();
    else go("/");
  };
  // «Войти» запоминает, куда вернуть после входа (/login?next=/support)
  const loginHref = page === "home" || page === "login" ? LINKS.login : `${LINKS.login}?next=${encodeURIComponent(path + window.location.search)}`;
  const cabNav: CabNav = { go, expired };
  // «Оформить» на тарифах: вошёл — к оплате, нет — сначала вход
  const checkout = (months: number, dev: number) => {
    const to = `/checkout?months=${months}&dev=${dev}`;
    go(authed ? to : `${LINKS.login}?next=${encodeURIComponent(to)}`);
  };
  const account = authed ? { href: LINKS.cabinet, label: "Кабинет" } : { href: loginHref, label: "Войти" };

  // пришёл по реф. ссылке и ещё не вошёл — в бота с тем же рефералом (бот засчитает его новому пользователю)
  // реферер мог определиться уже после отрисовки (ссылка амбассадора) — перерисовать кнопку бота
  const [, setRefTick] = useState(0);
  useEffect(() => {
    const on = () => setRefTick((x) => x + 1);
    window.addEventListener("blin-ref", on);
    return () => window.removeEventListener("blin-ref", on);
  }, []);
  const webRef = authed ? "" : getWebRef();
  const botName = bot || DEFAULT_BOT;
  const botUrl = botName ? `https://t.me/${botName}${/^\d{1,12}$/.test(webRef) ? `?start=ref_${webRef}` : ""}` : "";

  const nav = [
    { href: LINKS.tariffs, label: "Тарифы" },
    { href: LINKS.rules, label: "Правила использования" },
    { href: LINKS.download, label: "Скачать" },
    { href: LINKS.support, label: "Поддержка" },
  ];

  return (
    <div className="fs">
      <style>{rootVars(VARS) + CSS + SUPPORT_CSS + LOGIN_CSS + TARIFFS_CSS + DOWNLOAD_CSS + RULES_CSS + CAB_CSS + CABINET_CSS + GIFTS_CSS + REFERRAL_CSS + CHECKOUT_CSS + TRIAL_CSS + MIGRATION_CSS + THEME_CSS}</style>

      {/* пришёл из проекта, переданного под управление этого — окно «… теперь <бренд>» */}
      {T.migration && authed === true && page !== "login" ? <SiteMigration nav={cabNav} desktop={desktop} /> : null}

      <Backdrop />

      {banner && authed === false && page !== "login" ? (
        <div className="fs-banner">
          <span>Войдите через почту или Telegram</span>
          <a {...link(loginHref)}>Войти</a>
          <button type="button" aria-label="Закрыть" onClick={() => setBanner(false)}>
            <Icon name="close" size={16} stroke={2} />
          </button>
        </div>
      ) : null}

      <header className="fs-head">
        <div className="fs-wrap">
          <Logo onClick={link("/").onClick} />
          <nav className="fs-nav">
            {nav.map((n) => (
              <a key={n.label} {...link(n.href)} className={n.href === path || (n.href === LINKS.tariffs && path === "/checkout") ? "on" : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          {botUrl ? (
            <a className="fs-tg" href={botUrl} target="_blank" rel="noopener noreferrer">
              <TgIcon />
              Telegram bot
            </a>
          ) : null}
          <div className="fs-actions">
            <a className="fs-btn dark" {...link(LINKS.download)}>
              Скачать
            </a>
            <a className="fs-btn white" {...link(account.href)}>
              {account.label}
            </a>
          </div>
          <button type="button" className="fs-burger" aria-label="Меню" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            <Icon name={menu ? "close" : "menu"} size={18} stroke={2} />
          </button>
        </div>
      </header>

      {menu ? (
        <div className="fs-menu">
          <div className="fs-wrap">
            {nav.map((n) => (
              <a key={n.label} className="item" {...link(n.href)}>
                {n.label}
              </a>
            ))}
            {botUrl ? (
              <a className="item tg" href={botUrl} target="_blank" rel="noopener noreferrer">
                <TgIcon />
                Telegram bot
              </a>
            ) : null}
            <a className="fs-btn white" {...link(account.href)}>
              {account.label}
            </a>
          </div>
        </div>
      ) : null}

      {privatePage && authed !== true ? (
        <main className="fs-cab"><Loader /></main>
      ) : page === "cabinet" ? (
        <SiteCabinet path={path} nav={cabNav} desktop={desktop} />
      ) : page === "gifts" ? (
        <SiteGifts path={path} nav={cabNav} />
      ) : page === "referral" ? (
        <SiteReferral nav={cabNav} />
      ) : page === "checkout" ? (
        <SiteCheckout path={path} nav={cabNav} />
      ) : page === "login" ? (
        <SiteLogin botId={botId} captcha={captcha} onAuthed={signedIn} />
      ) : page === "download" ? (
        <SiteDownload desktop={desktop} authed={authed} email={LINKS.email} onLogin={() => go(loginHref)} />
      ) : page === "rules" ? (
        <SiteRules email={LINKS.email} />
      ) : page === "tariffs" ? (
        <SiteTariffs authed={authed} onCheckout={checkout} />
      ) : page === "support" ? (
        <SiteSupport
          bot={bot}
          authed={authed}
          loginHref={loginHref}
          onLogin={link(loginHref).onClick}
          onBack={back}
          onExpired={expired}
        />
      ) : (
      <>
      <section className="fs-hero" id="download">
        <div className="fs-wrap">
          <div style={{ position: "relative", zIndex: 1 }}>
            <Eyebrow>{T.heroEyebrow}</Eyebrow>
            <h1 className="fs-h1">{T.heroTitle}</h1>
            <p className="fs-lead">{T.heroLead}</p>
            <div className="fs-dl">
              <TrialButton authed={authed} nav={cabNav} desktop={desktop} trialDays={trialDays} bot={bot} />
            </div>
            <div className="fs-meta">
              <Icon name="checkbox" size={14} stroke={1.6} />
              {trialDays > 0 ? `${trialDays} ${daysWord(trialDays)} бесплатно · ` : ""}iPhone, Android, Windows, macOS, Linux и TV
            </div>
            {T.heroNote ? <div className="fs-note">{T.heroNote}</div> : null}
          </div>
          <HeroArt />
        </div>
      </section>

      <section className="fs-sec">
        <div className="fs-wrap">
          <Eyebrow>{T.whyEyebrow}</Eyebrow>
          <h2 className="fs-h2">
            {T.whyTitle.map((l, i) => (
              <React.Fragment key={i}>
                {i ? <br /> : null}
                {l}
              </React.Fragment>
            ))}
          </h2>
          <div className="fs-grid">
            {T.features.map((f) => (
              <div key={f.title} className="fs-card fs-feat">
                <div className="ic">
                  <Icon name={f.icon} size={17} />
                </div>
                <div>
                  <b>{f.title}</b>
                  <span>{f.text}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="fs-sec">
        <div className="fs-wrap">
          <Eyebrow>{T.stepsEyebrow}</Eyebrow>
          <h2 className="fs-h2">{T.stepsTitle}</h2>
          <div className="fs-grid">
            {T.steps.map((s) => (
              <div key={s.title} className="fs-card fs-step">
                <b>{s.title}</b>
                <span>{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="fs-sec" id="pricing" style={{ borderTop: 0 }}>
        <div className="fs-wrap" style={{ paddingTop: 0 }}>
          <div className="fs-price">
            <Eyebrow>Тарифы</Eyebrow>
            <h2 className="fs-h2">{T.priceTitle}</h2>
            <p>{T.priceText}</p>
            <a className="fs-btn" {...link(LINKS.tariffs)}>
              Смотреть тарифы
            </a>
          </div>
        </div>
      </section>
      </>
      )}

      <footer className="fs-foot">
        <div className="fs-wrap">
          <Logo dot={false} onClick={(e) => { e.preventDefault(); go("/"); }} />
          <nav>
            <a {...link(LINKS.rules)}>Правила использования</a>
            <a {...link(LINKS.tariffs)}>Тарифы</a>
            <a {...link(LINKS.download)}>Скачать</a>
            <a {...link(LINKS.support)}>Поддержка</a>
            {LINKS.email ? <a href={`mailto:${LINKS.email}`}>{LINKS.email}</a> : null}
          </nav>
          <div>© {new Date().getFullYear()} {T.name}. Все права защищены.</div>
        </div>
      </footer>
    </div>
  );
}
