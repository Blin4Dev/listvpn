import React, { useEffect, useState } from "react";
import { markEntered } from "../utils/homeIntro";
import { useTgBack } from "./noir";
import { acceptTerms, fetchLegal } from "../utils/api";
import { RichText } from "./RichText";
import { O, OButton, OIcon, OSheet } from "./lyam";

// ЛЯМ200: «Добро пожаловать» (01–02) по макету. Экрана «Коснитесь, чтобы войти» в макете нет —
// пока проверяется согласие, виден фон с логотипом (intro-poster.jpg), затем сразу приветствие или главная.
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
  const [tapped, setTapped] = useState(true);
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

// фон на время проверки: тёмно-синий с логотипом по центру
const SPLASH_BG = `${O.bg} url(${POSTER_SRC}) center / cover no-repeat`;

function Splash(_: { dim: boolean }) {
  return <div aria-hidden style={{ position: "absolute", inset: 0, background: SPLASH_BG }} />;
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
      <div aria-hidden style={{ position: "absolute", inset: 0, background: O.bg }} />
      <div
        className="blin-tg-safe"
        style={{
          position: "absolute",
          inset: 0,
          padding: "56px 20px 16px",
          paddingBottom: "calc(24px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          userSelect: "text",
          WebkitUserSelect: "text",
        }}
      >
        <img src="/assets/logo.png" alt="ЛЯМ200 VPN" draggable={false} style={{ ...rise(0.02), width: 96, height: 96, borderRadius: 16, objectFit: "cover", display: "block" }} />
        <div style={{ ...rise(0.05), paddingTop: 32, fontSize: 24, fontWeight: 600, lineHeight: "32px", textAlign: "center" }}>
          Добро пожаловать
        </div>
        <div style={{ ...rise(0.12), marginTop: 16, maxWidth: 320, fontSize: 14, lineHeight: "22.75px", color: O.muted, textAlign: "center" }}>
          Перед входом подтвердите оферту и политику конфиденциальности. Без этого приложение не откроется.
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ ...rise(0.2), width: "100%", maxWidth: 358 }}>
          <label
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              background: O.card,
              borderRadius: 16,
              padding: 16,
              boxSizing: "border-box",
              cursor: "pointer",
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
                width: 20,
                height: 20,
                marginTop: 2,
                boxSizing: "border-box",
                borderRadius: 4,
                background: checked ? O.red : O.bg,
                border: checked ? "none" : `1px solid ${O.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.18s ease, border-color 0.18s ease",
              }}
            >
              {checked ? <OIcon name="check" size={14} color="#FFFFFF" stroke={2.5} /> : null}
            </span>
            <span style={{ fontSize: 14, lineHeight: "22.75px", color: O.text }}>
              Я прочитал(а) и принимаю
              <br />
              <button type="button" style={link} onClick={(e) => { e.preventDefault(); void openDoc("offer"); }}>договор оферты</button>
              {" и "}
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
