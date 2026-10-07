import React, { useCallback, useEffect, useMemo, useState } from "react";
import { btnReset } from "../components/ui";
import { N, NoirButton, NoirField, NoirLoading, NoirScreen } from "../components/noir";
import { BRAND_NAME } from "../utils/brand";
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

type Step = "email" | "code";

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
        const res = await fetch("/api/app/config");
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

  if (oauthBusy) return <NoirLoading text="Входим через Telegram…" />;

  const link = (color: string): React.CSSProperties => ({
    ...btnReset,
    background: "none",
    border: "none",
    color,
    fontSize: 15,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: N.font,
    padding: 0,
  });

  return (
    <NoirScreen dim={0.45}>
      <div style={{ paddingTop: 44, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <img src="/assets/home-logo.png" alt="" style={{ width: 120, height: "auto", display: "block" }} />
        <div style={{ marginTop: 10, fontSize: 15, fontWeight: 500, letterSpacing: "0.22em", color: N.text }}>{BRAND_NAME}</div>
      </div>

      <div style={{ marginTop: 36, fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.15, color: N.text }}>
        {step === "email" ? "Вход" : "Введите код"}
      </div>
      <div style={{ marginTop: 8, color: N.muted, fontSize: 15.5, lineHeight: 1.5 }}>
        {step === "email" ? "Пришлём код на почту" : `Код отправлен на ${email.trim()}`}
      </div>

      <div style={{ marginTop: 24 }}>
        {step === "email" ? (
          <>
            <NoirField
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@mail.com"
              value={email}
              autoFocus
              onChange={setEmail}
              onKeyDown={(e) => e.key === "Enter" && void sendCode()}
            />
            <CaptchaBox cfg={captcha} onToken={setCaptchaToken} resetKey={captchaReset} />
            <div style={{ marginTop: 12 }}>
              <NoirButton primary disabled={!validEmail || busy || !captchaOk} onClick={() => void sendCode()}>
                {busy ? "Отправляем…" : "Получить код"}
              </NoirButton>
            </div>
          </>
        ) : (
          <>
            <NoirField
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="······"
              value={code}
              autoFocus
              maxLength={6}
              onChange={(v) => setCode(v.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && void confirmCode()}
              style={{ letterSpacing: 10, textAlign: "center", fontSize: 24, fontWeight: 500 }}
            />
            <CaptchaBox cfg={captcha} onToken={setCaptchaToken} resetKey={captchaReset} />
            <div style={{ marginTop: 12 }}>
              <NoirButton primary disabled={code.trim().length < 4 || busy || !captchaOk} onClick={() => void confirmCode()}>
                {busy ? "Проверяем…" : "Войти"}
              </NoirButton>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
              <button
                type="button"
                style={link(N.text)}
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
              <button type="button" disabled={resendIn > 0} style={link(resendIn > 0 ? N.dim : N.text)} onClick={() => void sendCode()}>
                {resendIn > 0 ? `Повторить через ${resendIn}с` : "Отправить снова"}
              </button>
            </div>
          </>
        )}
      </div>

      {info && <div style={{ marginTop: 16, color: "#2FD39A", fontSize: 14 }}>{info}</div>}
      {error && <div style={{ marginTop: 16, color: "#FF6B6B", fontSize: 14 }}>{error}</div>}

      {botUsername && step === "email" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "28px 0 20px" }}>
            <div style={{ flex: 1, height: 1, background: N.divider }} />
            <span style={{ fontSize: 14, color: N.dim }}>или</span>
            <div style={{ flex: 1, height: 1, background: N.divider }} />
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <TelegramLoginWidget botUsername={botUsername} onAuth={(u) => void finishOauth(u)} />
          </div>
        </>
      ) : null}
    </NoirScreen>
  );
}
