import React from "react";
import { ICONS } from "./lyamIcons";

/**
 * Дизайн-система ЛЯМ200 (макет «ЛЛЯМ200 VPN» в Figma): токены и базовые блоки.
 * Ширина макета — 390 (project.json → stage_width), поля экрана — 20.
 */
export const O = {
  font: "'Manrope', system-ui, sans-serif",
  display: "'Manrope', system-ui, sans-serif",
  bg: "#141C2E",
  page: "#0C1220",
  sheet: "#1C2942",
  text: "#EEF3FB",
  cream: "#EEF3FB",
  onCream: "#141C2E",
  muted: "#8EA0C0",
  dim: "#8EA0C0",
  red: "#2F6FED", // акцент макета (синий); ключ оставлен для общих экранов
  onRed: "#FFFFFF",
  green: "#22C55E",
  card: "#1C2942",
  border: "#2A3B5C",
  ring: "none",
  // поле ввода и выключенная кнопка: на экране — цвет карточки, в листе — фон (OSheet задаёт --lyam-field)
  off: "var(--lyam-field, #1C2942)",
  field: "var(--lyam-field, #1C2942)",
  danger: "#F05252",
  bgImage: "",
  welcomeImage: "",
} as const;

/** фон ЛЯМ200 — ровный тёмно-синий */
export const BACKDROP = O.bg;

/** иконки макета — эмодзи (меню, плитки, листы) */
export const EMOJI: Record<string, string> = {
  history: "🕘", shield: "🛡️", headphones: "🎧", "file-text": "📄", lock: "🔒", megaphone: "📢", send: "📢",
  users: "👥", gift: "🎁", settings: "⚙️", "shopping-bag": "🛍️", ticket: "🎫", "message-circle": "🎧", "log-out": "🚪",
  mail: "✉️", "credit-card": "💳", wallet: "💰", crown: "👑", star: "⭐",
};

// шрифт макета: Manrope (вес 200–800) — свои файлы, без Google Fonts
const FONT_CSS = `
@font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;src:url(/assets/manrope-cyrillic-wght-normal.woff2) format('woff2');unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;src:url(/assets/manrope-latin-wght-normal.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
:root{--font:'Manrope',system-ui,sans-serif}
html,body,#root{background:#141C2E}
.lyam-input::placeholder{color:rgba(238,243,251,0.5);opacity:1}
`;
if (typeof document !== "undefined" && !document.getElementById("lyam-fonts")) {
  const st = document.createElement("style");
  st.id = "lyam-fonts";
  st.textContent = FONT_CSS;
  document.head.appendChild(st);
}

const press: React.CSSProperties = {
  boxSizing: "border-box",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
  outline: "none",
  appearance: "none",
  WebkitAppearance: "none",
  fontFamily: O.font,
  margin: 0,
};

// Material Symbols (общие экраны) → Lucide (макет ЛЯМ200)
const MS_TO_LUCIDE: Record<string, string> = {
  download: "download", shopping_bag: "shopping-bag", group: "share-2", share: "share-2", smartphone: "smartphone",
  desktop_windows: "monitor", key: "key-round", vpn_key: "key-round", chat_bubble: "message-circle", content_copy: "copy",
  check: "check", close: "x", bolt: "zap", add: "plus", remove: "minus", chevron_right: "chevron-right",
  qr_code: "qr-code", qr_code_2: "qr-code", redeem: "gift", card_giftcard: "gift", send: "send", mail: "mail",
  shield: "shield", history: "history", description: "file-text", support_agent: "headphones", logout: "log-out",
  delete: "trash-2", refresh: "refresh-cw", sync: "refresh-cw", people: "users", account_balance_wallet: "wallet",
  link: "link", info: "info", schedule: "clock", lock: "lock", language: "globe", star: "star", credit_card: "credit-card",
  error: "info", warning: "info", check_circle: "circle-check", payments: "wallet", workspace_premium: "crown",
};
export function msToLucide(name: string): string {
  return ICONS[name] ? name : MS_TO_LUCIDE[name] || name;
}

/** иконка Lucide из макета (stroke 2, currentColor) */
export function OIcon({ name, size = 20, color = "currentColor", stroke = 2, style }: {
  name: string; size?: number; color?: string; stroke?: number; style?: React.CSSProperties;
}) {
  const inner = ICONS[name];
  if (!inner) return <span style={{ width: size, height: size, display: "inline-block", flex: "none", ...style }} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: "block", flex: "none", ...style }}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

/** экран ЛЯМ200: ровный фон, поля 20, шапка 56 (кнопка «Назад» 44 с отступом 6) */
export function OScreen({ children, center, padTop = 6, style }: {
  children: React.ReactNode; image?: string; center?: boolean; padTop?: number; style?: React.CSSProperties;
}) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: O.bg, fontFamily: O.font, color: O.text, WebkitFontSmoothing: "antialiased" }}>
      <div
        className="blin-scroll blin-tg-safe"
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          padding: `${padTop}px 20px`,
          // отступ под кнопки Telegram в полноэкранном режиме (стиль элемента перебивает .blin-tg-safe)
          paddingTop: `calc(${padTop}px + var(--blin-tg-pad-top, 0px) / var(--blin-scale))`,
          paddingBottom: "calc(24px + var(--blin-tg-pad-bottom, 0px) / var(--blin-scale))",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          ...(center ? { alignItems: "center", justifyContent: "center" } : null),
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** «Назад»: кнопка 44, стрелка 20 + Regular 14 */
export function OBack({ onClick, label = "Назад" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="blin-press"
      style={{ ...press, alignSelf: "flex-start", marginLeft: -12, flex: "none", border: "none", background: "transparent", padding: "0 8px", height: 44, display: "flex", alignItems: "center", gap: 4, color: O.text, fontSize: 14, fontWeight: 400, lineHeight: "20px", cursor: "pointer" }}
    >
      <OIcon name="chevron-left" size={20} stroke={1.67} />
      {label}
    </button>
  );
}

/** заголовок экрана: 24/32 SemiBold (+ подзаголовок 14/20 muted) */
export function OTitle({ children, sub, size = 24, style }: { children: React.ReactNode; sub?: React.ReactNode; size?: number; style?: React.CSSProperties }) {
  return (
    <div style={{ paddingTop: 6, ...style }}>
      <div style={{ fontSize: size, fontWeight: 600, lineHeight: "32px", color: O.text }}>{children}</div>
      {sub ? <div style={{ paddingTop: 8, fontSize: 14, lineHeight: "20px", color: O.muted }}>{sub}</div> : null}
    </div>
  );
}

/** подпись секции: Regular 14 muted */
export function OLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ paddingTop: 20, fontSize: 14, fontWeight: 400, lineHeight: "20px", color: O.muted, ...style }}>
      {children}
    </div>
  );
}

/** карточка: #1C2942, r16, p16 */
export function OCard({ children, style, onClick, radius = 16 }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void; radius?: number }) {
  return (
    <div
      onClick={onClick}
      className={onClick ? "blin-press" : undefined}
      style={{ background: O.card, borderRadius: radius, padding: 16, boxSizing: "border-box", cursor: onClick ? "pointer" : undefined, ...style }}
    >
      {children}
    </div>
  );
}

export type OTone = "red" | "green" | "cream" | "dark";

/** кнопка 56 / r16 / Bold 16 */
export function OButton({ children, onClick, tone = "red", disabled, icon, style, type = "button" }: {
  children: React.ReactNode; onClick?: () => void; tone?: OTone; disabled?: boolean; icon?: string; style?: React.CSSProperties;
  type?: "button" | "submit";
}) {
  const bg = disabled ? O.off : tone === "red" ? O.red : tone === "green" ? O.green : tone === "cream" ? O.cream : O.card;
  const fg = disabled ? O.muted : tone === "red" ? O.onRed : tone === "green" ? "#FFFFFF" : tone === "cream" ? O.onCream : O.text;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="blin-press"
      style={{
        ...press,
        width: "100%",
        height: 48,
        flex: "none",
        padding: "0 16px",
        borderRadius: 16,
        border: "none",
        background: bg,
        color: fg,
        fontSize: 14,
        fontWeight: tone === "dark" && !disabled ? 500 : 600,
        lineHeight: "20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        cursor: disabled ? "default" : "pointer",
        transition: "background 0.2s ease, color 0.2s ease",
        ...style,
      }}
    >
      {icon ? <OIcon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

/** строка меню: эмодзи 16, Medium 14 (+ подпись 14 muted); #1C2942, r16, p16 */
export function OMenuRow({ icon, title, subtitle, onClick, disabled, right, chevron }: {
  icon?: string; title: React.ReactNode; subtitle?: React.ReactNode; onClick?: () => void; disabled?: boolean;
  right?: React.ReactNode; chevron?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="blin-press"
      style={{
        ...press, width: "100%", minHeight: 56, padding: 16, display: "flex", alignItems: "center", gap: 12,
        background: O.card, border: "none", borderRadius: 16, color: disabled ? O.muted : O.text,
        cursor: disabled ? "default" : "pointer", textAlign: "left",
      }}
    >
      {icon ? <span style={{ width: 16, flex: "none", fontSize: 16, lineHeight: "24px", textAlign: "center" }}>{EMOJI[icon] || "•"}</span> : null}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: subtitle ? 2 : 0 }}>
        <span style={{ fontSize: 14, fontWeight: 500, lineHeight: "20px" }}>{title}</span>
        {subtitle ? <span style={{ fontSize: 14, fontWeight: 400, lineHeight: "20px", color: O.muted }}>{subtitle}</span> : null}
      </span>
      {right}
      {chevron ? <span style={{ fontSize: 16, lineHeight: "24px", color: O.muted }}>›</span> : null}
    </button>
  );
}

/** строка «название — значение» внутри карточки */
export function OKeyValue({ k, v, strong }: { k: React.ReactNode; v: React.ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: strong ? 20 : 14, fontWeight: strong ? 800 : 400, lineHeight: strong ? "28px" : "20px", color: strong ? O.text : O.muted }}>{k}</span>
      <span style={{ fontSize: strong ? 24 : 14, fontWeight: strong ? 800 : 600, lineHeight: strong ? "32px" : "20px", color: O.text, whiteSpace: "nowrap" }}>{v}</span>
    </div>
  );
}

/** лист ЛЯМ200: карточка #141414 с полями 12, заголовок 24/ExtraBold, круглый крестик 36 */
export function OSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 16,
        paddingBottom: "calc(16px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
        boxSizing: "border-box",
        animation: "blinvpnFadeIn 0.2s ease both",
        fontFamily: O.font,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 358,
          maxHeight: "100%",
          overflowY: "auto",
          background: O.sheet,
          borderRadius: 16,
          padding: 16,
          ["--lyam-field" as string]: "#141C2E",
          boxSizing: "border-box",
          animation: "blinvpnSheetUp 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
          color: O.text,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, minHeight: 36 }}>
          <div style={{ fontWeight: 600, fontSize: 18, lineHeight: "28px" }}>{title}</div>
          <OClose onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function OClose({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Закрыть"
      onClick={onClick}
      className="blin-press"
      style={{ ...press, border: "none", width: 36, height: 36, flex: "none", borderRadius: "50%", background: O.bg, color: O.text, fontSize: 14, lineHeight: "20px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
    >
      ×
    </button>
  );
}

/** текст листа: 14/20 muted, отступ сверху 12 */
export function OSheetText({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ paddingTop: 12, fontSize: 14, lineHeight: "20px", color: O.muted, ...style }}>{children}</div>;
}

/** строка в листе: 70, эмодзи 16, Medium 14, «›»; #141C2E + обводка #2A3B5C, r16 */
export function OSheetRow({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="blin-press"
      style={{ ...press, width: "100%", height: 70, padding: "0 16px", display: "flex", alignItems: "center", gap: 12, background: O.bg, border: `1px solid ${O.border}`, borderRadius: 16, color: O.text, cursor: "pointer", textAlign: "left" }}
    >
      <span style={{ width: 36, height: 36, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, lineHeight: "24px" }}>{EMOJI[icon] || icon}</span>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 500, lineHeight: "20px" }}>{title}</span>
      <span style={{ fontSize: 16, lineHeight: "24px", color: O.muted }}>›</span>
    </button>
  );
}

export function OSpinner({ size = 36 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", border: `3px solid ${O.border}`, borderTopColor: O.red, animation: "blinvpnSpin 0.8s linear infinite" }} />
  );
}

/** отступ сверху между блоками (в макете — 12) */
export function OGap({ h = 12 }: { h?: number }) {
  return <div style={{ height: h, flex: "none" }} />;
}
