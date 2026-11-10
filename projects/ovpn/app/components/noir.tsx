import React, { useEffect, useRef, useState } from "react";
import { btnReset } from "./ui";
import { OIcon, O, OCard, OScreen, OBack, OButton, OLabel, OMenuRow, OSheet, OSpinner, msToLucide } from "./ovpn";

/**
 * O-VPN: те же компоненты, что в общем стиле (src/app/components/noir.tsx), но в дизайне O-VPN
 * (тёплый уголь, кремовые тексты, красный акцент, Manrope). Общие экраны без своей версии
 * в projects/ovpn/app/pages выглядят так же, как остальные экраны O-VPN.
 */
export const N = {
  font: O.font,
  bg: O.bg,
  text: O.text,
  muted: O.muted,
  dim: O.dim,
  red: O.red,
  redText: O.red,
  card: O.card,
  cardBorder: O.border,
  divider: O.border,
  warn: "#FFB23F",
} as const;

/** фон экрана: арена O-VPN + затемнение (видео у O-VPN нет) */
export function VideoBackdrop({ dim, style }: { dim?: number; style?: React.CSSProperties }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        background: `${O.bg} url(${O.bgImage}) center top / cover no-repeat`,
        pointerEvents: "none",
        ...style,
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: `rgba(16, 12, 11, ${dim ?? 0.55})` }} />
    </div>
  );
}

export function NoirScreen({ children }: { children: React.ReactNode; dim?: number }) {
  return <OScreen>{children}</OScreen>;
}

type TgBackButton = { show: () => void; hide: () => void; onClick: (cb: () => void) => void };

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

const backStack: { current: () => void }[] = [];
let backBound = false;

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

/** «← Назад» по макету — видна всегда (и в Telegram, вместе с системной кнопкой) */
export function NoirBack({ onClick }: { onClick: () => void }) {
  return <OBack onClick={onClick} />;
}

export function NoirSection({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <OLabel style={style}>{children}</OLabel>;
}

export function NoirCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <OCard style={style}>{children}</OCard>;
}

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
  return <OMenuRow icon={icon ? msToLucide(icon) : undefined} title={title} onClick={onClick} disabled={disabled} right={right} />;
}

export function NoirSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useTgBack(onClose);
  return <OSheet title={title} onClose={onClose}>{children}</OSheet>;
}

export function NoirButton({
  children,
  onClick,
  primary,
  green,
  disabled,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  green?: boolean;
  disabled?: boolean;
  icon?: string;
}) {
  return (
    <OButton
      tone={green ? "green" : primary ? "red" : "dark"}
      disabled={disabled}
      icon={icon ? msToLucide(icon) : undefined}
      onClick={onClick}
    >
      {children}
    </OButton>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function NoirLinkBox({ link, loading, error }: { link: string; loading?: boolean; error?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!link) return;
    if (await copyText(link)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        onClick={() => void copy()}
        style={{
          background: O.bg,
          border: `1px solid ${O.border}`,
          borderRadius: 16,
          padding: "12px 16px",
          fontSize: 14,
          lineHeight: "20px",
          color: error ? O.danger : O.muted,
          wordBreak: "break-all",
          userSelect: "all",
          WebkitUserSelect: "all",
          minHeight: 48,
          cursor: link ? "pointer" : "default",
        }}
      >
        {loading ? "Получаем ссылку…" : error || link}
      </div>
      <OButton tone="red" disabled={!link || loading} icon={copied ? "check" : "copy"} onClick={() => void copy()}>
        {copied ? "Скопировано" : "Скопировать ссылку"}
      </OButton>
    </div>
  );
}

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
      className="ovpn-input"
      style={{
        width: "100%",
        height: 56,
        boxSizing: "border-box",
        padding: "0 16px",
        borderRadius: 16,
        border: `1px solid ${invalid ? O.danger : O.border}`,
        background: O.bg,
        color: O.text,
        fontFamily: O.font,
        fontSize: 16,
        fontWeight: 500,
        outline: "none",
        ...style,
      }}
    />
  );
}

export function NoirLoading({ text = "Загрузка…" }: { text?: string }) {
  return (
    <OScreen center>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <OSpinner />
        <div style={{ color: O.muted, fontSize: 14 }}>{text}</div>
      </div>
    </OScreen>
  );
}

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
        background: `rgba(16, 12, 11, ${dim})`,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        boxSizing: "border-box",
        fontFamily: O.font,
        animation: "blinvpnFadeIn 0.2s ease both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 358,
          maxHeight: "86vh",
          overflowY: "auto",
          background: O.sheet,
          border: `1px solid ${O.border}`,
          borderRadius: 24,
          padding: 20,
          boxSizing: "border-box",
          color: O.text,
          animation: "blinvpnSheetUp 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function NoirBadge({ icon, tone = "red" }: { icon: string; tone?: "red" | "green" }) {
  const green = tone === "green";
  return (
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: 16,
        background: green ? "rgba(47, 190, 74, 0.14)" : "rgba(227, 27, 35, 0.14)",
        border: `1px solid ${green ? "rgba(47, 190, 74, 0.35)" : "rgba(227, 27, 35, 0.35)"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <OIcon name={msToLucide(icon)} size={28} color={green ? O.green : O.red} />
    </div>
  );
}

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
        height: 44,
        border: "none",
        background: "transparent",
        color: disabled ? O.dim : color || O.muted,
        fontFamily: O.font,
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
