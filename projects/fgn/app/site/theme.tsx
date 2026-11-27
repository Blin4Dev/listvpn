// FGN: тема сайта — палитра FGN (зелёный акцент), логотип с точкой, сфера со щитом, частицы и листья на фоне.
import React from "react";
import { Leaf, SHIELD_PATH } from "../components/fgn";
import { BASE_T } from "./themeBase";

export * from "./themeBase";

export const T = {
  ...BASE_T,
  name: "FGN",
  email: "support@fgn.app",
  defaultBot: "fgnconnect_bot",
  homeTitle: "FGN — быстрый и надёжный VPN",
  heroEyebrow: "FGN · VPN-сервис",
  heroNote: "VPN и обход белых списков входят в одну подписку.",
  whyEyebrow: "Почему FGN",
  features: [
    { icon: "infinity", title: "Безлимитный трафик", text: "Никаких лимитов и порогов скорости" },
    { icon: "bolt", title: "Высокая скорость", text: "Современные протоколы и каналы до 10 Гбит/с" },
    { icon: "globe", title: "Серверы по всему миру", text: "Пинг и избранное — прямо в приложении" },
  ] as typeof BASE_T.features,
  steps: [
    { title: "Скачайте и установите", text: "Установщик для Windows и macOS. Вся настройка занимает меньше минуты." },
    { title: "Войдите в аккаунт", text: "Один аккаунт — для сайта и приложения. Подписка подхватывается автоматически." },
    { title: "Выберите сервер", text: "Отсортируйте страны по пингу, добавьте любимые в избранное и подключитесь в один клик." },
  ],
  planName: "FGN · VPN + обход",
  tariffEyebrow: "FGN · Подписка",
  tariffBundle: "VPN и обход белых списков входят в одну подписку.",
  giftIncludes: "VPN и обход белых списков.",
  shareText: "Быстрый VPN с обходом белых списков — FGN",
  periodLabel: "VPN + белые списки",
  orderSuffix: " · белые списки",
  giftSuffix: " + белые списки",
  giftMonth: "месяц подписки с белыми списками",
  planShort: " (ВПН + обход)",
  migration: true,
};

export function Logo({ dot = true, onClick }: { dot?: boolean; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <a href="/" onClick={onClick} className="fs-logo" aria-label="FGN">
      FGN{dot ? <i /> : null}
    </a>
  );
}

const Bolt = ({ color }: { color: string }) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block", flexShrink: 0 }}>
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);
const Star = ({ color }: { color: string }) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block", flexShrink: 0 }}>
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z" />
  </svg>
);

/** белая сфера со щитом и две плашки */
export function HeroArt() {
  return (
    <div className="fs-orb">
      <div className="fs-ring" style={{ width: 380, height: 380 }} />
      <div className="fs-ring" style={{ width: 470, height: 470, borderColor: "rgba(255,255,255,.035)" }} />
      <div className="fs-sphere">
        <svg width="42%" height="42%" viewBox="0 0 100 100" aria-hidden>
          <path d={SHIELD_PATH} fill="none" stroke="#1A1B18" strokeWidth={6.5} strokeLinejoin="round" />
        </svg>
      </div>
      <div className="fs-pill p1">
        <Bolt color="#34D67C" />
        ~12 мс до ближайшего сервера
      </div>
      <div className="fs-pill p2">
        <Star color="#F2C14E" />
        Серверы в 5+ странах
      </div>
    </div>
  );
}

// ── частицы фона: x — % ширины, y — px от верха страницы ──
type Dot = { k: "w" | "g" | "leaf"; x: number; y: number; r?: number; d: number };
const DOTS: Dot[] = [
  { k: "leaf", x: 34, y: 158, r: 20, d: 0.4 },
  { k: "w", x: 51.5, y: 240, d: 1.1 },
  { k: "w", x: 1.5, y: 377, d: 2.2 },
  { k: "g", x: 17, y: 350, d: 0.7 },
  { k: "w", x: 23, y: 377, d: 1.6 },
  { k: "w", x: 37, y: 353, d: 0.2 },
  { k: "leaf", x: 48, y: 400, r: -30, d: 2.6 },
  { k: "leaf", x: 56, y: 394, r: 15, d: 1.3 },
  { k: "w", x: 12, y: 470, d: 2.9 },
  { k: "g", x: 5, y: 487, d: 1.9 },
  { k: "w", x: 40, y: 469, d: 0.9 },
  { k: "w", x: 52, y: 496, d: 2.4 },
  { k: "w", x: 84, y: 468, d: 0.5 },
  { k: "leaf", x: 51, y: 559, r: -25, d: 1.7 },
  { k: "leaf", x: 87, y: 549, r: 35, d: 3.1 },
  { k: "w", x: 28, y: 640, d: 1.4 },
  { k: "g", x: 70, y: 700, d: 2.1 },
  { k: "w", x: 93, y: 820, d: 0.8 },
  { k: "leaf", x: 6, y: 980, r: 40, d: 2.7 },
  { k: "w", x: 62, y: 1180, d: 1.2 },
  { k: "g", x: 97, y: 1350, d: 0.3 },
  { k: "w", x: 3, y: 1560, d: 2.3 },
  { k: "leaf", x: 95, y: 1720, r: -15, d: 1.5 },
];

export function Backdrop() {
  return (
    <>
      {DOTS.map((d, i) => (
        <div
          key={i}
          className={`fs-dot ${d.k}`}
          style={{ left: `${d.x}%`, top: d.y, animationDelay: `${-d.d}s`, animationDuration: `${6 + (i % 4)}s` }}
        >
          {d.k === "leaf" ? (
            <div style={{ transform: `rotate(${d.r || 0}deg)` }}>
              <Leaf size={14} />
            </div>
          ) : (
            <i style={{ animationDelay: `${-d.d * 1.3}s` }} />
          )}
        </div>
      ))}
    </>
  );
}

export const THEME_CSS = "";
