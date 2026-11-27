import React, { useEffect, useRef, useState } from "react";
import { markEntered } from "../utils/homeIntro";
import { BRAND_NAME, hasFeature } from "../utils/brand";
import { useTgBack } from "./noir";
import { acceptTerms, fetchLegal } from "../utils/api";
import { MSIcon } from "./ui";
import { RichText } from "./RichText";

const VIDEO_MP4 = "/assets/intro.mp4";
// запасной вариант для webview без H.264 (напр. Telegram Desktop на Linux)
const VIDEO_WEBM = "/assets/intro.webm";
const POSTER_SRC = "/assets/intro-poster.jpg";
// features.intro_static в project.json: вместо видео — статичная картинка intro-poster.jpg проекта
const STATIC_INTRO = hasFeature("intro_static");
// сколько длится растворение экрана после касания
const LEAVE_MS = 520;


// палитра экрана входа (по макету)
const C = {
  font: "'Onest', 'Outfit', system-ui, sans-serif",
  text: "#FFFFFF",
  muted: "rgba(196, 196, 206, 0.78)",
  hint: "rgba(214, 214, 220, 0.72)",
  red: "#E3191F",
  redBtn: "#C8141A",
  redBtnOff: "#5A0B0D",
  cardBg: "rgba(18, 18, 24, 0.82)",
  cardBorder: "rgba(255, 255, 255, 0.13)",
};

/**
 * Статус оферты для экрана входа:
 * checking — ещё не знаем; need — показать приветствие; ok/anon — сразу внутрь.
 */
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

/**
 * Стартовый экран: видео на фоне (или статичная картинка — features.intro_static) + «Коснитесь, чтобы войти».
 * Касание → если оферта не принята, поверх видео выезжает приветствие;
 * иначе экран растворяется и открывается главная.
 */
export default function EnterScreen({ terms, onAccepted }: { terms: EnterTerms; onAccepted: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("tap");
  const [tapped, setTapped] = useState(false);
  // приветствие уже показывали → держим его на экране во время растворения
  const [welcomeShown, setWelcomeShown] = useState(false);
  useEffect(() => { if (phase === "terms") setWelcomeShown(true); }, [phase]);
  // подпись появляется, когда видео реально пошло (или через 1.2 с, если автоплей запрещён)
  const [hintOn, setHintOn] = useState(false);

  useEffect(() => {
    if (STATIC_INTRO) {
      const t = window.setTimeout(() => setHintOn(true), 500);
      return () => window.clearTimeout(t);
    }
    const v = videoRef.current;
    if (!v) return;
    // iOS / Telegram WebView: автоплей только muted + playsInline, выставляем явно
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    const p = v.play();
    if (p && typeof p.catch === "function") p.catch(() => { /* остаётся постер */ });
    const t = window.setTimeout(() => setHintOn(true), 1200);
    return () => window.clearTimeout(t);
  }, [phase === "gone"]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => {
    setPhase("leaving");
    markEntered();
    window.setTimeout(() => {
      videoRef.current?.pause();
      setPhase("gone");
    }, LEAVE_MS);
  };

  // после касания решаем, куда дальше, как только узнали статус оферты
  useEffect(() => {
    if (!tapped || phase !== "tap") return;
    if (terms === "need") setPhase("terms");
    else if (terms === "ok" || terms === "anon") leave();
  }, [tapped, terms, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // вошёл через email/telegram-логин уже после экрана входа, а оферта не принята → показать приветствие снова
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
        background: `#0B0D16 url(${POSTER_SRC}) center / cover no-repeat`,
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
        fontFamily: C.font,
      }}
    >
      {STATIC_INTRO ? null : <video
        ref={videoRef}
        poster={POSTER_SRC}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        onPlaying={() => setHintOn(true)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          pointerEvents: "none",
          display: "block",
        }}
      >
        <source src={VIDEO_MP4} type="video/mp4" />
        <source src={VIDEO_WEBM} type="video/webm" />
      </video>}

      {/* затемнение снизу: короткое под подписью, высокое под приветствием */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "34%",
          background: "linear-gradient(to top, rgba(6,7,12,0.78) 0%, rgba(6,7,12,0.35) 55%, transparent 100%)",
          opacity: showTerms ? 0 : 1,
          transition: "opacity 0.5s ease",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "62%",
          background:
            "linear-gradient(to top, rgba(4,4,8,0.98) 0%, rgba(4,4,8,0.9) 30%, rgba(4,4,8,0.55) 62%, rgba(4,4,8,0) 100%)",
          opacity: showTerms ? 1 : 0,
          transition: "opacity 0.7s cubic-bezier(0.33, 1, 0.32, 1)",
          pointerEvents: "none",
        }}
      />

      {/* «Коснитесь, чтобы войти» */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "calc(44px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
          textAlign: "center",
          fontSize: 15,
          fontWeight: 500,
          letterSpacing: "0.04em",
          color: C.hint,
          textShadow: "0 1px 10px rgba(0,0,0,0.6)",
          opacity: hintOn && phase === "tap" && !tapped ? 1 : 0,
          transform: phase === "tap" ? "none" : "translateY(10px)",
          transition: "opacity 0.35s ease, transform 0.35s ease",
          pointerEvents: "none",
        }}
      >
        <span style={{ display: "inline-block", animation: hintOn ? "blinvpnTapHint 2.6s ease-in-out 0.8s infinite" : undefined }}>
          Коснитесь, чтобы войти
        </span>
      </div>

      {showTerms ? (
        <WelcomeTerms
          onAccepted={() => {
            haptic("success");
            onAccepted();
            leave();
          }}
        />
      ) : null}
    </div>
  );
}

// ── приветствие + принятие оферты ──
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

  const rise = (delay: number): React.CSSProperties => ({
    animation: `blinvpnWelcomeRise 0.75s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s both`,
  });

  const link: React.CSSProperties = {
    appearance: "none",
    background: "transparent",
    border: "none",
    padding: 0,
    margin: 0,
    font: "inherit",
    color: C.red,
    textDecoration: "underline",
    textDecorationThickness: 1,
    textUnderlineOffset: 3,
    cursor: "pointer",
    display: "inline",
    textAlign: "left",
  };

  const enabled = checked && !busy;

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "0 20px",
          paddingBottom: "calc(24px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
          boxSizing: "border-box",
          maxWidth: 520,
          margin: "0 auto",
          userSelect: "text",
          WebkitUserSelect: "text",
        }}
      >
        <div
          style={{
            ...rise(0.05),
            fontSize: 33,
            fontWeight: 500,
            lineHeight: 1.15,
            letterSpacing: "-0.025em",
            color: C.text,
            marginBottom: 12,
          }}
        >
          Добро пожаловать!
        </div>
        <div
          style={{
            ...rise(0.14),
            fontSize: 15.5,
            fontWeight: 400,
            lineHeight: 1.45,
            color: C.muted,
            letterSpacing: "-0.005em",
            marginBottom: 24,
          }}
        >
          Перед началом прочитайте условия
          <br />
          использования {BRAND_NAME}.
        </div>

        <label
          style={{
            ...rise(0.23),
            display: "flex",
            gap: 16,
            alignItems: "flex-start",
            background: C.cardBg,
            border: `1px solid ${C.cardBorder}`,
            borderRadius: 22,
            padding: "20px 18px 20px 17px",
            boxSizing: "border-box",
            cursor: "pointer",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            marginBottom: 16,
          }}
        >
          <input
            type="checkbox"
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
              borderRadius: 3,
              background: checked ? C.redBtn : "#FFFFFF",
              border: `1px solid ${checked ? C.redBtn : "rgba(255,255,255,0.9)"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease",
              transform: checked ? "scale(1.04)" : "scale(1)",
            }}
          >
            <MSIcon
              name="check"
              style={{
                fontSize: 17,
                color: "#fff",
                fontWeight: 700,
                opacity: checked ? 1 : 0,
                transform: checked ? "scale(1)" : "scale(0.4)",
                transition: "opacity 0.15s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            />
          </span>
          <span style={{ fontSize: 15, lineHeight: 1.5, color: C.text, letterSpacing: "-0.01em" }}>
            Я прочитал(а) и принимаю
            <br />
            <button type="button" style={link} onClick={(e) => { e.preventDefault(); void openDoc("offer"); }}>
              договор оферты
            </button>{" "}
            и
            <br />
            <button type="button" style={link} onClick={(e) => { e.preventDefault(); void openDoc("privacy"); }}>
              политику конфиденциальности
            </button>
          </span>
        </label>

        <button
          type="button"
          disabled={!enabled}
          onClick={() => void accept()}
          className="blin-press"
          style={{
            ...rise(0.32),
            appearance: "none",
            width: "100%",
            height: 56,
            border: "none",
            borderRadius: 18,
            background: enabled ? C.redBtn : C.redBtnOff,
            color: enabled ? "#FFFFFF" : "rgba(170, 160, 160, 0.75)",
            fontFamily: C.font,
            fontSize: 16.5,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            cursor: enabled ? "pointer" : "default",
            transition: "background 0.25s ease, color 0.25s ease, box-shadow 0.25s ease",
            boxShadow: enabled ? "0 10px 30px -10px rgba(227, 25, 31, 0.6)" : "none",
          }}
        >
          {busy ? "Сохраняем…" : "Продолжить"}
        </button>
        {err ? (
          <div style={{ fontSize: 13, color: "#FF6B6B", marginTop: 10, textAlign: "center" }}>{err}</div>
        ) : null}
      </div>

      {doc ? (
        <DocSheet title={DOC_TITLE[doc]} text={docs ? docs[doc] : null} onClose={() => setDoc(null)} />
      ) : null}
    </>
  );
}

// документ поверх видео
function DocSheet({ title, text, onClose }: { title: string; text: string | null; onClose: () => void }) {
  useTgBack(onClose);
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 2,
        background: "rgba(4, 4, 8, 0.6)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-end",
        animation: "blinvpnFadeIn 0.2s ease both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxHeight: "82%",
          background: "#111117",
          borderTop: `1px solid ${C.cardBorder}`,
          borderRadius: "24px 24px 0 0",
          padding: "18px 20px",
          paddingBottom: "calc(16px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          animation: "blinvpnSheetUp 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
          userSelect: "text",
          WebkitUserSelect: "text",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 18, color: C.text }}>{title}</div>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            style={{
              appearance: "none",
              border: "none",
              width: 34,
              height: 34,
              borderRadius: 12,
              background: "rgba(255,255,255,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <MSIcon name="close" style={{ fontSize: 20, color: C.text }} />
          </button>
        </div>
        <div style={{ overflowY: "auto", flex: 1, paddingRight: 4 }}>
          {text !== null ? <RichText text={text} /> : <div style={{ fontSize: 14, color: C.muted }}>Загрузка…</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            appearance: "none",
            border: "none",
            marginTop: 14,
            height: 50,
            borderRadius: 16,
            background: "rgba(255,255,255,0.08)",
            color: C.text,
            fontFamily: C.font,
            fontSize: 15.5,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Понятно
        </button>
      </div>
    </div>
  );
}
