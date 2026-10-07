import React, { useEffect, useRef, useState } from "react";
import { MSIcon, btnReset, pageFrame, pageOuter } from "./ui";

/**
 * Новый стиль приложения (видео-фон, тёмные стеклянные карточки, красный акцент).
 * Страницы переводим на него постепенно.
 */
export const N = {
  font: "'Onest', 'Outfit', system-ui, sans-serif",
  bg: "#05050A",
  text: "#FFFFFF",
  muted: "rgba(196, 196, 206, 0.66)",
  dim: "rgba(196, 196, 206, 0.42)",
  red: "#E00000",
  redText: "#F01515",
  card: "rgba(16, 16, 22, 0.9)",
  cardBorder: "rgba(255, 255, 255, 0.11)",
  divider: "rgba(255, 255, 255, 0.09)",
  warn: "#FFB23F",
} as const;

const BG_MP4 = "/assets/home-bg.mp4";
const BG_WEBM = "/assets/home-bg.webm";
const BG_POSTER = "/assets/home-bg-poster.jpg";

/** зацикленное видео на фоне + затемнение; dim — насколько темнить (0..1) */
export function VideoBackdrop({ dim = 0.35, style }: { dim?: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // iOS / Telegram WebView: автоплей только muted + playsInline
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    const p = v.play();
    if (p && typeof p.catch === "function") p.catch(() => { /* остаётся постер */ });
  }, []);
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        background: `#07070D url(${BG_POSTER}) center / cover no-repeat`,
        pointerEvents: "none",
        ...style,
      }}
    >
      <video
        ref={ref}
        poster={BG_POSTER}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      >
        <source src={BG_MP4} type="video/mp4" />
        <source src={BG_WEBM} type="video/webm" />
      </video>
      <div style={{ position: "absolute", inset: 0, background: `rgba(5,5,10,${dim})` }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to bottom, rgba(5,5,10,0.1) 0%, rgba(5,5,10,0) 30%, rgba(5,5,10,0.55) 75%, rgba(5,5,10,0.85) 100%)",
        }}
      />
    </div>
  );
}

/** страница нового стиля: фон + прокрутка + безопасные отступы */
export function NoirScreen({ children, dim }: { children: React.ReactNode; dim?: number }) {
  return (
    <div style={pageOuter({ background: N.bg })}>
      <div style={pageFrame({ background: N.bg, fontFamily: N.font, overflow: "hidden" })}>
        <VideoBackdrop dim={dim} />
        <div
          className="blin-scroll blin-tg-safe"
          style={{
            position: "relative",
            zIndex: 1,
            height: "100%",
            paddingLeft: 20,
            paddingRight: 20,
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

type TgBackButton = { show: () => void; hide: () => void; onClick: (cb: () => void) => void };

/** кнопка «Назад» в шапке Telegram (вместо «Закрыть»); null — не в Telegram или старый клиент */
function tgBackButton(): TgBackButton | null {
  try {
    const wa = (window as unknown as {
      Telegram?: { WebApp?: { initData?: string; BackButton?: TgBackButton; isVersionAtLeast?: (v: string) => boolean } };
    }).Telegram?.WebApp;
    if (!wa?.initData || !wa.BackButton) return null;
    if (wa.isVersionAtLeast && !wa.isVersionAtLeast("6.1")) return null;
    return wa.BackButton;
  } catch {
    return null;
  }
}

// у верхнего экрана (например, окно оплаты поверх страницы) свой обработчик
const backStack: { current: () => void }[] = [];
let backBound = false;

/**
 * «Назад»: в Telegram — системная кнопка в шапке мини-приложения,
 * на сайте — круглая кнопка вверху страницы.
 */
/** регистрирует обработчик системной «Назад» Telegram, пока компонент на экране; true — мы в Telegram */
export function useTgBack(handler?: () => void): boolean {
  const tg = tgBackButton();
  const ref = useRef<() => void>(() => {});
  ref.current = handler || (() => {});
  const active = Boolean(tg && handler);

  useEffect(() => {
    if (!tg || !active) return;
    if (!backBound) {
      tg.onClick(() => backStack[backStack.length - 1]?.current());
      backBound = true;
    }
    backStack.push(ref);
    tg.show();
    return () => {
      const i = backStack.lastIndexOf(ref);
      if (i >= 0) backStack.splice(i, 1);
      if (!backStack.length) tg.hide();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return Boolean(tg);
}

export function NoirBack({ onClick }: { onClick: () => void }) {
  const tg = useTgBack(onClick);
  if (tg) return null;

  return (
    <button
      type="button"
      aria-label="Назад"
      onClick={onClick}
      className="blin-press"
      style={{
        ...btnReset,
        width: 44,
        height: 44,
        flex: "none",
        borderRadius: "50%",
        background: "rgba(16, 16, 22, 0.88)",
        border: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <MSIcon name="chevron_left" style={{ fontSize: 24, color: N.text, fontVariationSettings: "'wght' 300" }} />
    </button>
  );
}

export function NoirSection({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: N.dim,
        margin: "26px 0 12px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function NoirCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: N.card,
        border: `1px solid ${N.cardBorder}`,
        borderRadius: 24,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** строка-кнопка: иконка, текст, шеврон */
export function NoirRow({
  icon,
  title,
  onClick,
  disabled,
  right,
}: {
  icon?: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="blin-press"
      style={{
        ...btnReset,
        fontFamily: N.font,
        width: "100%",
        minHeight: 56,
        padding: icon ? "0 18px 0 16px" : "0 18px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: N.card,
        border: `1px solid ${N.cardBorder}`,
        borderRadius: 28,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        color: disabled ? N.dim : N.text,
        cursor: disabled ? "default" : "pointer",
        textAlign: "left",
      }}
    >
      {icon ? (
        <MSIcon name={icon} style={{ fontSize: 23, color: "rgba(255,255,255,0.85)", fontVariationSettings: "'wght' 300" }} />
      ) : null}
      <span style={{ flex: 1, fontSize: 17, fontWeight: 400, letterSpacing: "-0.01em" }}>{title}</span>
      {right}
      <MSIcon name="chevron_right" style={{ fontSize: 20, color: N.dim, fontVariationSettings: "'wght' 300" }} />
    </button>
  );
}

/** нижний лист поверх страницы */
export function NoirSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useTgBack(onClose);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: "rgba(4, 4, 8, 0.6)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        animation: "blinvpnFadeIn 0.2s ease both",
        fontFamily: N.font,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "86%",
          overflowY: "auto",
          background: "#111117",
          borderTop: `1px solid ${N.cardBorder}`,
          borderRadius: "26px 26px 0 0",
          padding: "18px 20px",
          paddingBottom: "calc(20px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
          boxSizing: "border-box",
          animation: "blinvpnSheetUp 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
          color: N.text,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontWeight: 500, fontSize: 20, letterSpacing: "-0.015em" }}>{title}</div>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            style={{
              ...btnReset,
              border: "none",
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <MSIcon name="close" style={{ fontSize: 20, color: N.text }} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** большая кнопка: primary — красная, иначе тёмная */
export function NoirButton({
  children,
  onClick,
  primary,
  disabled,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  icon?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="blin-press"
      style={{
        ...btnReset,
        fontFamily: N.font,
        width: "100%",
        height: 56,
        borderRadius: 18,
        border: primary ? "none" : `1px solid ${N.cardBorder}`,
        background: disabled ? "rgba(60, 10, 12, 0.85)" : primary ? N.red : N.card,
        color: disabled ? "rgba(170,160,160,0.75)" : N.text,
        fontSize: 17,
        fontWeight: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        cursor: disabled ? "default" : "pointer",
        boxShadow: primary && !disabled ? "0 14px 38px -12px rgba(224, 0, 0, 0.75)" : "none",
      }}
    >
      {icon ? <MSIcon name={icon} style={{ fontSize: 22, color: "inherit", fontVariationSettings: "'wght' 300" }} /> : null}
      {children}
    </button>
  );
}

/** ссылка подписки + «Скопировать» в новом стиле */
export function NoirLinkBox({ link, loading, error }: { link: string; loading?: boolean; error?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!link) return;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(link); ok = true; }
    } catch { /* fallback */ }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch { /* ignore */ }
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        onClick={() => void copy()}
        style={{
          background: "rgba(255,255,255,0.05)",
          border: `1px solid ${N.cardBorder}`,
          borderRadius: 16,
          padding: "13px 15px",
          fontSize: 13.5,
          lineHeight: 1.45,
          color: error ? "#FF6B6B" : loading ? N.dim : N.muted,
          wordBreak: "break-all",
          userSelect: "all",
          WebkitUserSelect: "all",
          minHeight: 48,
          cursor: link ? "pointer" : "default",
        }}
      >
        {loading ? "Получаем ссылку…" : error || link}
      </div>
      <NoirButton primary disabled={!link || loading} icon={copied ? "check" : "content_copy"} onClick={() => void copy()}>
        {copied ? "Скопировано" : "Скопировать ссылку"}
      </NoirButton>
    </div>
  );
}

/** поле ввода в новом стиле */
export function NoirField({
  value,
  onChange,
  placeholder,
  type = "text",
  onKeyDown,
  autoFocus,
  maxLength,
  inputMode,
  autoComplete,
  invalid,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  maxLength?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  invalid?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      autoFocus={autoFocus}
      maxLength={maxLength}
      inputMode={inputMode}
      autoComplete={autoComplete}
      spellCheck={false}
      style={{
        width: "100%",
        height: 56,
        boxSizing: "border-box",
        padding: "0 18px",
        borderRadius: 18,
        border: `1px solid ${invalid ? "rgba(255,80,80,0.6)" : N.cardBorder}`,
        background: "rgba(255,255,255,0.05)",
        color: N.text,
        fontFamily: N.font,
        fontSize: 17,
        outline: "none",
        ...style,
      }}
    />
  );
}

/** экран загрузки: видео-фон и красный индикатор */
export function NoirLoading({ text = "Загрузка…" }: { text?: string }) {
  return (
    <div style={pageOuter({ background: N.bg })}>
      <div style={pageFrame({ background: N.bg, fontFamily: N.font, overflow: "hidden" })}>
        <VideoBackdrop dim={0.5} />
        <div
          style={{
            position: "relative",
            zIndex: 1,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              border: "3px solid rgba(255,255,255,0.14)",
              borderTopColor: N.red,
              animation: "blinvpnSpin 0.8s linear infinite",
            }}
          />
          <div style={{ color: N.muted, fontSize: 15 }}>{text}</div>
        </div>
      </div>
    </div>
  );
}

/** окно по центру экрана (ошибка, подтверждение, обязательная подписка) */
export function NoirDialog({
  children,
  onClose,
  zIndex = 3200,
  dim = 0.66,
}: {
  children: React.ReactNode;
  onClose?: () => void;
  zIndex?: number;
  dim?: number;
}) {
  useTgBack(onClose);
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => onClose?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        background: `rgba(4, 4, 8, ${dim})`,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        boxSizing: "border-box",
        fontFamily: N.font,
        animation: "blinvpnFadeIn 0.2s ease both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 380,
          maxHeight: "86vh",
          overflowY: "auto",
          background: "#111117",
          border: `1px solid ${N.cardBorder}`,
          borderRadius: 28,
          padding: "26px 20px 16px",
          boxSizing: "border-box",
          color: N.text,
          animation: "blinvpnSheetUp 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** значок в красном квадрате сверху окна */
export function NoirBadge({ icon, tone = "red" }: { icon: string; tone?: "red" | "green" }) {
  const green = tone === "green";
  return (
    <div
      style={{
        width: 58,
        height: 58,
        borderRadius: 18,
        background: green ? "rgba(47, 211, 154, 0.14)" : "rgba(224, 0, 0, 0.16)",
        border: `1px solid ${green ? "rgba(47, 211, 154, 0.3)" : "rgba(224, 0, 0, 0.32)"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <MSIcon name={icon} style={{ fontSize: 30, color: green ? "#2FD39A" : N.redText, fontVariationSettings: "'wght' 300" }} />
    </div>
  );
}

/** тихая текстовая кнопка под основной */
export function NoirTextButton({ children, onClick, disabled, color }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="blin-press"
      style={{
        ...btnReset,
        width: "100%",
        height: 46,
        border: "none",
        background: "transparent",
        color: disabled ? N.dim : color || N.muted,
        fontFamily: N.font,
        fontSize: 15.5,
        fontWeight: 500,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
