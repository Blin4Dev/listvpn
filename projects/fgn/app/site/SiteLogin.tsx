// FGN: сайт → «Вход в FGN» (/login). Почта (код + капча) или Telegram.
// Telegram — своя синяя кнопка: telegram-widget.js → Telegram.Login.auth({ bot_id }) (окно oauth.telegram.org),
// bot_id = /api/app/config → telegramOauthBotId. Домен сайта должен быть указан у бота в BotFather (/setdomain).
// Вход = регистрация (как в мини-аппе); ?ref= подхватывается getWebRef().
import React, { useEffect, useMemo, useState } from "react";
import { CaptchaBox, type CaptchaPublic } from "../components/CaptchaBox";
import { appFetch, getWebRef, requestEmailCode, setAppToken, verifyEmailCode, type AppUser, type TelegramOAuthPayload } from "../utils/api";
import { C } from "../components/fgn";

export const LOGIN_CSS = `
.fs-login { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center;
  min-height: calc(100vh - 69px - 118px); padding: 56px 24px; }
.fs-lcard { width: 100%; max-width: 646px; padding: 44px 42px 42px; border-radius: 22px; text-align: center;
  background: #1A1B1D; border: 1px solid rgba(255,255,255,.07); box-shadow: 0 30px 80px rgba(0,0,0,.45); animation: fsFade .35s ease both; }
.fs-lcard h1 { margin: 0; font-size: 40px; line-height: 1.15; font-weight: 800; letter-spacing: -.015em; }
.fs-lcard .sub { margin: 16px auto 0; max-width: 500px; font-size: 15.5px; line-height: 1.6; color: rgba(196,196,206,.72); }
.fs-lbtn { width: 100%; height: 56px; margin-top: 30px; display: flex; align-items: center; justify-content: center; gap: 14px;
  border-radius: 12px; border: 0; font: 600 17px ${C.font}; cursor: pointer; transition: filter .15s, opacity .15s; }
.fs-lbtn:hover:not(:disabled) { filter: brightness(1.06); }
.fs-lbtn:disabled { opacity: .45; cursor: default; }
.fs-lbtn.light { background: #FDFDF8; color: #0A0A0A; }
.fs-lbtn.tg { margin-top: 0; background: #2AA8EC; color: #fff; }
.fs-lor { margin: 22px 0; font-size: 14px; color: rgba(196,196,206,.6); }
.fs-linput { width: 100%; height: 56px; margin-top: 30px; padding: 0 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,.1);
  background: #111214; color: #fff; font: 500 16px ${C.font}; outline: none; text-align: center; }
.fs-linput:focus { border-color: rgba(255,255,255,.26); }
.fs-linput::placeholder { color: rgba(196,196,206,.45); }
.fs-linput.code { letter-spacing: 12px; font-size: 24px; text-indent: 12px; }
.fs-linfo, .fs-lerr { margin-top: 16px; font-size: 14px; line-height: 20px; }
.fs-linfo { color: ${C.green}; }
.fs-lerr { color: #FF5D62; }
.fs-lcard.form { text-align: left; padding: 40px 42px 42px; }
.fs-lback { display: inline-flex; align-items: center; gap: 8px; margin: 0 0 30px; padding: 0; background: none; border: 0;
  font: 500 16px ${C.font}; color: rgba(196,196,206,.72); cursor: pointer; }
.fs-lback:hover { color: #fff; }
.fs-lcard.form .sub { margin: 18px 0 0; max-width: none; font-size: 17px; }
.fs-llabel { display: block; margin: 34px 0 12px; font-size: 16px; font-weight: 500; color: rgba(236,236,240,.92); }
.fs-lcard.form .fs-linput { margin-top: 0; height: 66px; border-radius: 14px; text-align: left; font-size: 17px; }
.fs-lcard.form .fs-lbtn.light { height: 76px; margin-top: 26px; border-radius: 14px; font-size: 18px; font-weight: 700; }
.fs-otp { position: relative; display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
.fs-otp input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; border: 0; padding: 0;
  font-size: 16px; color: transparent; background: transparent; caret-color: transparent; cursor: text; }
.fs-otp .cell { height: 72px; display: flex; align-items: center; justify-content: center; border-radius: 12px;
  background: #111214; border: 1px solid rgba(255,255,255,.1); font: 700 30px ${C.font}; color: #fff; transition: border-color .15s; }
.fs-otp.focus .cell.cur { border-color: rgba(255,255,255,.42); }
.fs-otp.bad .cell { border-color: rgba(255,93,98,.55); }
.fs-lresend { display: block; margin: 34px auto 0; padding: 0; background: none; border: 0; font: 500 16px ${C.font};
  color: #fff; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.fs-lresend:disabled { color: rgba(196,196,206,.55); text-decoration: none; cursor: default; }
@media (max-width: 860px) {
  .fs-lcard.form { padding: 26px 18px 22px; }
  .fs-lback { margin-bottom: 22px; font-size: 15px; }
  .fs-lcard.form .sub { font-size: 15px; margin-top: 12px; }
  .fs-llabel { margin: 26px 0 10px; font-size: 15px; }
  .fs-lcard.form .fs-linput { height: 56px; }
  .fs-lcard.form .fs-lbtn.light { height: 58px; margin-top: 20px; font-size: 17px; }
  .fs-otp { gap: 8px; }
  .fs-otp .cell { height: 58px; font-size: 24px; border-radius: 11px; }
  .fs-lresend { margin-top: 24px; font-size: 15px; }
}
@media (max-width: 860px) {
  .fs-login { padding: 40px 18px 56px; min-height: calc(100vh - 69px - 230px); align-items: flex-start; }
  .fs-lcard { padding: 34px 18px 18px; border-radius: 20px; }
  .fs-lcard h1 { font-size: 30px; }
  .fs-lcard .sub { margin-top: 14px; font-size: 14.5px; }
  .fs-lbtn { height: 54px; font-size: 16px; margin-top: 26px; }
  .fs-lor { margin: 18px 0; }
}
`;

type TgLogin = { auth: (opts: Record<string, unknown>, cb: (user: TelegramOAuthPayload | false) => void) => void };
const tgLogin = (): TgLogin | undefined => (window as unknown as { Telegram?: { Login?: TgLogin } }).Telegram?.Login;

const TG_SRC = "https://telegram.org/js/telegram-widget.js?22";
let tgLoad: Promise<TgLogin> | null = null;

function loadTgLogin(): Promise<TgLogin> {
  const ready = tgLogin();
  if (ready) return Promise.resolve(ready);
  if (!tgLoad) {
    tgLoad = new Promise<TgLogin>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = TG_SRC;
      s.async = true;
      s.onload = () => {
        const tg = tgLogin();
        if (tg) resolve(tg);
        else reject(new Error("no Telegram.Login"));
      };
      s.onerror = () => reject(new Error("load"));
      document.head.appendChild(s);
    }).catch((e) => {
      tgLoad = null;
      throw e;
    });
  }
  return tgLoad;
}

function MailIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  );
}

// фирменный самолётик Telegram (без круга)
function TgIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21.6 3.4c.5-.2 1 .2.9.8l-3.1 15.1c-.1.6-.8.8-1.3.5l-4.6-3.4-2.3 2.2c-.3.3-.8.1-.8-.3l.2-3.4 7.1-6.4c.3-.3-.1-.5-.4-.3l-8.8 5.5-3.8-1.2c-.6-.2-.6-1 0-1.2z" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 5-7 7 7 7" />
    </svg>
  );
}

const CODE_LEN = 6;

// 6 ячеек; ввод — одним прозрачным полем поверх (вставка, автозаполнение one-time-code)
function OtpInput({ value, onChange, onEnter, bad }: { value: string; onChange: (v: string) => void; onEnter: () => void; bad: boolean }) {
  const [focus, setFocus] = useState(true);
  const cur = Math.min(value.length, CODE_LEN - 1);
  return (
    <div className={`fs-otp${focus ? " focus" : ""}${bad ? " bad" : ""}`}>
      {Array.from({ length: CODE_LEN }, (_, i) => (
        <div key={i} className={`cell${i === cur ? " cur" : ""}`}>
          {value[i] || ""}
        </div>
      ))}
      <input
        id="fs-lcode"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="Код из письма"
        value={value}
        autoFocus
        maxLength={CODE_LEN}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, CODE_LEN))}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter();
        }}
      />
    </div>
  );
}

type Step = "start" | "email" | "code";

type Props = {
  botId: string;
  captcha: CaptchaPublic | null;
  onAuthed: () => void;
};

export default function SiteLogin({ botId, captcha, onAuthed }: Props) {
  const [step, setStep] = useState<Step>("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);

  const validEmail = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()), [email]);
  const needCaptcha = Boolean(captcha?.enabled && captcha.siteKey);
  const captchaOk = !needCaptcha || Boolean(captchaToken);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  // скрипт Telegram — заранее, чтобы окно открылось сразу по клику (иначе блокировщик всплывающих окон)
  useEffect(() => {
    if (botId) void loadTgLogin().catch(() => {});
  }, [botId]);

  const bumpCaptcha = () => {
    setCaptchaToken("");
    setCaptchaReset((n) => n + 1);
  };

  const sendCode = async () => {
    if (busy || !validEmail) return;
    if (!captchaOk) {
      setError("Пройдите проверку «я не робот»");
      return;
    }
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const r = await requestEmailCode(email.trim(), captchaToken || undefined);
      setStep("code");
      setCode("");
      setResendIn(r.resend_after || 60);
      setInfo(r.dev_code ? `Код (демо-режим): ${r.dev_code}` : "");
    } catch (e) {
      setError((e as Error)?.message || "Не удалось отправить код");
    } finally {
      bumpCaptcha();
      setBusy(false);
    }
  };

  const confirm = async (c = code) => {
    if (busy || c.trim().length < CODE_LEN) return;
    if (!captchaOk) {
      setError("Пройдите проверку «я не робот»");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await verifyEmailCode(email.trim(), c.trim(), captchaToken || undefined);
      onAuthed();
    } catch (e) {
      setError((e as Error)?.message || "Неверный код");
      bumpCaptcha();
      setBusy(false);
    }
  };

  const finishTg = async (u: TelegramOAuthPayload) => {
    setTgBusy(true);
    setError("");
    try {
      const clean: Record<string, string | number> = { id: u.id, hash: u.hash };
      if (u.first_name) clean.first_name = u.first_name;
      if (u.last_name) clean.last_name = u.last_name;
      if (u.username) clean.username = u.username;
      if (u.photo_url) clean.photo_url = u.photo_url;
      if (u.auth_date != null && u.auth_date !== "") clean.auth_date = u.auth_date;
      const ref = getWebRef();
      const b = await appFetch<{ user?: AppUser; token?: string }>("/auth/oauth", {
        method: "POST",
        body: JSON.stringify(ref ? { ...clean, ref } : clean),
      });
      if (b.token) setAppToken(b.token);
      onAuthed();
    } catch (e) {
      setError((e as Error)?.message || "Не удалось войти через Telegram");
      setTgBusy(false);
    }
  };

  const loginTg = () => {
    if (!botId) {
      setError("Вход через Telegram пока недоступен — войдите через почту");
      return;
    }
    setError("");
    const open = (tg: TgLogin) =>
      tg.auth({ bot_id: botId, request_access: "write", lang: "ru" }, (user) => {
        if (user && user.id && user.hash) void finishTg(user);
      });
    const ready = tgLogin();
    if (ready) open(ready);
    else
      loadTgLogin()
        .then(open)
        .catch(() => setError("Не удалось загрузить вход через Telegram. Проверьте соединение"));
  };

  const back = () => {
    setStep(step === "code" ? "email" : "start");
    setCode("");
    setError("");
    setInfo("");
    bumpCaptcha();
  };

  return (
    <section className="fs-login">
      <div className={`fs-lcard${step === "start" ? "" : " form"}`}>
        {step === "start" ? (
          <>
            <h1>Вход в FGN</h1>
            <p className="sub">Войдите через почту или Telegram. Без входа скачивание и оформление подписки недоступны.</p>
            <button type="button" className="fs-lbtn light" onClick={() => { setStep("email"); setError(""); }}>
              <MailIcon />
              Войти через почту
            </button>
            <div className="fs-lor">или</div>
            <button type="button" className="fs-lbtn tg" disabled={tgBusy} onClick={loginTg}>
              <TgIcon />
              {tgBusy ? "Входим…" : "Войти через Telegram"}
            </button>
          </>
        ) : step === "email" ? (
          <>
            <button type="button" className="fs-lback" onClick={back}>
              <BackIcon />
              Назад
            </button>
            <h1>Вход через почту</h1>
            <p className="sub">Укажите почту. Мы пришлём код для входа.</p>
            <label className="fs-llabel" htmlFor="fs-lemail">
              Почта
            </label>
            <input
              id="fs-lemail"
              className="fs-linput"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendCode();
              }}
            />
            <CaptchaBox cfg={captcha} onToken={setCaptchaToken} resetKey={captchaReset} />
            <button type="button" className="fs-lbtn light" disabled={!validEmail || busy || !captchaOk} onClick={() => void sendCode()}>
              {busy ? "Отправляем…" : "Войти"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="fs-lback" onClick={back}>
              <BackIcon />
              Назад
            </button>
            <h1>Введите код</h1>
            <p className="sub">
              Мы отправили код на {email.trim()}. Откройте почту и введите его. Если письма нет, загляните в спам.
            </p>
            <label className="fs-llabel" htmlFor="fs-lcode">
              Код из письма
            </label>
            <OtpInput
              value={code}
              bad={Boolean(error)}
              onChange={(v) => {
                setCode(v);
                if (error) setError("");
                if (v.length === CODE_LEN && captchaOk) void confirm(v);
              }}
              onEnter={() => void confirm()}
            />
            <CaptchaBox cfg={captcha} onToken={setCaptchaToken} resetKey={captchaReset} />
            <button type="button" className="fs-lbtn light" disabled={code.length < CODE_LEN || busy || !captchaOk} onClick={() => void confirm()}>
              {busy ? "Проверяем…" : "Войти"}
            </button>
            <button type="button" className="fs-lresend" disabled={resendIn > 0 || busy} onClick={() => void sendCode()}>
              {resendIn > 0 ? `Отправить код ещё раз через ${resendIn} с` : "Отправить код ещё раз"}
            </button>
          </>
        )}
        {info ? <div className="fs-linfo">{info}</div> : null}
        {error ? <div className="fs-lerr">{error}</div> : null}
      </div>
    </section>
  );
}
