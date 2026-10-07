import React, { useEffect, useState } from "react";
import { MSIcon, btnReset } from "../components/ui";
import { N, NoirBack, NoirButton, NoirCard, NoirField, NoirLoading, NoirScreen, NoirSection, NoirTextButton } from "../components/noir";

const GREEN = "#2FD39A";
const DANGER = "#FF6B6B";
import { TelegramLoginWidget } from "../components/TelegramLoginWidget";
import { useSmartBack } from "../utils/navigation";
import {
  AppUser,
  bindTelegram,
  fetchMe,
  logout,
  requestBindEmailCode,
  unbindEmail,
  updateEmail,
  mergeFromError,
  type MergePreview,
  type TelegramOAuthPayload,
} from "../utils/api";
import ConfirmDialog from "../components/ConfirmDialog";

const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;

// «17 дней, 3 устройства» / «нет подписки»
export function subSummary(days: number, devices: number, hasSub = true): string {
  if (!hasSub) return "нет подписки";
  const d = Math.floor(days);
  const dayPart = d < 1 ? "меньше дня" : `${d} ${plural(d, "день", "дня", "дней")}`;
  return `${dayPart}, ${devices} ${plural(devices, "устройство", "устройства", "устройств")}`;
}

function MergeText({ m, what }: { m: MergePreview; what: "email" | "telegram" }) {
  const anySub = Boolean(m.keep?.has_sub || m.drop?.has_sub);
  const row = (label: string, value: string, strong = false) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0" }}>
      <span style={{ color: strong ? N.text : N.muted }}>{label}</span>
      <span style={{ color: strong ? N.redText : N.text, fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
  const notes: string[] = [];
  if (m.balance && m.balance > 0) notes.push(`Реферальный баланс ${String(m.balance).replace(".", ",")} ₽ тоже перейдёт сюда.`);
  if (m.link_changes) notes.push("Подписку нужно будет заново добавить в VPN-приложение.");
  notes.push("Второй аккаунт удалится, а его платежи и приглашённые друзья перейдут сюда.");
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        {what === "email" ? "Этот email" : "Этот Telegram"} уже используется в другом вашем аккаунте.
        Мы объединим их в один — ничего не потеряется.
      </div>
      {anySub && m.keep && m.drop && (
        <div style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${N.cardBorder}`, borderRadius: 16, padding: "4px 14px", marginBottom: 12, fontSize: 14.5 }}>
          {row("Сейчас здесь", subSummary(m.keep.days, m.keep.devices, m.keep.has_sub))}
          <div style={{ height: 1, background: N.divider }} />
          {row("Во втором аккаунте", subSummary(m.drop.days, m.drop.devices, m.drop.has_sub))}
          <div style={{ height: 1, background: N.divider }} />
          {row("Будет", subSummary(m.result.days, m.result.devices), true)}
        </div>
      )}
      {anySub && (
        <div style={{ fontSize: 14, marginBottom: 8 }}>Дни подписки складываются, а устройств останется столько, сколько было больше.</div>
      )}
      {notes.map((n) => <div key={n} style={{ fontSize: 14, marginTop: 4 }}>{n}</div>)}
    </>
  );
}

function isTelegramContext(): boolean {
  try {
    const wa = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
    return Boolean(wa?.initData && wa.initData.length > 0);
  } catch {
    return false;
  }
}

type EmailStep = "idle" | "email" | "code";

function IconBtn({ icon, label, onClick, disabled, danger }: { icon: string; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="blin-press"
      style={{ ...btnReset, width: 38, height: 38, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(255,255,255,0.07)", border: "none", color: danger ? DANGER : N.muted, cursor: disabled ? "default" : "pointer", flex: "none" }}>
      <MSIcon name={icon} style={{ fontSize: 19, color: "inherit", fontVariationSettings: "'wght' 300" }} />
    </button>
  );
}

function SmallBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="blin-press"
      style={{ ...btnReset, height: 38, padding: "0 16px", borderRadius: 19, border: "none", background: N.red,
        color: N.text, fontFamily: N.font, fontSize: 14.5, fontWeight: 500, cursor: "pointer", flex: "none" }}>
      {children}
    </button>
  );
}

export default function Security() {
  const goBack = useSmartBack("/settings");
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [emailStep, setEmailStep] = useState<EmailStep>("idle");
  const [emailDraft, setEmailDraft] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const inTelegram = isTelegramContext();
  const [botUsername, setBotUsername] = useState("");
  const [showTgWidget, setShowTgWidget] = useState(false);
  // предупреждение об объединении перед привязкой занятых email/tg
  const [emailMerge, setEmailMerge] = useState<MergePreview | null>(null);
  const [emailMergeOk, setEmailMergeOk] = useState(false);
  const [tgMerge, setTgMerge] = useState<{ m: MergePreview; payload: TelegramOAuthPayload } | null>(null);

  const load = async () => {
    const me = await fetchMe();
    setUser(me);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (inTelegram) return;
    void (async () => {
      try {
        const res = await fetch("/api/app/config");
        const body = (await res.json().catch(() => null)) as { botUsername?: string } | null;
        if (!res.ok || !body) return;
        if (typeof body.botUsername === "string" && body.botUsername.trim()) {
          setBotUsername(body.botUsername.trim().replace(/^@/, ""));
        }
      } catch {
        /* ignore */
      }
    })();
  }, [inTelegram]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const onTgAuth = async (payload: TelegramOAuthPayload) => {
    setBusy(true);
    setError("");
    try {
      const clean: TelegramOAuthPayload = { id: payload.id, hash: payload.hash };
      if (payload.first_name) clean.first_name = payload.first_name;
      if (payload.last_name) clean.last_name = payload.last_name;
      if (payload.username) clean.username = payload.username;
      if (payload.photo_url) clean.photo_url = payload.photo_url;
      if (payload.auth_date != null && payload.auth_date !== "") clean.auth_date = payload.auth_date;
      const updated = await bindTelegram(clean);
      setUser(updated);
      setShowTgWidget(false);
    } catch (e) {
      const m = mergeFromError(e);
      if (m) {
        setTgMerge({ m, payload: { ...payload } });
        return;
      }
      setError(e instanceof Error ? e.message : "Не удалось привязать Telegram");
    } finally {
      setBusy(false);
    }
  };

  const confirmTgMerge = async () => {
    if (!tgMerge) return;
    setBusy(true);
    setError("");
    try {
      const p = tgMerge.payload;
      const clean: TelegramOAuthPayload = { id: p.id, hash: p.hash };
      if (p.first_name) clean.first_name = p.first_name;
      if (p.last_name) clean.last_name = p.last_name;
      if (p.username) clean.username = p.username;
      if (p.photo_url) clean.photo_url = p.photo_url;
      if (p.auth_date != null && p.auth_date !== "") clean.auth_date = p.auth_date;
      const updated = await bindTelegram(clean, true);
      setUser(updated);
      setShowTgWidget(false);
      setInfo("Аккаунты объединены");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось объединить аккаунты");
    } finally {
      setTgMerge(null);
      setBusy(false);
    }
  };

  const hasTelegram = Boolean(user?.telegram_id);
  const hasEmail = Boolean(user?.email);

  const sendEmailCode = async () => {
    const value = emailDraft.trim().toLowerCase();
    if (!value || !value.includes("@")) {
      setError("Введите корректный email");
      return;
    }
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const r = await requestBindEmailCode(value);
      setEmailMerge(r.merge ?? null);
      setEmailMergeOk(false);
      setEmailStep("code");
      setResendIn(r.resend_after || 60);
      setInfo(
        r.dev_code
          ? `Код (демо-режим): ${r.dev_code}`
          : "Код отправлен на почту. Введите его ниже.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить код");
    } finally {
      setBusy(false);
    }
  };

  const confirmEmailCode = async () => {
    const value = emailDraft.trim().toLowerCase();
    if (emailCode.trim().length < 4) {
      setError("Введите код из письма");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await updateEmail(value, emailCode.trim(), emailMergeOk);
      setUser(updated);
      setEmailStep("idle");
      setEmailCode("");
      setInfo(emailMergeOk ? "Аккаунты объединены" : "");
      setEmailMerge(null);
      setEmailMergeOk(false);
    } catch (e) {
      const m = mergeFromError(e);
      if (m) {
        setEmailMerge(m);
        setEmailMergeOk(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Неверный код");
    } finally {
      setBusy(false);
    }
  };

  const startEmailEdit = () => {
    setEmailDraft(user?.email || "");
    setEmailStep("email");
    setEmailCode("");
    setError("");
    setInfo("");
  };

  const removeEmail = async () => {
    setBusy(true);
    setError("");
    try {
      const updated = await unbindEmail();
      setUser(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отвязать");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <NoirLoading />;

  const iconBox = (name: string) => (
    <div style={{ width: 42, height: 42, borderRadius: 14, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
      <MSIcon name={name} style={{ fontSize: 22, color: "rgba(255,255,255,0.85)", fontVariationSettings: "'wght' 300" }} />
    </div>
  );
  const okMark = <MSIcon name="check_circle" style={{ color: GREEN, fontSize: 22, fontVariationSettings: "'wght' 300" }} />;
  const rowTitle = { fontSize: 17, fontWeight: 400, color: N.text } as const;
  const rowSub = { fontSize: 14.5, color: N.muted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
  const twoBtns = (a: React.ReactNode, b: React.ReactNode) => (
    <div style={{ display: "flex", gap: 8 }}>
      <div style={{ flex: 1 }}>{a}</div>
      <div style={{ flex: 1 }}>{b}</div>
    </div>
  );

  return (
    <NoirScreen dim={0.45}>
      <div style={{ paddingTop: 20, marginBottom: 22 }}>
        <NoirBack onClick={goBack} />
      </div>
      <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.15, color: N.text }}>
        Безопасность
      </div>
      <div style={{ marginTop: 8, fontSize: 15.5, lineHeight: 1.5, color: N.muted }}>
        Привяжите почту, чтобы войти в аккаунт и без Telegram.
      </div>

      {emailStep === "code" && emailMerge && !emailMergeOk && (
        <ConfirmDialog
          title="Объединить аккаунты"
          confirmText="Продолжить"
          onConfirm={() => setEmailMergeOk(true)}
          onCancel={() => { setEmailMerge(null); setEmailStep("email"); setEmailCode(""); setInfo(""); }}
        >
          <MergeText m={emailMerge} what="email" />
        </ConfirmDialog>
      )}
      {tgMerge && (
        <ConfirmDialog
          title="Объединить аккаунты"
          confirmText="Объединить"
          busy={busy}
          onConfirm={() => void confirmTgMerge()}
          onCancel={() => setTgMerge(null)}
        >
          <MergeText m={tgMerge.m} what="telegram" />
        </ConfirmDialog>
      )}

      <NoirSection>Способы входа</NoirSection>
      <NoirCard style={{ padding: "4px 16px", animation: "blinvpnRise 0.5s var(--ease-out) both" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0", borderBottom: `1px solid ${N.divider}` }}>
          {iconBox("send")}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={rowTitle}>Telegram</div>
            <div style={rowSub}>{hasTelegram ? "Привязан" : "Не привязан"}</div>
          </div>
          {hasTelegram ? okMark : null}
          {!inTelegram ? (
            hasTelegram ? (
              <IconBtn icon="edit" label="Изменить" disabled={busy} onClick={() => { setShowTgWidget((v) => !v); setError(""); }} />
            ) : (
              <SmallBtn disabled={busy} onClick={() => { setShowTgWidget((v) => !v); setError(""); }}>Привязать</SmallBtn>
            )
          ) : null}
        </div>

        {!inTelegram && showTgWidget && botUsername ? (
          <div style={{ padding: "14px 0 10px", display: "flex", justifyContent: "center", borderBottom: `1px solid ${N.divider}` }}>
            <TelegramLoginWidget botUsername={botUsername} onAuth={(u) => void onTgAuth(u)} />
          </div>
        ) : null}
        {!inTelegram && showTgWidget && !botUsername ? (
          <div style={{ fontSize: 14, color: DANGER, padding: "10px 0", borderBottom: `1px solid ${N.divider}` }}>
            Вход через Telegram не настроен на сервере
          </div>
        ) : null}

        <div style={{ padding: "14px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {iconBox("mail")}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={rowTitle}>Почта</div>
              <div style={rowSub}>{hasEmail ? user?.email : "Не привязана"}</div>
            </div>
            {emailStep === "idle" && hasEmail ? (
              <>
                {okMark}
                <IconBtn icon="edit" label="Изменить" disabled={busy} onClick={startEmailEdit} />
                {hasTelegram ? <IconBtn icon="delete" label="Отвязать" danger disabled={busy} onClick={() => void removeEmail()} /> : null}
              </>
            ) : null}
            {emailStep === "idle" && !hasEmail ? <SmallBtn disabled={busy} onClick={startEmailEdit}>Привязать</SmallBtn> : null}
          </div>

          {emailStep === "email" ? (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <NoirField type="email" inputMode="email" value={emailDraft} onChange={setEmailDraft} placeholder="you@mail.com" autoFocus />
              {twoBtns(
                <NoirButton primary disabled={busy} onClick={() => void sendEmailCode()}>{busy ? "Отправляем…" : "Получить код"}</NoirButton>,
                <NoirButton disabled={busy} onClick={() => { setEmailStep("idle"); setError(""); setInfo(""); }}>Отмена</NoirButton>,
              )}
            </div>
          ) : null}

          {emailStep === "code" ? (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 14.5, color: N.muted }}>Код отправлен на {emailDraft.trim()}</div>
              {emailMerge && emailMergeOk && (
                <div style={{ fontSize: 14, color: N.redText, lineHeight: 1.45 }}>
                  После ввода кода аккаунты объединятся. Будет: {subSummary(emailMerge.result.days, emailMerge.result.devices, Boolean(emailMerge.keep?.has_sub || emailMerge.drop?.has_sub))}.
                </div>
              )}
              <NoirField
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="······"
                value={emailCode}
                autoFocus
                maxLength={6}
                onChange={(v) => setEmailCode(v.replace(/\D/g, ""))}
                style={{ letterSpacing: 10, textAlign: "center", fontSize: 24, fontWeight: 500 }}
              />
              {twoBtns(
                <NoirButton primary disabled={busy || emailCode.length < 4} onClick={() => void confirmEmailCode()}>{busy ? "Проверяем…" : "Подтвердить"}</NoirButton>,
                <NoirButton disabled={busy || resendIn > 0} onClick={() => void sendEmailCode()}>{resendIn > 0 ? `${resendIn} с` : "Ещё раз"}</NoirButton>,
              )}
              <button
                type="button"
                style={{ ...btnReset, background: "transparent", border: "none", padding: "4px 0", color: N.text, fontFamily: N.font, fontSize: 15, fontWeight: 500, cursor: "pointer", alignSelf: "flex-start" }}
                onClick={() => { setEmailStep("email"); setEmailCode(""); setInfo(""); }}
              >
                Изменить почту
              </button>
            </div>
          ) : null}
        </div>
      </NoirCard>

      {info ? <div style={{ color: GREEN, fontSize: 14, marginTop: 12 }}>{info}</div> : null}
      {error ? <div style={{ color: DANGER, fontSize: 14, marginTop: 12 }}>{error}</div> : null}

      {!inTelegram ? (
        <div style={{ marginTop: "auto", paddingTop: 24 }}>
          <NoirTextButton
            color={DANGER}
            onClick={async () => {
              await logout();
              window.location.assign("/");
            }}
          >
            Выйти из аккаунта
          </NoirTextButton>
        </div>
      ) : null}
    </NoirScreen>
  );
}
