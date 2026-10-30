// FGN: общие элементы дизайна — палитра, фон (сетка + светящиеся частицы + листья), иконки.
// Файла нет в src/app: используется только переопределениями FGN.
import React from "react";
import { useTgBack } from "./noir";
import { pageFrame, pageOuter } from "./ui";

// палитра FGN (по макетам)
export const C = {
  font: "'Onest', 'Outfit', system-ui, sans-serif",
  bg: "#050505",
  text: "#FFFFFF",
  muted: "rgba(196, 196, 206, 0.78)",
  hint: "rgba(200, 200, 206, 0.72)",
  grid: "rgba(255, 255, 255, 0.13)",
  green: "#34D67C",
  greenDeep: "#1E9E57",
  btn: "#FFFFFF",
  btnSoft: "#F2F2F3",
  btnText: "#0A0A0A",
  btnOff: "rgba(255, 255, 255, 0.4)",
  cardBg: "#141416",
  cardBorder: "rgba(255, 255, 255, 0.1)",
  iconBg: "#1C1C1F",
  warn: "#FFB23F",
  danger: "#FF4B4B",
};

// ── частицы фона: позиции по макету (в % экрана), d — задержка, t — период ──
type Particle = { k: "white" | "green" | "leaf"; x: number; y: number; d: number; t: number; r?: number };
const PARTICLES: Particle[] = [
  { k: "white", x: 4.6, y: 5.7, d: 0, t: 7 },
  { k: "white", x: 86.2, y: 11.4, d: 1.2, t: 8 },
  { k: "white", x: 12.3, y: 34.1, d: 2.1, t: 6.5 },
  { k: "white", x: 95.4, y: 39.8, d: 0.6, t: 7.5 },
  { k: "white", x: 6.2, y: 73.9, d: 1.8, t: 8.5 },
  { k: "white", x: 49.2, y: 85.3, d: 0.3, t: 7 },
  { k: "green", x: 24.6, y: 17.1, d: 0.9, t: 6 },
  { k: "green", x: 61.5, y: 28.4, d: 2.4, t: 7 },
  { k: "green", x: 73.8, y: 62.6, d: 1.5, t: 6.5 },
  { k: "green", x: 92.3, y: 91.0, d: 0.2, t: 8 },
  { k: "leaf", x: 10.3, y: 14.9, d: 0.4, t: 9, r: -18 },
  { k: "leaf", x: 83.6, y: 11.8, d: 2.0, t: 10, r: 24 },
  { k: "leaf", x: 48.2, y: 25.4, d: 1.1, t: 9.5, r: -8 },
  { k: "leaf", x: 7.7, y: 72.9, d: 2.6, t: 8.5, r: 12 },
  { k: "leaf", x: 89.7, y: 76.8, d: 0.7, t: 9, r: -30 },
  { k: "leaf", x: 59.7, y: 82.0, d: 1.6, t: 10, r: 20 },
];

const BG_KEYFRAMES = `
@keyframes fgnFloat {
  0%, 100% { transform: translate(-50%, -50%) translate(0, 0); }
  33% { transform: translate(-50%, -50%) translate(5px, -7px); }
  66% { transform: translate(-50%, -50%) translate(-4px, 4px); }
}
@keyframes fgnTwinkle { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes fgnRise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes fgnFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes fgnSheetUp { from { transform: translateY(100%); } to { transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .fgn-anim { animation: none !important; }
}
`;

/** зелёный лист-частица */
export function Leaf({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: "block", overflow: "visible" }}>
      <path d="M12 2.5C7 7.5 4.5 11.2 4.5 14.6a7.5 7.5 0 0 0 15 0C19.5 11.2 17 7.5 12 2.5Z" fill={C.green} />
      <path d="M13.6 9.2 10.2 18.6" stroke="#0B3B20" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

function Particles() {
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {PARTICLES.map((p, i) => {
        const base: React.CSSProperties = {
          position: "absolute",
          left: `${p.x}%`,
          top: `${p.y}%`,
          transform: "translate(-50%, -50%)",
          animation: `fgnFloat ${p.t}s ease-in-out ${-p.d}s infinite`,
        };
        if (p.k === "leaf") {
          return (
            <div key={i} className="fgn-anim" style={base}>
              <div style={{ transform: `rotate(${p.r || 0}deg)`, filter: "drop-shadow(0 0 8px rgba(52, 214, 124, 0.55))" }}>
                <Leaf />
              </div>
            </div>
          );
        }
        const white = p.k === "white";
        return (
          <div key={i} className="fgn-anim" style={base}>
            <div
              className="fgn-anim"
              style={{
                width: white ? 7 : 6,
                height: white ? 7 : 6,
                borderRadius: "50%",
                background: white ? "#FFFFFF" : "#5BF29A",
                boxShadow: white
                  ? "0 0 6px 2px rgba(255,255,255,0.9), 0 0 18px 6px rgba(255,255,255,0.35)"
                  : "0 0 6px 2px rgba(52,214,124,0.9), 0 0 18px 6px rgba(52,214,124,0.35)",
                animation: `fgnTwinkle ${p.t * 0.6}s ease-in-out ${-p.d}s infinite`,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** фон FGN: сетка 48px от центра + частицы. Кладётся в контейнер с position: relative/fixed. */
export function FgnBackdrop({ style }: { style?: React.CSSProperties }) {
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", ...style }}>
      <style>{BG_KEYFRAMES}</style>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(${C.grid} 1px, transparent 1px), linear-gradient(90deg, ${C.grid} 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
          backgroundPosition: "center center",
        }}
      />
      <Particles />
    </div>
  );
}

// ── контурные иконки (24×24, stroke = currentColor) ──
const ICONS: Record<string, React.ReactNode> = {
  leaf: (
    <>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </>
  ),
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  chat: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  back: <path d="m14.5 18-6-6 6-6" />,
  close: <path d="M7 7l10 10M17 7 7 17" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </>
  ),
  bag: (
    <>
      <path d="M16 10a4 4 0 0 1-8 0" />
      <path d="M3.1 6h17.8" />
      <path d="M3.4 5.47a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.67a2 2 0 0 0-.4-1.2l-2-2.67A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" />
    </>
  ),
  ticket: (
    <>
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2M13 11v2M13 17v2" />
    </>
  ),
  bank: (
    <>
      <path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7" />
      <path d="M12 2 20 7H4Z" />
    </>
  ),
  card: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </>
  ),
  star: <path d="M11.53 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z" />,
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  phone: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M12 18h.01" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    </>
  ),
  tv: (
    <>
      <rect x="2" y="7" width="20" height="15" rx="2" />
      <path d="m17 2-5 5-5-5" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="14" height="14" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  key: (
    <>
      <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
      <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
    </>
  ),
  headphones: <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />,
  doc: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8M16 13H8M16 17H8" />
    </>
  ),
  shield: <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </>
  ),
  send: (
    <>
      <path d="M22 2 11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </>
  ),
  edit: (
    <>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </>
  ),
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4" />
    </>
  ),
};

export function FgnIcon({ name, size = 24, stroke = 1.7, style }: { name: keyof typeof ICONS | string; size?: number; stroke?: number; style?: React.CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: "block", flexShrink: 0, ...style }}
    >
      {ICONS[name]}
    </svg>
  );
}

/** контур щита FGN (viewBox 0 0 100 100) */
export const SHIELD_PATH = "M50 8C42 14.5 31 18 20 18.5V48c0 20 12.5 35.5 30 43 17.5-7.5 30-23 30-43V18.5C69 18 58 14.5 50 8Z";

/** нижний лист FGN (макет «Приглашение в семью»): затемнение 55%, лист #141416, скругление 20, крестик в круге 36 */
export function FgnSheet({ title, onClose, children, dim = "rgba(0, 0, 0, 0.55)" }: { title: string; onClose: () => void; children: React.ReactNode; dim?: string }) {
  useTgBack(onClose);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: dim,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        animation: "fgnFade 0.2s ease both",
        fontFamily: C.font,
      }}
    >
      <style>{BG_KEYFRAMES}</style>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "86%",
          overflowY: "auto",
          background: C.cardBg,
          border: `1px solid ${C.cardBorder}`,
          borderBottom: "none",
          borderRadius: "20px 20px 0 0",
          padding: "19px 20px",
          paddingBottom: "calc(25px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
          boxSizing: "border-box",
          animation: "fgnSheetUp 0.32s cubic-bezier(0.22, 1, 0.36, 1) both",
          color: C.text,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.015em", marginTop: -3 }}>{title}</div>
          <button
            type="button"
            aria-label="Закрыть"
            className="blin-press"
            onClick={onClose}
            style={{
              appearance: "none",
              margin: 0,
              padding: 0,
              width: 36,
              height: 36,
              flexShrink: 0,
              borderRadius: "50%",
              background: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.16)",
              color: C.text,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxSizing: "border-box",
            }}
          >
            <FgnIcon name="close" size={17} stroke={2} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** поле ввода FGN: 52px, скругление 18 */
export const fgnInput: React.CSSProperties = {
  appearance: "none",
  display: "block",
  width: "100%",
  height: 52,
  margin: 0,
  padding: "0 17px",
  borderRadius: 18,
  border: `1px solid ${C.cardBorder}`,
  background: "rgba(0, 0, 0, 0.22)",
  color: C.text,
  fontFamily: C.font,
  fontSize: 16.5,
  fontWeight: 400,
  outline: "none",
  boxSizing: "border-box",
};

/** большая светлая кнопка FGN: 52px, скругление 24 */
export const fgnButton: React.CSSProperties = {
  appearance: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: 52,
  margin: 0,
  padding: 0,
  borderRadius: 24,
  border: "none",
  background: C.btnSoft,
  color: C.btnText,
  fontFamily: C.font,
  fontSize: 17,
  fontWeight: 500,
  letterSpacing: "-0.01em",
  cursor: "pointer",
};

/** экран FGN: фон-сетка + прокручиваемая колонка с отступами 20 */
export function FgnPage({ children, top = 24 }: { children: React.ReactNode; top?: number }) {
  return (
    <div style={pageOuter({ background: C.bg })}>
      <div style={pageFrame({ background: C.bg, fontFamily: C.font, color: C.text })}>
        <FgnBackdrop />
        <div
          className="blin-scroll"
          style={{
            position: "relative",
            zIndex: 1,
            height: "100%",
            overflowY: "auto",
            padding: "0 20px",
            paddingTop: `calc(${top}px + var(--blin-tg-pad-top, 0px) / var(--blin-scale))`,
            paddingBottom: "calc(28px + var(--blin-tg-pad-bottom, 0px) / var(--blin-scale))",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** шапка FGN (макет «Промокод»): круглая кнопка «назад» 44 + заголовок 24/600 */
export function FgnHeader({ title, onBack, btnStyle }: { title: string; onBack: () => void; btnStyle?: React.CSSProperties }) {
  useTgBack(onBack);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, height: 44 }}>
      <button
        type="button"
        aria-label="Назад"
        className="blin-press"
        onClick={onBack}
        style={{
          appearance: "none",
          margin: 0,
          padding: 0,
          width: 44,
          height: 44,
          flexShrink: 0,
          borderRadius: "50%",
          background: "rgba(10, 10, 11, 0.9)",
          border: "1px solid rgba(255, 255, 255, 0.16)",
          color: C.text,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxSizing: "border-box",
          ...btnStyle,
        }}
      >
        <FgnIcon name="back" size={20} stroke={2} />
      </button>
      <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.015em", whiteSpace: "nowrap" }}>{title}</div>
    </div>
  );
}

/** поле-«пилюля» FGN (макет «Промокод»): 57px, текст по центру */
export const fgnPillInput: React.CSSProperties = {
  appearance: "none",
  display: "block",
  width: "100%",
  height: 57,
  margin: 0,
  padding: "0 22px",
  borderRadius: 29,
  border: `1px solid ${C.cardBorder}`,
  background: "#161618",
  color: C.text,
  fontFamily: C.font,
  fontSize: 17,
  fontWeight: 400,
  textAlign: "center",
  outline: "none",
  boxSizing: "border-box",
};

/** кнопка-«пилюля» FGN: 55.5px; off — тёмная с серым текстом */
export function fgnPillButton(enabled: boolean): React.CSSProperties {
  return {
    ...fgnButton,
    height: 55.5,
    borderRadius: 28,
    background: enabled ? C.btnSoft : "#232326",
    color: enabled ? C.btnText : "rgba(200, 200, 206, 0.72)",
    cursor: enabled ? "pointer" : "default",
    transition: "background 0.2s ease, color 0.2s ease",
  };
}

/** строка меню в листе FGN (макет «Подарки»): 65px (75 с подписью), иконка в круге 35, шеврон справа */
export function FgnMenuRow({ icon, title, subtitle, onClick }: { icon: string; title: string; subtitle?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="blin-press"
      onClick={onClick}
      style={{
        appearance: "none",
        margin: 0,
        width: "100%",
        minHeight: subtitle ? 75 : 65,
        padding: "0 15px 0 17px",
        borderRadius: 16,
        border: "1px solid rgba(255, 255, 255, 0.12)",
        background: "transparent",
        color: C.text,
        fontFamily: C.font,
        display: "flex",
        alignItems: "center",
        gap: 12.5,
        textAlign: "left",
        cursor: "pointer",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          width: 35,
          height: 35,
          flexShrink: 0,
          borderRadius: "50%",
          border: "1px solid rgba(255, 255, 255, 0.14)",
          background: "#0E0E10",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
        }}
      >
        <FgnIcon name={icon} size={18} stroke={1.8} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 17, fontWeight: 500, lineHeight: "20px", letterSpacing: "-0.01em" }}>{title}</span>
        {subtitle ? (
          <span style={{ fontSize: 14.5, lineHeight: "18px", color: "rgba(196, 196, 206, 0.62)" }}>{subtitle}</span>
        ) : null}
      </span>
      <FgnIcon name="chevron" size={18} stroke={1.8} style={{ color: "rgba(255, 255, 255, 0.7)" }} />
    </button>
  );
}

/** карточка FGN (макеты «Купить подарок», «Мои подарки»): 82px, радиус 23, заголовок + подпись слева, значение справа */
export function FgnCard({ title, subtitle, right, onClick, dim, style }: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  onClick?: () => void;
  dim?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      className={onClick ? "blin-press" : undefined}
      onClick={onClick}
      style={{
        appearance: "none",
        margin: 0,
        width: "100%",
        minHeight: 82,
        padding: "0 18px 0 17px",
        borderRadius: 23,
        border: "1px solid rgba(42, 42, 48, 1)",
        background: C.cardBg,
        color: C.text,
        fontFamily: C.font,
        display: "flex",
        alignItems: "center",
        gap: 12,
        textAlign: "left",
        cursor: onClick ? "pointer" : "default",
        boxSizing: "border-box",
        opacity: dim ? 0.55 : 1,
        ...style,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 16.5, fontWeight: 500, lineHeight: "20px", letterSpacing: "-0.005em" }}>{title}</span>
        {subtitle ? <span style={{ fontSize: 14.5, lineHeight: "18px", color: C.muted }}>{subtitle}</span> : null}
      </span>
      {right}
    </button>
  );
}

/** затемнение под листами/диалогами FGN (макеты 49/50): #070708 70% */
export const FGN_DIM = "rgba(7, 7, 8, 0.7)";

/** диалог FGN (макет 50): карточка с отступами 16 и 24 снизу, радиус 24, текст 16/26, кнопки 52 светлая + 54 тёмная (радиус 16, зазор 8) */
export function FgnDialog({ title, text, primary, onPrimary, secondary = "Закрыть", onClose }: {
  /** с заголовком (макет «Семейная подписка»): заголовок 18/600, текст 14.5/22 серым, кнопки на 22 ниже */
  title?: string;
  text: React.ReactNode;
  primary?: string;
  onPrimary?: () => void;
  secondary?: string;
  onClose: () => void;
}) {
  useTgBack(onClose);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: FGN_DIM,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "0 16px",
        paddingBottom: "calc(24px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
        boxSizing: "border-box",
        animation: "fgnFade 0.2s ease both",
        fontFamily: C.font,
      }}
    >
      <style>{BG_KEYFRAMES}</style>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 488,
          background: C.cardBg,
          border: "1px solid #2A2A30",
          borderRadius: 24,
          padding: 20,
          boxSizing: "border-box",
          color: C.text,
          animation: "fgnRise 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {title ? (
          <>
            <div style={{ fontSize: 18, fontWeight: 600, lineHeight: "26px", letterSpacing: "-0.015em", color: "#F4F4F5" }}>{title}</div>
            <div style={{ marginTop: 10, fontSize: 14.5, fontWeight: 400, lineHeight: "22px", color: "#9B9BA4" }}>{text}</div>
          </>
        ) : (
          <div style={{ fontSize: 16, fontWeight: 400, lineHeight: "26px", color: "#F4F4F5" }}>{text}</div>
        )}
        {primary ? (
          <button
            type="button"
            className="blin-press"
            onClick={onPrimary}
            style={{ ...fgnButton, marginTop: title ? 22 : 20, height: 52, borderRadius: 16, background: "#F3F3F4", fontSize: 16, letterSpacing: 0 }}
          >
            {primary}
          </button>
        ) : null}
        <button
          type="button"
          className="blin-press"
          onClick={onClose}
          style={{
            ...fgnButton,
            marginTop: primary ? 8 : title ? 22 : 20,
            height: 54,
            borderRadius: 16,
            background: "transparent",
            border: "1px solid #2A2A30",
            color: C.text,
            fontSize: 16,
            letterSpacing: 0,
            boxSizing: "border-box",
          }}
        >
          {secondary}
        </button>
      </div>
    </div>
  );
}
