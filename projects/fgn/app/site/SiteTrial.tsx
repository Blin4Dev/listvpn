// FGN сайт: кнопка «Попробовать за 0 ₽» на главной — как «Попробовать бесплатно» в мини-аппе:
// без входа → /login?next=/?try=1 (после входа запускается сама); подписка уже есть → сразу установка;
// иначе принимаем оферту, активируем пробный (/trial) и открываем «Куда добавить» → приложение → установка → добавить.
import React, { useCallback, useEffect, useState } from "react";
import { acceptTerms, activateTrial, appFetch } from "../utils/api";
import { DevicePicker, type SubInfo } from "./SiteCabinet";
import { daysWord, isAuthErr, type CabNav } from "./siteKit";

type Desktop = { windows_url?: string; macos_url?: string; version?: string };
type Msg = { text: string; action?: { label: string; href?: string; to?: string } };

export const TRIAL_CSS = `
.fs-try { height: 52px; padding: 0 30px; border-radius: 12px; border: 0; background: #fff; color: #0A0A0A; font: 700 16px 'Onest', 'Outfit', system-ui, sans-serif;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 10px; transition: opacity .15s; }
.fs-try:hover:not(:disabled) { opacity: .9; }
.fs-try:disabled { opacity: .6; cursor: default; }
.fs-try-msg { margin-top: 14px; max-width: 440px; padding: 12px 14px; border-radius: 12px; border: 1px solid #5A4C28; background: #262014; color: #EAD7A2;
  font-size: 13.5px; line-height: 1.5; }
.fs-try-msg a { margin-left: 6px; color: #fff; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
@media (max-width: 860px) { .fs-try { width: 100%; } }
`;

export const TRY_PARAM = "try";

export default function TrialButton({
  authed, nav, desktop, trialDays, bot,
}: {
  authed: boolean | null;
  nav: CabNav;
  desktop: Desktop;
  trialDays: number;
  bot: string;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [setup, setSetup] = useState<string | null>(null); // текст над выбором устройства; null — закрыто

  const start = useCallback(async () => {
    if (busy) return;
    setMsg(null);
    if (authed === false) {
      nav.go(`/login?next=${encodeURIComponent(`/?${TRY_PARAM}=1`)}`);
      return;
    }
    setBusy(true);
    try {
      const sub = await appFetch<SubInfo>("/subscription");
      if (sub.status === "active" || sub.status === "trial") {
        setSetup("");
        return;
      }
      try {
        await acceptTerms();
      } catch (e) {
        if (isAuthErr(e)) throw e;
      }
      const r = await activateTrial();
      if (r.success) {
        setSetup(trialDays > 0 ? `Пробный период активирован — ${trialDays} ${daysWord(trialDays)} бесплатно` : "Пробный период активирован");
      } else if (r.code === "in_family") {
        setSetup("");
      } else if (r.code === "trial_used") {
        setMsg({ text: "Пробный период уже был активирован.", action: { label: "Выбрать тариф", to: "/tariffs" } });
      } else if (r.code === "need_telegram") {
        setMsg({
          text: "Пробный период доступен при входе через Telegram.",
          action: bot ? { label: "Открыть бота", href: `https://t.me/${bot}` } : { label: "Тарифы", to: "/tariffs" },
        });
      } else if (r.code === "trial_disabled") {
        setMsg({ text: "Пробный период сейчас недоступен.", action: { label: "Выбрать тариф", to: "/tariffs" } });
      } else {
        setMsg({ text: r.message || "Не удалось активировать пробный период." });
      }
    } catch (e) {
      if (isAuthErr(e)) {
        nav.expired();
        nav.go(`/login?next=${encodeURIComponent(`/?${TRY_PARAM}=1`)}`);
      } else setMsg({ text: e instanceof Error && e.message ? e.message : "Не удалось активировать пробный период." });
    } finally {
      setBusy(false);
    }
  }, [busy, authed, nav, trialDays, bot]);

  // вернулись со входа с ?try=1 — продолжаем сами
  useEffect(() => {
    if (authed !== true) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get(TRY_PARAM) !== "1") return;
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  return (
    <>
      <button type="button" className="fs-try" disabled={busy || authed === null} onClick={() => void start()}>
        {busy ? "Активируем…" : "Попробовать за 0 ₽"}
      </button>
      {msg ? (
        <div className="fs-try-msg">
          {msg.text}
          {msg.action ? (
            msg.action.href ? (
              <a href={msg.action.href} target="_blank" rel="noopener noreferrer">{msg.action.label}</a>
            ) : (
              <a onClick={() => nav.go(msg.action!.to || "/tariffs")}>{msg.action.label}</a>
            )
          ) : null}
        </div>
      ) : null}
      {setup !== null ? <DevicePicker desktop={desktop} note={setup || undefined} onClose={() => setSetup(null)} /> : null}
    </>
  );
}
