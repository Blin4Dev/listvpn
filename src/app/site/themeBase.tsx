// Тема сайта проекта (features.site): всё, чем сайты проектов отличаются друг от друга, — здесь.
// Сайт один (src/app/site/*), а проект кладёт свою тему в projects/<id>/app/site/theme.tsx:
//
//   export * from "./themeBase";            // всё по умолчанию…
//   export const C = { ...BASE_C, green: "#E00000" };   // …и переопределить нужное
//
// Что задаёт тема:
//   C          — цвета и шрифты для кода (акцент, кнопки, шрифт); ключ green — это акцент проекта (исторически у FGN зелёный)
//   VARS       — CSS-переменные поверхностей и оттенков (карточки, поля, линии, приглушённый текст, оттенки акцента)
//   T          — тексты: бренд, почта, главная, преимущества, шаги, подписи тарифов
//   Logo       — логотип в шапке и подвале
//   HeroArt    — картинка справа на главной
//   Backdrop   — украшения фона всей страницы (частицы, фото…), можно null
//   THEME_CSS  — свои шрифты (@font-face) и точечные правки стилей сайта
import React from "react";
import { BRAND_NAME } from "../utils/brand";

// ── цвета для кода ──
export const BASE_C = {
  font: "'Onest', 'Outfit', system-ui, sans-serif",
  /** шрифт крупных заголовков (h1/h2); по умолчанию — основной */
  display: "'Onest', 'Outfit', system-ui, sans-serif",
  text: "#FFFFFF",
  /** акцент проекта (ссылки, иконки, «активно», проценты) */
  green: "#34D67C",
  /** «успех»: активная подписка, выплачено, скидка, экономия (у FGN совпадает с акцентом) */
  ok: "#34D67C",
  /** тёмный вариант акцента (полоски-маркеры) */
  greenDeep: "#1E9E57",
  btn: "#FFFFFF",
  btnSoft: "#F2F2F3",
  btnText: "#0A0A0A",
  iconBg: "#1C1C1F",
  cardBg: "#141416",
  warn: "#FFB23F",
  danger: "#FF4B4B",
};
export const C = BASE_C;

// ── CSS-переменные (значения по умолчанию — палитра FGN) ──
export const BASE_VARS: Record<string, string> = {
  "--fs-page": "#000",              // фон страницы
  "--fs-deepest": "#070708",        // самые тёмные поля (выбор в окнах)
  "--fs-deep": "#0E0F10",           // тёмные кнопки, поля
  "--fs-card-lo": "#121214",        // карточки поглубже, поля ввода
  "--fs-card": "#18191B",           // карточки
  "--fs-raise": "#222326",          // приподнятые элементы
  "--fs-raise2": "#1E1E22",
  "--fs-line": "#2A2A30",           // рамки
  "--fs-mut-rgb": "196, 196, 206",  // приглушённый текст: rgba(var(--fs-mut-rgb), .7)
  "--fs-mut2": "#9B9BA4",
  "--fs-mut3": "#6E6E78",
  "--fs-light": "#F4F4F5",          // светлый текст в окнах
  "--fs-on-light": "#0A0A0A",       // текст на светлых кнопках
  "--fs-text2": "#E6E6E8",
  "--fs-acc-rgb": "52, 214, 124",   // акцент: rgba(var(--fs-acc-rgb), .3)
  "--fs-acc-hi": "#5BF29A",         // светлый акцент (частицы)
  "--fs-acc-soft": "rgba(37,103,65,.22)",
  "--fs-ok-rgb": "52, 214, 124",    // «успех» (активна, выплачено): плашки и подсказки
  "--fs-ok-bg": "#13241C",
  "--fs-ok-bg2": "#1C3A2A",
  "--fs-ok-line": "#24543A",
  "--fs-ok-text": "#B7E7C8",
  "--fs-acc-tint": "#121615",       // фон с лёгким оттенком акцента (баннер, плашки)
  "--fs-price-bg": "linear-gradient(135deg, #131617 0%, #101314 55%, #0E1311 100%)",
  "--fs-cta-bg": "#7A7A78",
  "--fs-primary": "#fff",           // главные кнопки («Оформить», «Войти», «Оплатить»…)
  "--fs-on-primary": "#0A0A0A",
  "--fs-primary-soft": "#F2F2F3",   // главная кнопка в окнах установки
  "--fs-primary-login": "#FDFDF8",  // главная кнопка на входе
};
export const VARS = BASE_VARS;

/** :root { --fs-…: … } — переменные темы (на :root, чтобы их видели и окна, вынесенные в body) */
export function rootVars(vars: Record<string, string>): string {
  return `:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;
}

// ── тексты ──
export type FeatureIcon = "infinity" | "bolt" | "globe" | "shield" | "devices" | "lock" | "star" | "headset";
export type SiteFeature = { icon: FeatureIcon; title: string; text: string };

export const BASE_T = {
  /** бренд в текстах сайта */
  name: BRAND_NAME,
  /** почта поддержки (подвал, правила, «нет ответа»); "" — не показываем */
  email: "",
  /** бот, пока не пришёл конфиг (/api/app/config → botUsername); "" — кнопка бота появится после загрузки */
  defaultBot: "",
  /** заголовок вкладки на главной */
  homeTitle: `${BRAND_NAME} — быстрый и надёжный VPN`,
  heroEyebrow: `${BRAND_NAME} · VPN-сервис`,
  heroTitle: "Быстрый и надёжный VPN для свободного интернета",
  heroLead: "Подключайтесь за один клик, выбирайте из десятков серверов по всему миру и оставайтесь под защитой всегда.",
  /** строка под кнопками («что входит в подписку») */
  heroNote: "Все устройства — в одной подписке.",
  whyEyebrow: `Почему ${BRAND_NAME}`,
  whyTitle: ["Сделан для тех, кто ценит", "скорость и тишину"] as string[],
  features: [
    { icon: "infinity", title: "Безлимитный трафик", text: "Никаких лимитов и порогов скорости" },
    { icon: "bolt", title: "Высокая скорость", text: "Современные протоколы и быстрые каналы" },
    { icon: "globe", title: "Серверы по всему миру", text: "Выбирайте страну — подключение в один клик" },
  ] as SiteFeature[],
  stepsEyebrow: "Три шага",
  stepsTitle: "Как это работает",
  steps: [
    { title: "Скачайте приложение", text: "Для iPhone, Android, Windows, macOS и TV. Установка занимает меньше минуты." },
    { title: "Войдите в аккаунт", text: "Один аккаунт — для сайта и бота. Подписка подхватывается автоматически." },
    { title: "Подключитесь", text: "Добавьте подписку в приложение в один клик и включайте VPN, когда нужно." },
  ] as { title: string; text: string }[],
  priceTitle: "Выберите свой тариф",
  priceText: "Месяц, три месяца, полгода или год. Чем длиннее период — тем ниже цена за месяц.",
  /** название тарифа в кабинете (активная подписка) */
  planName: `${BRAND_NAME} · VPN`,
  /** надпись над тарифами */
  tariffEyebrow: `${BRAND_NAME} · Подписка`,
  /** что входит в подписку — на странице тарифов (перед «В цену уже включены …») */
  tariffBundle: "Все устройства — в одной подписке.",
  /** подарок другу: «Друг получит подписку на выбранный срок — …» */
  giftIncludes: "VPN на всех его устройствах.",
  /** текст при «Отправить в Telegram» реф. ссылки */
  shareText: `Быстрый и надёжный VPN — ${BRAND_NAME}`,
  /** что входит в подписку — подписи тарифа */
  periodLabel: "VPN",            // «Выберите период · …»
  orderSuffix: "",               // «1 месяц · 3 устройства…» в оплате
  giftSuffix: "",                // «30 дней…» у подарка
  giftMonth: "месяц подписки",   // «…и получит <это>» (подарок за рефералов)
  planShort: "",                 // «Месяц подписки<это>…»
  /** окно «<старый VPN> теперь …» (перенос из проекта, переданного под управление) */
  migration: false,
};
export const T = BASE_T;

// ── логотип: надпись бренда (по умолчанию) ──
export function Logo({ onClick }: { dot?: boolean; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <a href="/" onClick={onClick} className="fs-logo" aria-label={BRAND_NAME}>
      {BRAND_NAME}
    </a>
  );
}

// ── картинка на главной: логотип проекта в светящемся круге ──
export function HeroArt() {
  return (
    <div className="fs-orb">
      <div className="fs-ring" style={{ width: 380, height: 380 }} />
      <div className="fs-ring" style={{ width: 470, height: 470, borderColor: "rgba(255,255,255,.035)" }} />
      <div className="fs-art-glow" />
      <img className="fs-art-logo" src="/assets/logo.png" alt="" />
    </div>
  );
}

const PILL_ICON: Record<string, React.ReactNode> = {
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z" />,
  shield: <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" />
    </>
  ),
  devices: (
    <>
      <rect x="3" y="4" width="13" height="10" rx="1.8" />
      <path d="M7 18h5" />
      <rect x="16.5" y="9" width="5" height="11" rx="1.4" />
    </>
  ),
};

/** плашка поверх картинки на главной (.fs-pill p1 — слева сверху, p2 — справа снизу) */
export function ArtPill({ pos, icon, color, children }: { pos: "p1" | "p2"; icon: keyof typeof PILL_ICON; color: string; children: React.ReactNode }) {
  return (
    <div className={`fs-pill ${pos}`}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block", flexShrink: 0 }}>
        {PILL_ICON[icon]}
      </svg>
      {children}
    </div>
  );
}

/** украшения фона страницы; по умолчанию — нет */
export function Backdrop(): React.ReactElement | null {
  return null;
}

/** точечные правки стилей сайта (после основных) */
export const THEME_CSS = `
.fs-art-glow { position: absolute; width: 320px; height: 320px; border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--fs-acc-rgb), .28) 0%, rgba(var(--fs-acc-rgb), .08) 45%, transparent 70%); }
.fs-art-logo { position: relative; width: 240px; height: 240px; object-fit: contain; filter: drop-shadow(0 20px 50px rgba(0,0,0,.6)); }
@media (max-width: 860px) { .fs-art-logo { width: 190px; height: 190px; } .fs-art-glow { width: 260px; height: 260px; } }
`;
