// FGN: стартовый экран (переопределение src/app/components/EnterScreen.tsx).
// Логика та же (касание → оферта / вход), дизайн свой: сетка, светящиеся частицы и листья,
// белая сфера со щитом «Нажмите на щит». Видео не используется — всё рисуется кодом.
import React, { useEffect, useState } from "react";
import { markEntered } from "../utils/homeIntro";
import { BRAND_NAME } from "../utils/brand";
import { useTgBack } from "./noir";
import { acceptTerms, fetchLegal } from "../utils/api";
import { MSIcon } from "./ui";
import { RichText } from "./RichText";
import { C, FgnBackdrop, SHIELD_PATH } from "./fgn";

// сколько длится растворение экрана после касания
const LEAVE_MS = 520;
// нажатие на сферу: сжатие + волна, потом уходим
const PRESS_MS = 260;

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
    if (kind === "impact") hf?.impactOccurred?.("medium");
    else hf?.notificationOccurred?.("success");
  } catch { /* ignore */ }
}

const KEYFRAMES = `
@keyframes fgnSphereIn {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.86); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@keyframes fgnTitleIn { from { opacity: 0; letter-spacing: 0.6em; } to { opacity: 1; letter-spacing: 0.32em; } }
@keyframes fgnBreath { 0%, 100% { transform: scale(1); opacity: 0.55; } 50% { transform: scale(1.035); opacity: 1; } }
@keyframes fgnWave { from { transform: scale(1); opacity: 0.55; } to { transform: scale(1.55); opacity: 0; } }
@keyframes fgnCursor { 0%, 70%, 100% { transform: translate(0, 0); } 80% { transform: translate(-3px, -3px) scale(0.92); } }
@keyframes fgnHint { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@keyframes fgnRise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .fgn-anim { animation: none !important; }
}
`;

function ShieldCursor({ compact }: { compact: boolean }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width="42%"
      aria-hidden
      style={{
        display: "block",
        overflow: "visible",
        // в маленьком круге приветствия щит крупнее (по макету ~45% круга)
        transform: compact ? "scale(1.75)" : "none",
        transition: "transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <path
        d={SHIELD_PATH}
        fill="#0E0E0F"
      />
      <g style={{ opacity: compact ? 0 : 1, transition: "opacity 0.3s ease" }}>
        <g className="fgn-anim" style={{ animation: "fgnCursor 3.2s ease-in-out 1.4s infinite", transformOrigin: "62px 66px" }}>
          <path
            d="M61 60v27l6.6-6.4 4.8 10.6 4.6-2-4.7-10.4h9.4Z"
            fill="#FFFFFF"
            stroke="#0E0E0F"
            strokeWidth={2.2}
            strokeLinejoin="round"
            style={{ filter: "drop-shadow(3px 4px 2.5px rgba(0,0,0,0.45))" }}
          />
        </g>
      </g>
    </svg>
  );
}

// размер сферы: min(78vw, 42vh, 340px) — в JS, чтобы посчитать масштаб маленького круга
function sphereSize(): number {
  if (typeof window === "undefined") return 300;
  return Math.min(window.innerWidth * 0.78, window.innerHeight * 0.42, 340);
}
// диаметр белого круга на экране приветствия
const SMALL_CIRCLE = 80;
// центр сферы: на первом экране и на приветствии (доля высоты)
const SPHERE_Y = 0.506;
const SMALL_Y = 0.17;

/**
 * Стартовый экран FGN: «Нажмите на щит».
 * Касание → если оферта не принята, сфера сжимается в круг наверху и появляется приветствие;
 * иначе экран растворяется и открывается главная.
 */
export default function EnterScreen({ terms, onAccepted }: { terms: EnterTerms; onAccepted: () => void }) {
  const [phase, setPhase] = useState<Phase>("tap");
  const [tapped, setTapped] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [welcomeShown, setWelcomeShown] = useState(false);
  const [size, setSize] = useState(sphereSize);
  useEffect(() => { if (phase === "terms") setWelcomeShown(true); }, [phase]);
  useEffect(() => {
    const on = () => setSize(sphereSize());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const leave = () => {
    setPhase("leaving");
    markEntered();
    window.setTimeout(() => setPhase("gone"), LEAVE_MS);
  };

  // после касания (и короткой анимации нажатия) решаем, куда дальше
  useEffect(() => {
    if (!tapped || pressed || phase !== "tap") return;
    if (terms === "need") setPhase("terms");
    else if (terms === "ok" || terms === "anon") leave();
  }, [tapped, pressed, terms, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // вошёл через email/telegram-логин уже после экрана входа, а оферта не принята → приветствие снова
  useEffect(() => {
    if (phase === "gone" && terms === "need") setPhase("terms");
  }, [phase, terms]);

  const onTap = () => {
    if (phase !== "tap" || tapped) return;
    haptic("impact");
    setTapped(true);
    setPressed(true);
    window.setTimeout(() => setPressed(false), PRESS_MS);
  };

  if (phase === "gone") return null;

  const leaving = phase === "leaving";
  const showTerms = phase === "terms" || (leaving && welcomeShown);
  // на приветствии: белый круг (87% сферы) → SMALL_CIRCLE px, центр на SMALL_Y высоты
  const smallScale = SMALL_CIRCLE / (size * 0.87);
  const sphereShift = showTerms ? `translateY(${(SMALL_Y - SPHERE_Y) * 100}vh) scale(${smallScale})` : "none";

  return (
    <div
      role="dialog"
      aria-label={phase === "tap" ? "Нажмите на щит, чтобы войти" : "Добро пожаловать"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        overflow: "hidden",
        background: C.bg,
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
        opacity: leaving ? 0 : 1,
        transform: leaving ? "scale(1.04)" : "scale(1)",
        transition: `opacity ${LEAVE_MS}ms cubic-bezier(0.33, 1, 0.32, 1), transform ${LEAVE_MS}ms cubic-bezier(0.33, 1, 0.32, 1)`,
        pointerEvents: leaving ? "none" : "auto",
        fontFamily: C.font,
      }}
    >
      <style>{KEYFRAMES}</style>

      <FgnBackdrop />

      {/* FGN — уходит вверх и гаснет на приветствии */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "23.7%",
          transform: showTerms ? "translateY(-50%) translateY(-40px)" : "translateY(-50%)",
          opacity: showTerms ? 0 : 1,
          transition: "transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease",
          pointerEvents: "none",
        }}
      >
        <div
          className="fgn-anim"
          style={{
            textAlign: "center",
            paddingLeft: "0.32em",
            fontSize: "clamp(40px, 12.3vw, 56px)",
            fontWeight: 400,
            letterSpacing: "0.32em",
            color: C.text,
            lineHeight: 1,
            animation: "fgnTitleIn 1s cubic-bezier(0.22, 1, 0.36, 1) both",
          }}
        >
          {BRAND_NAME}
        </div>
      </div>

      {/* сфера со щитом */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: `${SPHERE_Y * 100}%`,
          width: size,
          height: size,
          transform: "translate(-50%, -50%)",
          animation: "fgnSphereIn 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both",
        }}
        className="fgn-anim"
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: sphereShift,
            transition: "transform 0.75s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {/* кольцо и тёмная подложка — только на первом экране */}
          <div style={{ position: "absolute", inset: 0, opacity: showTerms ? 0 : 1, transition: "opacity 0.35s ease" }}>
            <div
              aria-hidden
              className="fgn-anim"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: "1px solid rgba(255,255,255,0.16)",
                animation: "fgnBreath 3.6s ease-in-out infinite",
              }}
            />
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: "3%",
                borderRadius: "50%",
                background: "radial-gradient(circle at 50% 45%, #1C1C1E 0%, #141415 70%, #0F0F10 100%)",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.05), 0 20px 60px rgba(0,0,0,0.6)",
              }}
            />
          </div>
          {/* волна при нажатии */}
          {tapped ? (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: "6%",
                borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.7)",
                animation: "fgnWave 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
              }}
            />
          ) : null}
          <button
            type="button"
            aria-label="Нажмите на щит, чтобы войти"
            disabled={phase !== "tap"}
            onPointerDown={onTap}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onTap(); }}
            style={{
              position: "absolute",
              inset: "6.5%",
              borderRadius: "50%",
              border: "none",
              padding: 0,
              cursor: phase === "tap" ? "pointer" : "default",
              // на приветствии — ровный белый круг без объёма
              background: showTerms
                ? "#F2F2F3"
                : "radial-gradient(circle at 42% 30%, #FFFFFF 0%, #F3F3F4 30%, #DCDCDF 72%, #C9C9CD 100%)",
              boxShadow: showTerms
                ? "none"
                : "inset 0 -10px 24px rgba(0,0,0,0.12), inset 0 8px 18px rgba(255,255,255,0.9), 0 0 40px rgba(255,255,255,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: pressed ? "scale(0.94)" : "scale(1)",
              transition: "transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.5s ease, box-shadow 0.5s ease",
              outline: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <ShieldCursor compact={showTerms} />
          </button>
        </div>
      </div>

      {/* «Нажмите на щит» */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "77.6%",
          transform: phase === "tap" ? "translateY(-50%)" : "translateY(-50%) translateY(10px)",
          textAlign: "center",
          fontSize: 15.5,
          fontWeight: 400,
          letterSpacing: "0.01em",
          color: C.hint,
          opacity: phase === "tap" && !tapped ? 1 : 0,
          transition: "opacity 0.35s ease, transform 0.35s ease",
          pointerEvents: "none",
        }}
      >
        <span className="fgn-anim" style={{ display: "inline-block", animation: "fgnHint 2.6s ease-in-out 1.6s infinite" }}>
          Нажмите на щит
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
    animation: `fgnRise 0.75s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s both`,
  });

  const link: React.CSSProperties = {
    appearance: "none",
    background: "transparent",
    border: "none",
    padding: 0,
    margin: 0,
    font: "inherit",
    color: C.text,
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
      {/* заголовок — под маленьким кругом со щитом */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `calc(${SMALL_Y * 100}% + ${SMALL_CIRCLE / 2 + 30}px)`,
          padding: "0 24px",
          boxSizing: "border-box",
          maxWidth: 520,
          margin: "0 auto",
          textAlign: "center",
          userSelect: "text",
          WebkitUserSelect: "text",
        }}
      >
        <div style={{ ...rise(0.2), fontSize: 36, fontWeight: 600, lineHeight: 1.15, letterSpacing: "-0.03em", color: C.text, marginBottom: 14 }}>
          Добро пожаловать!
        </div>
        <div style={{ ...rise(0.3), fontSize: 15.5, lineHeight: 1.47, color: C.muted, letterSpacing: "-0.005em" }}>
          Перед входом нужно подтвердить политику конфиденциальности и оферту. Без этого приложение не откроется.
        </div>
      </div>

      {/* галочка + «Продолжить» — внизу */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "0 20px",
          paddingBottom: "calc(32px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
          boxSizing: "border-box",
          maxWidth: 520,
          margin: "0 auto",
          userSelect: "text",
          WebkitUserSelect: "text",
        }}
      >
        <label
          style={{
            ...rise(0.38),
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
            background: C.cardBg,
            border: `1px solid ${C.cardBorder}`,
            borderRadius: 26,
            padding: "18px 18px 18px 17px",
            boxSizing: "border-box",
            cursor: "pointer",
            marginBottom: 12,
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
              width: 24,
              height: 24,
              borderRadius: 7,
              boxSizing: "border-box",
              background: checked ? C.btn : "#0C0C0D",
              border: `1px solid ${checked ? C.btn : "rgba(255,255,255,0.16)"}`,
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
                fontSize: 18,
                color: C.btnText,
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
            ...rise(0.46),
            appearance: "none",
            width: "100%",
            height: 52,
            border: "none",
            borderRadius: 24,
            background: enabled ? C.btn : C.btnOff,
            color: C.btnText,
            fontFamily: C.font,
            fontSize: 16.5,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            cursor: enabled ? "pointer" : "default",
            transition: "background 0.25s ease, box-shadow 0.25s ease",
            boxShadow: enabled ? "0 10px 30px -10px rgba(255, 255, 255, 0.35)" : "none",
          }}
        >
          {busy ? "Сохраняем…" : "Продолжить"}
        </button>
        {err ? <div style={{ fontSize: 13, color: "#FF6B6B", marginTop: 10, textAlign: "center" }}>{err}</div> : null}
      </div>

      {doc ? <DocSheet title={DOC_TITLE[doc]} text={docs ? docs[doc] : null} onClose={() => setDoc(null)} /> : null}
    </>
  );
}

// документ поверх экрана входа
function DocSheet({ title, text, onClose }: { title: string; text: string | null; onClose: () => void }) {
  useTgBack(onClose);
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 2,
        background: "rgba(4, 4, 6, 0.6)",
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
          background: "#0F0F10",
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
