// FGN: вход по почте (переопределение src/app/pages/Authentication.tsx).
// Логика та же (код на почту, капча, вход через Telegram), дизайн FGN: сетка с частицами,
// белый круг со щитом, «FGN» в разрядку, поля 52, светлая кнопка 52.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { btnReset } from "../components/ui";
import { BRAND_NAME, PROJECT_ID } from "../utils/brand";
import { CaptchaBox, type CaptchaPublic } from "../components/CaptchaBox";
import { TelegramLoginWidget } from "../components/TelegramLoginWidget";
import {
  appFetch,
  requestEmailCode,
  setAppToken,
  verifyEmailCode,
  getWebRef,
  type AppUser,
  type TelegramOAuthPayload,
} from "../utils/api";
import { C, FgnBackdrop, FgnPage, SHIELD_PATH, fgnButton, fgnInput } from "../components/fgn";

type Step = "email" | "code";

const TEXT = "#F4F4F5";
const MUTED = "#9B9BA4";
const GREEN = "#34D67C";
const DANGER = "#FF5D62";

export default function Authentication({ onAuthed }: { onAuthed: () => void }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [botUsername, setBotUsername] = useState("");
  const [oauthBusy, setOauthBusy] = useState(false);
  const [captcha, setCaptcha] = useState<CaptchaPublic | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);

  const validEmail = useMemo(() => /\S+@\S+\.\S+/.test(email.trim()), [email]);
  const needCaptcha = Boolean(captcha?.enabled && captcha.siteKey);
  const captchaOk = !needCaptcha || Boolean(captchaToken);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/app/config", { headers: { "X-Project": PROJECT_ID } });
        const body = (await res.json().catch(() => null)) as {
          botUsername?: string;
          captcha?: CaptchaPublic;
        } | null;
        if (!res.ok || !body) return;
        if (typeof body.botUsername === "string" && body.botUsername.trim()) {
          setBotUsername(body.botUsername.trim().replace(/^@/, ""));
        }
        if (body.captcha && typeof body.captcha === "object") {
          setCaptcha(body.captcha);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const bumpCaptcha = () => {
    setCaptchaToken("");
    setCaptchaReset((n) => n + 1);
  };

  const finishOauth = useCallback(
    async (payload: TelegramOAuthPayload) => {
      // Telegram Login Widget уже подписан — капча не нужна
      setOauthBusy(true);
      setError("");
      try {
        const clean: Record<string, string | number> = { id: payload.id, hash: payload.hash };
        if (payload.first_name) clean.first_name = payload.first_name;
        if (payload.last_name) clean.last_name = payload.last_name;
        if (payload.username) clean.username = payload.username;
        if (payload.photo_url) clean.photo_url = payload.photo_url;
        if (payload.auth_date != null && payload.auth_date !== "") clean.auth_date = payload.auth_date;

        const ref = getWebRef();
        const b = await appFetch<{ user?: AppUser; token?: string }>("/auth/oauth", {
          method: "POST",
          body: JSON.stringify(ref ? { ...clean, ref } : clean),
        });
        if (b.token) setAppToken(b.token);
        onAuthed();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось войти через Telegram");
        setOauthBusy(false);
      }
    },
    [onAuthed],
  );

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const sendCode = useCallback(async () => {
    if (busy || !validEmail) return;
    if (needCaptcha && !captchaToken) {
      setError("Пройдите проверку «я не робот»");
      return;
    }
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const r = await requestEmailCode(email.trim(), captchaToken || undefined);
      setStep("code");
      setResendIn(r.resend_after || 60);
      setInfo(
        r.dev_code
          ? `Код (демо-режим): ${r.dev_code}`
          : "Мы отправили код на вашу почту. Проверьте входящие.",
      );
      bumpCaptcha();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить код");
      bumpCaptcha();
    } finally {
      setBusy(false);
    }
  }, [busy, email, validEmail, needCaptcha, captchaToken]);

  const confirmCode = useCallback(async () => {
    if (busy || code.trim().length < 4) return;
    if (needCaptcha && !captchaToken) {
      setError("Пройдите проверку «я не робот»");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await verifyEmailCode(email.trim(), code.trim(), captchaToken || undefined);
      onAuthed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неверный код");
      bumpCaptcha();
    } finally {
      setBusy(false);
    }
  }, [busy, code, email, onAuthed, needCaptcha, captchaToken]);

  const link = (color: string): React.CSSProperties => ({
    ...btnReset,
    background: "none",
    border: "none",
    color,
    fontSize: 15,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: C.font,
    padding: 0,
  });

  if (oauthBusy) {
    return (
      <FgnPage>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: MUTED }}>
          Входим через Telegram…
        </div>
      </FgnPage>
    );
  }

  return (
    <FgnPage>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div
          style={{
            width: 80,
            height: 80,
            flexShrink: 0,
            borderRadius: "50%",
            background: C.btnSoft,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "fgnRise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
          }}
        >
          <svg viewBox="0 0 100 100" width="46%" aria-hidden style={{ display: "block" }}>
            <path d={SHIELD_PATH} fill="#0E0E0F" />
          </svg>
        </div>
        <div style={{ marginTop: 14, fontSize: 15, fontWeight: 500, letterSpacing: "0.32em", color: TEXT, textIndent: "0.32em" }}>
          {BRAND_NAME.toUpperCase()}
        </div>
      </div>

      <div style={{ marginTop: 32, flexShrink: 0, fontSize: 28, fontWeight: 600, lineHeight: "34px", letterSpacing: "-0.02em", color: TEXT }}>
        {step === "email" ? "Вход" : "Введите код"}
      </div>
      <div style={{ marginTop: 8, flexShrink: 0, fontSize: 14.5, lineHeight: "20px", color: MUTED }}>
        {step === "email" ? "Пришлём код на почту" : `Код отправлен на ${email.trim()}`}
      </div>

      <div style={{ marginTop: 24, flexShrink: 0 }}>
        {step === "email" ? (
          <>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@mail.com"
              value={email}
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void sendCode(); }}
              style={fgnInput}
            />
            <CaptchaBox cfg={captcha} onToken={setCaptchaToken} resetKey={captchaReset} />
            <button
              type="button"
              className="blin-press"
              disabled={!validEmail || busy || !captchaOk}
              onClick={() => void sendCode()}
              style={{ ...fgnButton, marginTop: 12, opacity: !validEmail || busy || !captchaOk ? 0.45 : 1 }}
            >
              {busy ? "Отправляем…" : "Получить код"}
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="······"
              value={code}
              autoFocus
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter") void confirmCode(); }}
              style={{ ...fgnInput, height: 56, letterSpacing: 10, textAlign: "center", fontSize: 22, fontWeight: 500 }}
            />
            <CaptchaBox cfg={captcha} onToken={setCaptchaToken} resetKey={captchaReset} />
            <button
              type="button"
              className="blin-press"
              disabled={code.trim().length < 4 || busy || !captchaOk}
              onClick={() => void confirmCode()}
              style={{ ...fgnButton, marginTop: 12, opacity: code.trim().length < 4 || busy || !captchaOk ? 0.45 : 1 }}
            >
              {busy ? "Проверяем…" : "Войти"}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
              <button
                type="button"
                style={link(TEXT)}
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError("");
                  setInfo("");
                  bumpCaptcha();
                }}
              >
                Изменить почту
              </button>
              <button
                type="button"
                disabled={resendIn > 0}
                style={link(resendIn > 0 ? "rgba(196, 196, 206, 0.5)" : TEXT)}
                onClick={() => void sendCode()}
              >
                {resendIn > 0 ? `Повторить через ${resendIn}с` : "Отправить снова"}
              </button>
            </div>
          </>
        )}
      </div>

      {info ? <div style={{ marginTop: 16, flexShrink: 0, color: GREEN, fontSize: 14, lineHeight: "20px" }}>{info}</div> : null}
      {error ? <div style={{ marginTop: 16, flexShrink: 0, color: DANGER, fontSize: 14, lineHeight: "20px" }}>{error}</div> : null}

      {botUsername && step === "email" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "28px 0 20px", flexShrink: 0 }}>
            <div style={{ flex: 1, height: 1, background: "rgba(255, 255, 255, 0.1)" }} />
            <span style={{ fontSize: 14, color: MUTED }}>или</span>
            <div style={{ flex: 1, height: 1, background: "rgba(255, 255, 255, 0.1)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "center", flexShrink: 0 }}>
            <TelegramLoginWidget botUsername={botUsername} onAuth={(u) => void finishOauth(u)} />
          </div>
        </>
      ) : null}
    </FgnPage>
  );
}