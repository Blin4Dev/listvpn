// ЛЯМ200 VPN: тема сайта — тёмно-синий. Синий акцент и синие кнопки (как в мини-приложении), шрифт Manrope,
// справа на главной — щит-логотип в карточке с синим свечением, на фоне — мягкие синие пятна.
import React from "react";
import { ArtPill, BASE_C, BASE_T, BASE_VARS } from "./themeBase";

export * from "./themeBase";

const FONT = "'Manrope', system-ui, sans-serif";

export const C = {
  ...BASE_C,
  font: FONT,
  display: FONT,
  text: "#EEF3FB",
  green: "#4C8BFF",      // акцент для текста (синий макета чуть светлее)
  greenDeep: "#2F6FED",
  ok: "#22C55E",
  cardBg: "#1C2942",
  iconBg: "#24345A",
  danger: "#F05252",
};

export const VARS: Record<string, string> = {
  ...BASE_VARS,
  "--fs-page": "#0C1220",
  "--fs-deepest": "#0A1020",
  "--fs-deep": "#111A2D",
  "--fs-card-lo": "#16213A",
  "--fs-card": "#18243C",
  "--fs-raise": "#24345A",
  "--fs-raise2": "#20304F",
  "--fs-line": "#2A3B5C",
  "--fs-mut-rgb": "158, 176, 206",
  "--fs-mut2": "#8EA0C0",
  "--fs-mut3": "#6C7FA3",
  "--fs-light": "#EEF3FB",
  "--fs-on-light": "#141C2E",
  "--fs-text2": "#DCE5F3",
  "--fs-acc-rgb": "47, 111, 237",
  "--fs-acc-hi": "#6FA0FF",
  "--fs-acc-soft": "rgba(47, 111, 237, .18)",
  "--fs-acc-tint": "#13213F",
  "--fs-ok-rgb": "34, 197, 94",
  "--fs-ok-bg": "#0F2A24",
  "--fs-ok-bg2": "#123A2C",
  "--fs-ok-line": "#1D5A3E",
  "--fs-ok-text": "#A6E8BC",
  "--fs-price-bg": "linear-gradient(135deg, #182A52 0%, #121D36 55%, #0E1628 100%)",
  "--fs-primary": "#2F6FED",
  "--fs-on-primary": "#FFFFFF",
  "--fs-primary-soft": "#2F6FED",
  "--fs-primary-login": "#2F6FED",
};

export const T = {
  ...BASE_T,
  name: "ЛЯМ200 VPN",
  homeTitle: "ЛЯМ200 VPN — быстрый и надёжный VPN",
  heroEyebrow: "ЛЯМ200 · VPN-сервис",
  heroTitle: "Надёжный VPN на каждый день",
  heroLead: "Подключение в один клик, быстрые серверы и защита трафика — на телефоне, компьютере и телевизоре.",
  whyEyebrow: "Почему ЛЯМ200",
  whyTitle: ["Всё, что нужно от VPN,", "и ничего лишнего"],
  planName: "ЛЯМ200 · VPN",
  tariffEyebrow: "ЛЯМ200 · Подписка",
  shareText: "Быстрый и надёжный VPN — ЛЯМ200 VPN",
};

export function Logo({ onClick }: { dot?: boolean; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <a href="/" onClick={onClick} className="fs-logo ly" aria-label="ЛЯМ200 VPN">
      <img src="/assets/logo.png" alt="" />
      <span>
        ЛЯМ200<b>VPN</b>
      </span>
    </a>
  );
}

export function HeroArt() {
  return (
    <div className="fs-orb ly">
      <div className="fs-ring" style={{ width: 400, height: 400, borderColor: "rgba(111,160,255,.12)" }} />
      <div className="fs-ring" style={{ width: 490, height: 490, borderColor: "rgba(111,160,255,.06)" }} />
      <div className="ly-glow" />
      <div className="ly-card">
        <img src="/assets/logo.png" alt="" />
      </div>
      <ArtPill pos="p1" icon="shield" color="#4C8BFF">Защищённое подключение</ArtPill>
      <ArtPill pos="p2" icon="devices" color="#22C55E">Все устройства в одной подписке</ArtPill>
    </div>
  );
}

/** мягкие синие пятна сверху */
export function Backdrop() {
  return <div className="ly-sky" aria-hidden />;
}

export const THEME_CSS = `
@font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;src:url(/assets/manrope-cyrillic-wght-normal.woff2) format('woff2');unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;src:url(/assets/manrope-latin-wght-normal.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}

.fs-logo.ly { gap: 10px; font-size: 15px; font-weight: 800; letter-spacing: .06em; }
.fs-logo.ly img { width: 30px; height: 30px; border-radius: 8px; object-fit: cover; }
.fs-logo.ly b { margin-left: 6px; color: #4C8BFF; font-weight: 800; }
.fs-foot .fs-logo.ly img { width: 24px; height: 24px; }

.ly-sky { position: absolute; left: 0; right: 0; top: 0; height: 1000px; z-index: 0; pointer-events: none;
  background: radial-gradient(50% 45% at 78% 28%, rgba(47,111,237,.22) 0%, rgba(47,111,237,.05) 50%, transparent 72%),
              radial-gradient(35% 35% at 8% 4%, rgba(47,111,237,.14) 0%, transparent 70%),
              linear-gradient(to bottom, #141C2E 0%, #0C1220 100%); }

.fs-h1, .fs-h2 { letter-spacing: -.02em; font-weight: 800; }
.fs-eyebrow::before { background: #2F6FED; }

.fs-orb.ly { height: 460px; }
.ly-glow { position: absolute; width: 380px; height: 380px; border-radius: 50%;
  background: radial-gradient(circle, rgba(47,111,237,.4) 0%, rgba(47,111,237,.1) 45%, transparent 70%); filter: blur(6px); }
.ly-card { position: relative; width: 270px; height: 270px; border-radius: 36px; overflow: hidden;
  border: 1px solid #2A3B5C; box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 0 0 8px rgba(47,111,237,.07); background: #10141F; }
.ly-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
.fs-orb.ly .fs-pill.p1 { left: 0; top: 14%; }
.fs-orb.ly .fs-pill.p2 { right: -2%; bottom: 16%; }
.fs-pill { background: rgba(24,36,60,.94); border-color: #2A3B5C; color: #EEF3FB; }

.fs-card { border-color: #24334F; }
.fs-btn.white:hover, .fs-cbtn:not(.dark):hover:not(:disabled), .fs-try:hover:not(:disabled) { filter: brightness(1.12); opacity: 1; }
@media (max-width: 860px) {
  .fs-orb.ly { height: 400px; }
  .ly-card { width: 210px; height: 210px; border-radius: 28px; }
  .ly-glow { width: 300px; height: 300px; }
}
`;
