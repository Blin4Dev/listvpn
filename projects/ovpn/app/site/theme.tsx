// O-VPN: тема сайта — ринг. Тёплый тёмный фон, красный акцент и кремовый текст (как в мини-приложении),
// логотип шрифтом Anton, заголовки капсом; за первым экраном — арена (пустой ринг), справа — логотип O-VPN в рамке.
// Ринг с бойцом — только на запуске мини-приложения, на сайте его нет.
import React from "react";
import { ArtPill, BASE_C, BASE_T, BASE_VARS } from "./themeBase";

export * from "./themeBase";

const FONT = "'Manrope', system-ui, sans-serif";

export const C = {
  ...BASE_C,
  font: FONT,
  display: FONT,          // в Anton нет кириллицы — заголовки Manrope 800 капсом, Anton — только логотип
  text: "#F6EFE6",
  green: "#F23A40",      // акцент для текста
  greenDeep: "#E31B23",
  ok: "#2FBE4A",
  cardBg: "#1C1513",
  iconBg: "#2A211E",
  danger: "#FF6B5E",
};

export const VARS: Record<string, string> = {
  ...BASE_VARS,
  "--fs-page": "#100C0B",
  "--fs-deepest": "#0B0807",
  "--fs-deep": "#130F0E",
  "--fs-card-lo": "#171211",
  "--fs-card": "#1C1513",
  "--fs-raise": "#2A211E",
  "--fs-raise2": "#241C19",
  "--fs-line": "#433632",
  "--fs-mut-rgb": "190, 176, 163",
  "--fs-mut2": "#A89A8E",
  "--fs-mut3": "#7D6F65",
  "--fs-light": "#F6EFE6",
  "--fs-on-light": "#1A120E",
  "--fs-text2": "#EDE3D6",
  "--fs-acc-rgb": "227, 27, 35",
  "--fs-acc-hi": "#FF5A5F",
  "--fs-acc-soft": "rgba(227, 27, 35, .16)",
  "--fs-acc-tint": "#1E0F0E",
  "--fs-ok-rgb": "47, 190, 74",
  "--fs-ok-bg": "#13231A",
  "--fs-ok-bg2": "#183320",
  "--fs-ok-line": "#245433",
  "--fs-ok-text": "#AEE6BA",
  "--fs-price-bg": "linear-gradient(135deg, #2A1210 0%, #1A1110 55%, #120D0C 100%)",
  "--fs-primary": "#E31B23",
  "--fs-on-primary": "#FFF7F4",
  "--fs-primary-soft": "#E31B23",
  "--fs-primary-login": "#E31B23",
};

export const T = {
  ...BASE_T,
  name: "O-VPN",
  homeTitle: "O-VPN — сильный VPN для свободного интернета",
  heroEyebrow: "O-VPN · VPN-сервис",
  heroTitle: "Сильный VPN для свободного интернета",
  heroLead: "Выходите в сеть без ограничений: подключение в один клик, быстрые серверы и все устройства в одной подписке.",
  whyEyebrow: "Почему O-VPN",
  whyTitle: ["В углу ринга —", "только ваша скорость"],
  planName: "O-VPN · VPN",
  tariffEyebrow: "O-VPN · Подписка",
  shareText: "Сильный и быстрый VPN — O-VPN",
};

export function Logo({ onClick }: { dot?: boolean; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <a href="/" onClick={onClick} className="fs-logo ov" aria-label="O-VPN">
      <span>
        <b>O</b>-VPN
      </span>
    </a>
  );
}

export function HeroArt() {
  return (
    <div className="fs-orb ov">
      <div className="ov-glow" />
      <div className="ov-frame">
        <div className="ov-badge">
          <span className="ov-word">
            <b>O</b>-VPN
          </span>
          <span className="ov-sub">VPN-сервис</span>
        </div>
      </div>
      <ArtPill pos="p1" icon="bolt" color="#F23A40">Подключение в один клик</ArtPill>
      <ArtPill pos="p2" icon="shield" color="#2FBE4A">Трафик под защитой</ArtPill>
    </div>
  );
}

/** арена за первым экраном, растворяется в фоне */
export function Backdrop() {
  return <div className="ov-arena" aria-hidden />;
}

export const THEME_CSS = `
@font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;src:url(/assets/manrope-cyrillic-wght-normal.woff2) format('woff2');unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;src:url(/assets/manrope-latin-wght-normal.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:'Anton';font-style:normal;font-weight:400;font-display:swap;src:url(/assets/anton-latin-400-normal.woff2) format('woff2')}

.fs-logo.ov { font-family: 'Anton', 'Manrope', sans-serif; font-weight: 400; font-size: 24px; letter-spacing: .04em; color: #F3E6D4; }
.fs-logo.ov b { font-weight: 400; color: #E31B23; }
.fs-foot .fs-logo.ov { font-size: 20px; }

.ov-arena { position: absolute; left: 0; right: 0; top: 0; height: 860px; z-index: 0; pointer-events: none;
  background: linear-gradient(to bottom, rgba(16,12,11,.78) 0%, rgba(16,12,11,.7) 45%, rgba(16,12,11,.95) 85%, #100C0B 100%),
              #100C0B url(/assets/home-bg-poster.jpg) center 30% / cover no-repeat; }

/* заголовки капсом, как в мини-приложении */
.fs-h1, .fs-h2 { text-transform: uppercase; font-weight: 800; letter-spacing: .005em; color: #F6EFE6; }
.fs-h1 { font-size: 46px; line-height: 1.06; }
.fs-lead { color: rgba(237,227,214,.8); }
.fs-eyebrow { color: rgba(243,230,212,.75); }
.fs-eyebrow::before { background: #E31B23; }

.fs-orb.ov { height: 470px; }
.ov-glow { position: absolute; width: 400px; height: 400px; border-radius: 50%;
  background: radial-gradient(circle, rgba(227,27,35,.34) 0%, rgba(227,27,35,.08) 45%, transparent 70%); filter: blur(6px); }
.ov-frame { position: relative; width: 330px; height: 330px; padding: 6px; border-radius: 30px;
  background: linear-gradient(145deg, #E31B23 0%, #7A1015 50%, #F3E6D4 100%); box-shadow: 0 30px 80px rgba(0,0,0,.65); transform: rotate(-3deg); }
.ov-badge { width: 100%; height: 100%; border-radius: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: radial-gradient(circle at 50% 38%, rgba(227,27,35,.22) 0%, rgba(28,21,19,.96) 62%), #1C1513; }
.ov-word { font-family: 'Anton', 'Manrope', sans-serif; font-size: 78px; line-height: 1; letter-spacing: .03em; color: #F3E6D4;
  filter: drop-shadow(0 6px 24px rgba(0,0,0,.6)); }
.ov-word b { font-weight: 400; color: #E31B23; }
.ov-sub { font-size: 13px; font-weight: 700; letter-spacing: .32em; text-transform: uppercase; color: rgba(243,230,212,.6); }
.fs-orb.ov .fs-pill.p1 { left: 0; top: 12%; }
.fs-orb.ov .fs-pill.p2 { right: 0; bottom: 14%; }
.fs-pill { background: rgba(28,21,19,.94); border-color: #433632; color: #F6EFE6; }

.fs-card { border-color: #2E2421; }
.fs-btn.white:hover, .fs-cbtn:not(.dark):hover:not(:disabled), .fs-try:hover:not(:disabled) { filter: brightness(1.12); opacity: 1; }
@media (max-width: 860px) {
  .fs-h1 { font-size: 34px; }
  .fs-orb.ov { height: 400px; }
  .ov-frame { width: 260px; height: 260px; }
  .ov-word { font-size: 60px; }
  .ov-glow { width: 320px; height: 320px; }
  .ov-arena { height: 1000px; }
}
`;
