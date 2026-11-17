// BatmanVPN: тема сайта — ночной Готэм. Почти чёрный фон с холодным оттенком, красный акцент (как кнопки мини-приложения),
// летучая мышь в логотипе, на главной — постер города с силуэтом мыши и красным свечением.
import React from "react";
import { ArtPill, BASE_C, BASE_T, BASE_VARS } from "./themeBase";

export * from "./themeBase";

export const C = {
  ...BASE_C,
  green: "#F01515",      // акцент (красный текст мини-приложения)
  greenDeep: "#E00000",
  ok: "#22C55E",
  cardBg: "#101016",
  iconBg: "#191920",
};

export const VARS: Record<string, string> = {
  ...BASE_VARS,
  "--fs-page": "#05050A",
  "--fs-deepest": "#040408",
  "--fs-deep": "#0B0B12",
  "--fs-card-lo": "#0E0E16",
  "--fs-card": "#13131B",
  "--fs-raise": "#1D1D27",
  "--fs-raise2": "#191922",
  "--fs-line": "#292935",
  "--fs-mut-rgb": "196, 196, 210",
  "--fs-mut2": "#9A9AA8",
  "--fs-mut3": "#6C6C7A",
  "--fs-acc-rgb": "240, 21, 21",
  "--fs-acc-hi": "#FF5252",
  "--fs-acc-soft": "rgba(224, 0, 0, .16)",
  "--fs-acc-tint": "#150A0E",
  "--fs-ok-rgb": "34, 197, 94",
  "--fs-ok-bg": "#0E2117",
  "--fs-ok-bg2": "#13321F",
  "--fs-ok-line": "#1D5532",
  "--fs-ok-text": "#A6E8BC",
  "--fs-price-bg": "linear-gradient(135deg, #1A0A0E 0%, #0F0A12 55%, #08080E 100%)",
  "--fs-primary": "#E00000",
  "--fs-on-primary": "#FFFFFF",
  "--fs-primary-soft": "#E00000",
  "--fs-primary-login": "#E00000",
};

export const T = {
  ...BASE_T,
  name: "BatmanVPN",
  homeTitle: "BatmanVPN — VPN, который всегда на страже",
  heroEyebrow: "BatmanVPN · VPN-сервис",
  heroTitle: "VPN, который всегда на страже",
  heroLead: "Подключайтесь за один клик и оставайтесь под защитой днём и ночью — на телефоне, компьютере и телевизоре.",
  whyEyebrow: "Почему BatmanVPN",
  whyTitle: ["Защита, которая работает", "тихо и без лишних настроек"],
  planName: "BatmanVPN · VPN",
  tariffEyebrow: "BatmanVPN · Подписка",
  shareText: "Быстрый и надёжный VPN — BatmanVPN",
};

export function Logo({ onClick }: { dot?: boolean; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <a href="/" onClick={onClick} className="fs-logo bm" aria-label="BatmanVPN">
      <img src="/assets/home-logo.png" alt="" />
      <span>
        BATMAN<b>VPN</b>
      </span>
    </a>
  );
}

export function HeroArt() {
  return (
    <div className="fs-orb bm">
      <div className="bm-glow" />
      <div className="bm-poster" />
      <ArtPill pos="p1" icon="shield" color="#F01515">Защищённое подключение</ArtPill>
      <ArtPill pos="p2" icon="bolt" color="#FFB23F">Подключение в один клик</ArtPill>
    </div>
  );
}

/** красное зарево сверху и холодная дымка снизу */
export function Backdrop() {
  return <div className="bm-sky" aria-hidden />;
}

export const THEME_CSS = `
.fs-logo.bm { gap: 10px; letter-spacing: .14em; font-size: 14px; }
.fs-logo.bm img { width: 30px; height: auto; filter: drop-shadow(0 0 8px rgba(240,21,21,.45)); }
.fs-logo.bm b { color: #F01515; font-weight: 800; margin-left: 2px; }
.fs-foot .fs-logo.bm img { width: 24px; }

.bm-sky { position: absolute; left: 0; right: 0; top: 0; height: 900px; z-index: 0; pointer-events: none;
  background: radial-gradient(60% 55% at 75% 22%, rgba(224,0,0,.20) 0%, rgba(224,0,0,.05) 45%, transparent 70%),
              radial-gradient(40% 40% at 10% 0%, rgba(90,90,140,.14) 0%, transparent 70%); }

.fs-orb.bm { height: 470px; }
.bm-glow { position: absolute; width: 380px; height: 380px; border-radius: 50%;
  background: radial-gradient(circle, rgba(224,0,0,.35) 0%, rgba(224,0,0,.08) 45%, transparent 70%); filter: blur(6px); }
.bm-poster { position: relative; width: 290px; height: 430px; border-radius: 26px; overflow: hidden;
  background: #07070D url(/assets/intro-poster.jpg) center / cover no-repeat;
  border: 1px solid rgba(255,255,255,.12); box-shadow: 0 30px 80px rgba(0,0,0,.7), 0 0 0 6px rgba(224,0,0,.06);
  display: flex; justify-content: center; }
.bm-poster::after { content: ""; position: absolute; inset: 0;
  background: linear-gradient(to bottom, rgba(5,5,10,0) 45%, rgba(5,5,10,.75) 100%); }
.fs-orb.bm .fs-pill.p1 { left: 0; top: 16%; }
.fs-orb.bm .fs-pill.p2 { right: 0; bottom: 18%; }

.fs-h1 { letter-spacing: -.015em; }
.fs-eyebrow::before { background: #E00000; }
.fs-btn.white:hover, .fs-cbtn:not(.dark):hover:not(:disabled), .fs-try:hover:not(:disabled) { filter: brightness(1.15); opacity: 1; }
@media (max-width: 860px) {
  .fs-orb.bm { height: 420px; }
  .bm-poster { width: 230px; height: 340px; }
  .bm-glow { width: 300px; height: 300px; }
}
`;
