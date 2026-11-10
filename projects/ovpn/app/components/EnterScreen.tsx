import React, { useEffect, useState } from "react";
import { markEntered } from "../utils/homeIntro";
import { useTgBack } from "./noir";
import { acceptTerms, fetchLegal } from "../utils/api";
import { RichText } from "./RichText";
import { O, OButton, OIcon, OSheet } from "./ovpn";

// O-VPN: заставка (01) и «Добро пожаловать» (02–03) по макету
const POSTER_SRC = "/assets/intro-poster.jpg";
const LEAVE_MS = 520;

export type EnterTerms = "checking" | "need" | "ok" | "anon";

type Phase = "tap" | "terms" | "leaving" | "gone";
type Doc = "offer" | "privacy";
const DOC_TITLE: Record<Doc, string> = { offer: "Договор оферты", privacy: "Политика конфиденциальности" };

function haptic(kind: "impact" | "success") {
  try {
    const hf = (window as unknown as {
      Telegram?: { WebApp?: { HapticFeedback?: { impactOccurred?: (s: string) => void; notificationOccurred?: (s: string) => void } } };
    }).Telegram?.WebApp?.HapticFeedback;
    if (kind === "impact") hf?.impactOccurred?.("light");
    else hf?.notificationOccurred?.("success");
  } catch { /* ignore */ }
}

export default function EnterScreen({ terms, onAccepted }: { terms: EnterTerms; onAccepted: () => void }) {
  const [phase, setPhase] = useState<Phase>("tap");
  const [tapped, setTapped] = useState(false);
  const [welcomeShown, setWelcomeShown] = useState(false);
  useEffect(() => { if (phase === "terms") setWelcomeShown(true); }, [phase]);

  const leave = () => {
    setPhase("leaving");
    markEntered();
    window.setTimeout(() => setPhase("gone"), LEAVE_MS);
  };

  useEffect(() => {
    if (!tapped || phase !== "tap") return;
    if (terms === "need") setPhase("terms");
    else if (terms === "ok" || terms === "anon") leave();
  }, [tapped, terms, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === "gone" && terms === "need") setPhase("terms");
  }, [phase, terms]);

  const onTap = () => {
    if (phase !== "tap" || tapped) return;
    haptic("impact");
    setTapped(true);
  };

  if (phase === "gone") return null;
  const leaving = phase === "leaving";
  const showTerms = phase === "terms" || (leaving && welcomeShown);

  return (
    <div
      role={phase === "tap" ? "button" : "dialog"}
      tabIndex={phase === "tap" ? 0 : -1}
      aria-label={phase === "tap" ? "Коснитесь, чтобы войти" : "Добро пожаловать"}
      onPointerDown={phase === "tap" ? onTap : undefined}
      onKeyDown={(e) => { if (phase === "tap" && (e.key === "Enter" || e.key === " ")) onTap(); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        overflow: "hidden",
        background: O.bg,
        cursor: phase === "tap" ? "pointer" : "default",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
        opacity: leaving ? 0 : 1,
        transform: leaving ? "scale(1.04)" : "scale(1)",
        transition: `opacity ${LEAVE_MS}ms cubic-bezier(0.33, 1, 0.32, 1), transform ${LEAVE_MS}ms cubic-bezier(0.33, 1, 0.32, 1)`,
        pointerEvents: leaving ? "none" : "auto",
        outline: "none",
        fontFamily: O.font,
        color: O.text,
      }}
    >
      {showTerms ? (
        <WelcomeTerms onAccepted={() => { haptic("success"); onAccepted(); leave(); }} />
      ) : (
        <Splash dim={tapped} />
      )}
    </div>
  );
}

// 01 Заставка: кадр бойца, снизу градиент, «O-VPN» (Anton 48) и «Коснитесь, чтобы войти»
function Splash({ dim }: { dim: boolean }) {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, background: `${O.bg} url(${POSTER_SRC}) center / cover no-repeat` }} />
      <div
        aria-hidden
        style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, #100C0B 0%, rgba(16,12,11,0.25) 50%, rgba(16,12,11,0) 100%)" }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "0 24px",
          paddingBottom: "calc(56px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontFamily: O.display, fontSize: 48, lineHeight: "48px", letterSpacing: "1.2px", color: O.text, filter: "drop-shadow(0 2px 16px rgba(0,0,0,0.9))" }}>
          O-VPN
        </div>
        <div
          style={{
            marginTop: 20,
            height: 28,
            display: "flex",
            alignItems: "center",
            gap: 8,
            opacity: dim ? 0.3 : 0.56,
            transition: "opacity 0.3s ease",
          }}
        >
          <OIcon name="pointer" size={20} color={O.text} />
          <span style={{ fontSize: 18, fontWeight: 700, lineHeight: "28px" }}>Коснитесь, чтобы войти</span>
        </div>
      </div>
    </div>
  );
}

// 02–03 Добро пожаловать: согласие с офертой и политикой
function WelcomeTerms({ onAccepted }: { onAccepted: () => void }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [docs, setDocs] = useState<Record<Doc, string> | null>(null);

  const openDoc = async (d: Doc) => {
    setDoc(d);
    if (!docs) {
      try {
        const l = await fetchLegal();
        setDocs({ offer: l.offer || "Документ пока не опубликован.", privacy: l.privacy || "Документ пока не опубликован." });
      } catch {
        setDocs({ offer: "Не удалось загрузить документ. Попробуйте позже.", privacy: "Не удалось загрузить документ. Попробуйте позже." });
      }
    }
  };

  const accept = async () => {
    if (!checked || busy) return;
    setBusy(true);
    setErr("");
    try {
      await acceptTerms();
      onAccepted();
    } catch (e) {
      const raw = e instanceof Error ? e.message : "";
      setErr(raw === "Failed to fetch"
        ? "Нет связи с сервером. Проверьте интернет и нажмите ещё раз."
        : (raw || "Не удалось сохранить. Попробуйте ещё раз."));
      setBusy(false);
    }
  };

  const link: React.CSSProperties = {
    appearance: "none",
    background: "transparent",
    border: "none",
    padding: 0,
    margin: 0,
    font: "inherit",
    color: O.text,
    textDecoration: "underline",
    textUnderlineOffset: 2,
    cursor: "pointer",
    display: "inline",
    textAlign: "left",
  };
  const rise = (delay: number): React.CSSProperties => ({ animation: `blinvpnWelcomeRise 0.7s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s both` });
  const enabled = checked && !busy;

  return (
    <div style={{ position: "absolute", inset: 0, animation: "blinvpnFadeIn 0.35s ease both" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, background: `${O.bg} url(${O.welcomeImage}) center / cover no-repeat` }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(16, 12, 11, 0.55)" }} />
      <div
        className="blin-tg-safe"
        style={{
          position: "absolute",
          inset: 0,
          padding: 16,
          paddingBottom: "calc(16px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          userSelect: "text",
          WebkitUserSelect: "text",
        }}
      >
        <div
          style={{
            ...rise(0.05),
            paddingTop: 24,
            fontSize: 36,
            fontWeight: 800,
            lineHeight: "36px",
            letterSpacing: "-0.9px",
            textAlign: "center",
            filter: "drop-shadow(0 2px 12px rgba(0,0,0,0.85))",
          }}
        >
          Добро
          <br />
          пожаловать!
        </div>
        <div
          style={{
            ...rise(0.12),
            marginTop: 12,
            maxWidth: 320,
            fontSize: 14,
            lineHeight: "22.75px",
            color: O.cream,
            textAlign: "center",
            filter: "drop-shadow(0 2px 10px rgba(0,0,0,0.9))",
          }}
        >
          Перед входом нужно подтвердить политику конфиденциальности и оферту. Без этого приложение не откроется.
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ ...rise(0.2), width: "100%", maxWidth: 358 }}>
          <label
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              background: "rgba(28, 21, 19, 0.9)",
              border: `1px solid ${O.border}`,
              borderRadius: 24,
              padding: 16,
              boxSizing: "border-box",
              cursor: "pointer",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <input
              type="checkbox"
              aria-label="Принять оферту и политику"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
            />
            <span
              aria-hidden
              style={{
                flex: "none",
                width: 24,
                height: 24,
                marginTop: 2,
                boxSizing: "border-box",
                borderRadius: 6,
                background: checked ? O.red : O.bg,
                border: `1px solid ${checked ? O.red : O.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.18s ease, border-color 0.18s ease",
              }}
            >
              {checked ? <OIcon name="check" size={16} color={O.onRed} stroke={3} /> : null}
            </span>
            <span style={{ fontSize: 14, lineHeight: "22.75px", color: O.text }}>
              Я прочитал(а) и принимаю
              <br />
              <button type="button" style={link} onClick={(e) => { e.preventDefault(); void openDoc("offer"); }}>договор оферты</button>
              {" и"}
              <br />
              <button type="button" style={link} onClick={(e) => { e.preventDefault(); void openDoc("privacy"); }}>политику конфиденциальности</button>
            </span>
          </label>
          <div style={{ height: 12 }} />
          <OButton tone="red" disabled={!enabled} onClick={() => void accept()}>
            {busy ? "Сохраняем…" : "Продолжить"}
          </OButton>
          {err ? <div style={{ fontSize: 13, color: O.danger, marginTop: 10, textAlign: "center" }}>{err}</div> : null}
        </div>
      </div>

      {doc ? <DocSheet title={DOC_TITLE[doc]} text={docs ? docs[doc] : null} onClose={() => setDoc(null)} /> : null}
    </div>
  );
}

function DocSheet({ title, text, onClose }: { title: string; text: string | null; onClose: () => void }) {
  useTgBack(onClose);
  return (
    <OSheet title={title} onClose={onClose}>
      <div style={{ maxHeight: "60vh", overflowY: "auto", userSelect: "text" }}>
        {text !== null ? <RichText text={text} /> : <div style={{ fontSize: 14, color: O.muted }}>Загрузка…</div>}
      </div>
      <div style={{ height: 12 }} />
      <OButton tone="dark" onClick={onClose}>Понятно</OButton>
    </OSheet>
  );
}
