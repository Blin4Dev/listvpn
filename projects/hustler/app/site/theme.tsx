// Hustler: тема сайта — ночная улица. Чёрный фон, красный акцент, шрифт Manrope (как в мини-приложении),
// заголовки капсом; за первым экраном — фото улицы с затемнением, справа — щит-логотип с красным свечением.
import React from "react";
import { ArtPill, BASE_C, BASE_T, BASE_VARS } from "./themeBase";

export * from "./themeBase";

const FONT = "'Manrope', system-ui, sans-serif";

export const C = {
  ...BASE_C,
  font: FONT,
  display: FONT,
  text: "#F5F5F5",
  green: "#FF2A20",      // акцент для текста (красный макета чуть светлее — читается на чёрном)
  greenDeep: "#E10600",
  ok: "#22C55E",
  cardBg: "#141414",
  iconBg: "#1C1C1C",
  danger: "#FF4B40",
};

export const VARS: Record<string, string> = {
  ...BASE_VARS,
  "--fs-page": "#000000",
  "--fs-deepest": "#060606",
  "--fs-deep": "#0C0C0C",
  "--fs-card-lo": "#101010",
  "--fs-card": "#141414",
  "--fs-raise": "#1E1E1E",
  "--fs-raise2": "#1A1A1A",
  "--fs-line": "#2C2C2C",
  "--fs-mut-rgb": "190, 190, 190",
  "--fs-mut2": "#9A9A9A",
  "--fs-mut3": "#6E6E6E",
  "--fs-light": "#F5F5F5",
  "--fs-text2": "#E8E8E8",
  "--fs-acc-rgb": "225, 6, 0",
  "--fs-acc-hi": "#FF4A40",
  "--fs-acc-soft": "rgba(225, 6, 0, .16)",
  "--fs-acc-tint": "#160606",
  "--fs-ok-rgb": "34, 197, 94",
  "--fs-ok-bg": "#0D2015",
  "--fs-ok-bg2": "#123020",
  "--fs-ok-line": "#1C5232",
  "--fs-ok-text": "#A6E8BC",
  "--fs-price-bg": "linear-gradient(135deg, #1A0605 0%, #0E0B0B 55%, #080808 100%)",
  "--fs-primary": "#E10600",
  "--fs-on-primary": "#FFFFFF",
  "--fs-primary-soft": "#E10600",
  "--fs-primary-login": "#E10600",
};

export const T = {
  ...BASE_T,
  name: "Hustler",
  homeTitle: "Hustler — VPN для тех, кто в движении",
  heroEyebrow: "Hustler · VPN-сервис",
  heroTitle: "VPN для тех, кто всегда в движении",
  heroLead: "Один клик — и вы под защитой. Быстрые серверы, никаких лимитов трафика и все устройства в одной подписке.",
  whyEyebrow: "Почему Hustler",
  whyTitle: ["Без лимитов, без лишнего", "только скорость"],
  planName: "Hustler · VPN",
  tariffEyebrow: "Hustler · Подписка",
  shareText: "Быстрый VPN без лимитов — Hustler",
};

export function Logo({ onClick }: { dot?: boolean; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <a href="/" onClick={onClick} className="fs-logo hs" aria-label="Hustler">
      <img src="/assets/logo.png" alt="" />
      HUSTLER
    </a>
  );
}

export function HeroArt() {
  return (
    <div className="fs-orb hs">
      <div className="fs-ring" style={{ width: 380, height: 380, borderColor: "rgba(255,255,255,.07)" }} />
      <div className="fs-ring" style={{ width: 470, height: 470, borderColor: "rgba(255,255,255,.035)" }} />
      <div className="hs-glow" />
      <img className="hs-shield" src="/assets/logo.png" alt="" />
      <ArtPill pos="p1" icon="bolt" color="#FF2A20">Подключение в один клик</ArtPill>
      <ArtPill pos="p2" icon="lock" color="#22C55E">Трафик под защитой</ArtPill>
    </div>
  );
}

/** фото улицы за первым экраном (как фон мини-приложения), уходит в чёрный */
export function Backdrop() {
  return <div className="hs-street" aria-hidden />;
}

export const THEME_CSS = `
@font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;src:url(/assets/manrope-cyrillic-wght-normal.woff2) format('woff2');unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;src:url(/assets/manrope-latin-wght-normal.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}

.fs-logo.hs { gap: 10px; font-size: 15px; font-weight: 800; letter-spacing: .22em; }
.fs-logo.hs img { width: 24px; height: auto; }
.fs-foot .fs-logo.hs img { width: 20px; }

.hs-street { position: absolute; left: 0; right: 0; top: 0; height: 820px; z-index: 0; pointer-events: none;
  background: linear-gradient(to bottom, rgba(0,0,0,.72) 0%, rgba(0,0,0,.55) 40%, rgba(0,0,0,.92) 85%, #000 100%),
              linear-gradient(to right, rgba(0,0,0,.85) 0%, rgba(0,0,0,.35) 55%, rgba(0,0,0,.6) 100%),
              #000 url(/assets/home-bg-poster.jpg) center 40% / cover no-repeat; }

.fs-h1, .fs-h2 { text-transform: uppercase; letter-spacing: -.01em; font-weight: 800; }
.fs-h1 { font-size: 44px; line-height: 1.08; }
.fs-lead { color: rgba(225,225,225,.82); }
.fs-eyebrow::before { background: #E10600; }

.fs-orb.hs { height: 460px; }
.hs-glow { position: absolute; width: 360px; height: 360px; border-radius: 50%;
  background: radial-gradient(circle, rgba(225,6,0,.38) 0%, rgba(225,6,0,.1) 45%, transparent 70%); filter: blur(4px); }
.hs-shield { position: relative; width: 230px; height: auto; filter: drop-shadow(0 24px 50px rgba(0,0,0,.8)); }
.fs-orb.hs .fs-pill.p1 { left: 2%; top: 14%; }
.fs-orb.hs .fs-pill.p2 { right: 0; bottom: 20%; }

.fs-card { background: rgba(20,20,20,.88); border-color: rgba(255,255,255,.1); }
.fs-btn.white:hover, .fs-cbtn:not(.dark):hover:not(:disabled), .fs-try:hover:not(:disabled) { filter: brightness(1.15); opacity: 1; }
@media (max-width: 860px) {
  .fs-h1 { font-size: 32px; }
  .fs-orb.hs { height: 380px; }
  .hs-shield { width: 180px; }
  .hs-glow { width: 280px; height: 280px; }
  .hs-street { height: 980px; }
}
`;
