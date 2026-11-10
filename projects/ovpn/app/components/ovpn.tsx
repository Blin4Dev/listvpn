import React from "react";
import { ICONS } from "./ovpnIcons";

/**
 * Дизайн-система O-VPN (макет «O-VPN перенос» в Figma): токены и базовые блоки.
 * Ширина макета — 390 (project.json → stage_width), поля экрана — 16.
 */
export const O = {
  font: "'Manrope', system-ui, sans-serif",
  display: "'Anton', 'Manrope', sans-serif",
  bg: "#100C0B",
  sheet: "#1C1513",
  text: "#F6EFE6",
  cream: "#F3E6D4",
  onCream: "#1A120E",
  muted: "#B5A89C",
  dim: "#7D6F65",
  red: "#E31B23",
  onRed: "#FFF7F4",
  green: "#2FBE4A",
  card: "rgba(28, 21, 19, 0.85)",
  border: "#433632",
  off: "#2A211E",
  danger: "#FF6B5E",
  bgImage: "/assets/home-bg-poster.jpg",
  welcomeImage: "/assets/welcome-bg.jpg",
} as const;

// шрифты макета: Manrope (вес 200–800) и Anton (логотип) — свои файлы, без Google Fonts
const FONT_CSS = `
@font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;src:url(/assets/manrope-cyrillic-wght-normal.woff2) format('woff2');unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;src:url(/assets/manrope-latin-wght-normal.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:'Anton';font-style:normal;font-weight:400;font-display:swap;src:url(/assets/anton-latin-400-normal.woff2) format('woff2')}
:root{--font:'Manrope',system-ui,sans-serif}
html,body,#root{background:#100C0B}
.ovpn-input::placeholder{color:#7D6F65;opacity:1}
`;
if (typeof document !== "undefined" && !document.getElementById("ovpn-fonts")) {
  const st = document.createElement("style");
  st.id = "ovpn-fonts";
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

// Material Symbols (общие экраны) → Lucide (макет O-VPN)
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

/** экран O-VPN: арена + затемнение 55%, поля 16, прокрутка */
export function OScreen({ children, image = O.bgImage, center, padTop = 16, style }: {
  children: React.ReactNode; image?: string; center?: boolean; padTop?: number; style?: React.CSSProperties;
}) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: O.bg, fontFamily: O.font, color: O.text, WebkitFontSmoothing: "antialiased" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, background: `${O.bg} url(${image}) center top / cover no-repeat`, pointerEvents: "none" }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(16, 12, 11, 0.55)", pointerEvents: "none" }} />
      <div
        className="blin-scroll blin-tg-safe"
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          padding: `${padTop}px 16px`,
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

/** «← Назад» (SemiBold 14, кремовый) — и системная «Назад» Telegram */
export function OBack({ onClick, label = "← Назад" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="blin-press"
      style={{ ...press, alignSelf: "flex-start", border: "none", background: "transparent", padding: 0, height: 20, color: O.cream, fontSize: 14, fontWeight: 600, lineHeight: "20px", cursor: "pointer" }}
    >
      {label}
    </button>
  );
}

/** заголовок экрана: 30/ExtraBold (+ подзаголовок 14 muted) */
export function OTitle({ children, sub, size = 30, style }: { children: React.ReactNode; sub?: React.ReactNode; size?: number; style?: React.CSSProperties }) {
  return (
    <div style={{ paddingTop: 12, ...style }}>
      <div style={{ fontSize: size, fontWeight: 800, lineHeight: `${size}px`, color: O.text }}>{children}</div>
      {sub ? <div style={{ paddingTop: 8, fontSize: 14, lineHeight: "20px", color: O.muted }}>{sub}</div> : null}
    </div>
  );
}

/** подпись секции: Bold 12, tracking 1.2 */
export function OLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ paddingTop: 12, fontSize: 12, fontWeight: 700, lineHeight: "16px", letterSpacing: "1.2px", color: O.muted, ...style }}>
      {children}
    </div>
  );
}

/** карточка: r24, p16, стекло */
export function OCard({ children, style, onClick, radius = 24 }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void; radius?: number }) {
  return (
    <div
      onClick={onClick}
      className={onClick ? "blin-press" : undefined}
      style={{
        background: O.card,
        border: `1px solid ${O.border}`,
        borderRadius: radius,
        padding: 16,
        boxSizing: "border-box",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
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
        height: 56,
        flex: "none",
        padding: "0 16px",
        borderRadius: 16,
        border: tone === "dark" && !disabled ? `1px solid ${O.border}` : "none",
        background: bg,
        color: fg,
        fontSize: 16,
        fontWeight: 700,
        lineHeight: "24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        cursor: disabled ? "default" : "pointer",
        transition: "background 0.2s ease, color 0.2s ease",
        ...style,
      }}
    >
      {icon ? <OIcon name={icon} size={20} /> : null}
      {children}
    </button>
  );
}

/** строка меню: иконка 20 в поле 40, SemiBold 16; r16, 12/16 */
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
        ...press,
        width: "100%",
        minHeight: 64,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: O.card,
        border: `1px solid ${O.border}`,
        borderRadius: 16,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        color: disabled ? O.muted : O.text,
        cursor: disabled ? "default" : "pointer",
        textAlign: "left",
      }}
    >
      {icon ? (
        <span style={{ width: 40, height: 40, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <OIcon name={icon} size={20} />
        </span>
      ) : null}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 16, fontWeight: 600, lineHeight: "24px" }}>{title}</span>
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

/** лист (O-VPN): карточка поверх экрана с полями 12, заголовок 20/ExtraBold, крестик 48 */
export function OSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: "rgba(16, 12, 11, 0.6)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 12,
        paddingBottom: "calc(12px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
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
          maxWidth: 366,
          maxHeight: "100%",
          overflowY: "auto",
          background: O.sheet,
          border: `1px solid ${O.border}`,
          borderRadius: 28,
          padding: 20,
          boxSizing: "border-box",
          animation: "blinvpnSheetUp 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
          color: O.text,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, minHeight: 48 }}>
          <div style={{ fontWeight: 800, fontSize: 20, lineHeight: "25px" }}>{title}</div>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            className="blin-press"
            style={{ ...press, border: "none", width: 48, height: 48, flex: "none", borderRadius: 16, background: "transparent", color: O.muted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginTop: -12, marginRight: -14 }}
          >
            <OIcon name="x" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** текст листа: 14/20 muted, отступ сверху 16 */
export function OSheetText({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted, ...style }}>{children}</div>;
}

/** строка в листе: иконка в поле 36, SemiBold 16, шеврон */
export function OSheetRow({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="blin-press"
      style={{ ...press, width: "100%", height: 62, padding: "0 16px", display: "flex", alignItems: "center", gap: 12, background: O.bg, border: `1px solid ${O.border}`, borderRadius: 16, color: O.text, cursor: "pointer", textAlign: "left" }}
    >
      <span style={{ width: 36, height: 36, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: O.red }}>
        <OIcon name={icon} size={20} />
      </span>
      <span style={{ flex: 1, fontSize: 16, fontWeight: 600, lineHeight: "24px" }}>{title}</span>
      <OIcon name="chevron-right" size={20} color={O.muted} />
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
