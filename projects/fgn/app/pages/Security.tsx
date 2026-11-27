// FGN: «Безопасность» (переопределение src/app/pages/Security.tsx).
// Логика та же (привязка/смена почты с кодом, привязка Telegram, объединение аккаунтов, выход).
// Дизайн в стиле «Настроек» (макет 71): подпись секции 12/600 в разрядку, карточка 24 с рамкой,
// строки 74 (иконка 48, заголовок 16.5/500, подпись 14.5), круглые кнопки 36, светлая кнопка 52.
import React, { useEffect, useState } from "react";
import { PROJECT_ID } from "../utils/brand";
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
import { C, FgnDialog, FgnHeader, FgnIcon, FgnPage, fgnButton, fgnInput } from "../components/fgn";

const GREEN = "#34D67C";
const DANGER = "#FF5D62";
const TEXT = "#F4F4F5";
const MUTED = "#9B9BA4";
const LABEL = "#757482";
const CARD_BG = "#141416";
const CARD_BORDER = "#2A2A30";

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
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0" }}>
      <span style={{ color: MUTED }}>{label}</span>
      <span style={{ color: strong ? TEXT : "#D9D9DE", fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
  const notes: string[] = [];
  if (m.balance && m.balance > 0) notes.push(`Реферальный баланс ${String(m.balance).replace(".", ",")} ₽ тоже перейдёт сюда.`);
  if (m.link_changes) notes.push("Подписку нужно будет заново добавить в VPN-приложение.");
  notes.push("Второй аккаунт удалится, а его платежи и приглашённые друзья перейдут сюда.");
  return (
    <>
      <div>
        {what === "email" ? "Этот email" : "Этот Telegram"} уже используется в другом вашем аккаунте.
        Мы объединим их в один — ничего не потеряется.
      </div>
      {anySub && m.keep && m.drop && (
        <div
          style={{
            marginTop: 12,
            padding: "4px 14px",
            borderRadius: 16,
            border: `1px solid ${CARD_BORDER}`,
            background: "rgba(255, 255, 255, 0.04)",
            fontSize: 14,
          }}
        >
          {row("Сейчас здесь", subSummary(m.keep.days, m.keep.devices, m.keep.has_sub))}
          <div style={{ height: 1, background: "rgba(255, 255, 255, 0.08)" }} />
          {row("Во втором аккаунте", subSummary(m.drop.days, m.drop.devices, m.drop.has_sub))}
          <div style={{ height: 1, background: "rgba(255, 255, 255, 0.08)" }} />
          {row("Будет", subSummary(m.result.days, m.result.devices), true)}
        </div>
      )}
      {anySub && (
        <div style={{ marginTop: 10 }}>Дни подписки складываются, а устройств останется столько, сколько было больше.</div>
      )}
      {notes.map((n) => (
        <div key={n} style={{ marginTop: 6 }}>{n}</div>
      ))}
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

/** подпись секции: 12/600, капс, широкая разрядка */
function Section({ children, top }: { children: React.ReactNode; top: number }) {
  return (
    <div
      style={{
        marginTop: top,
        flexShrink: 0,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: "16px",
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        color: LABEL,
      }}
    >
      {children}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  flexShrink: 0,
  borderRadius: 24,
  border: `1px solid ${CARD_BORDER}`,
  background: CARD_BG,
  overflow: "hidden",
  boxSizing: "border-box",
};

function RIcon({ name, color, size = 22 }: { name: string; color?: string; size?: number }) {
  return (
    <span style={{ width: 48, flexShrink: 0, display: "flex", justifyContent: "center", paddingRight: 12.5, boxSizing: "border-box", color: color || TEXT }}>
      <FgnIcon name={name} size={size} stroke={2} />
    </span>
  );
}

/** строка карточки: иконка, заголовок с подписью, элемент справа */
function Row({ icon, title, subtitle, right, last }: {
  icon: string;
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        minHeight: 74,
        padding: "15px 15px 15px 16px",
        boxSizing: "border-box",
        borderBottom: last ? "none" : "1px solid rgba(255, 255, 255, 0.07)",
      }}
    >
      <RIcon name={icon} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16.5, fontWeight: 500, lineHeight: "24px", color: TEXT }}>{title}</div>
        {subtitle ? (
          <div style={{ fontSize: 14.5, lineHeight: "20px", color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {right ? <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: 10 }}>{right}</div> : null}
    </div>
  );
}

/** маленькая светлая кнопка («Привязать») */
function SmallBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="blin-press"
      disabled={disabled}
      onClick={onClick}
      style={{
        appearance: "none",
        margin: 0,
        height: 34,
        padding: "0 14px",
        borderRadius: 17,
        border: "none",
        background: C.btnSoft,
        color: C.btnText,
        fontFamily: C.font,
        fontSize: 14.5,
        fontWeight: 500,
        letterSpacing: "-0.01em",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

/** круглая кнопка-иконка 36 (изменить / отвязать) */
function RoundBtn({ icon, label, onClick, disabled, danger }: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="blin-press"
      disabled={disabled}
      onClick={onClick}
      style={{
        appearance: "none",
        margin: 0,
        padding: 0,
        width: 36,
        height: 36,
        flexShrink: 0,
        borderRadius: "50%",
        background: "transparent",
        border: "1px solid rgba(255, 255, 255, 0.16)",
        color: danger ? DANGER : "rgba(255, 255, 255, 0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        boxSizing: "border-box",
      }}
    >
      <FgnIcon name={icon} size={16} stroke={2} />
    </button>
  );
}

function OkMark() {
  return <FgnIcon name="check" size={20} stroke={2.2} style={{ color: GREEN }} />;
}

/** пара кнопок под формой: светлая + тёмная с рамкой */
function Pair({ primary, onPrimary, secondary, onSecondary, disabled }: {
  primary: string;
  onPrimary: () => void;
  secondary: string;
  onSecondary: () => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="button"
        className="blin-press"
        disabled={disabled}
        onClick={onPrimary}
        style={{ ...fgnButton, flex: 1, height: 48, borderRadius: 16, fontSize: 15.5, opacity: disabled ? 0.6 : 1 }}
      >
        {primary}
      </button>
      <button
        type="button"
        className="blin-press"
        disabled={disabled}
        onClick={onSecondary}
        style={{
          ...fgnButton,
          flex: 1,
          height: 48,
          borderRadius: 16,
          background: "transparent",
          border: `1px solid ${CARD_BORDER}`,
          color: TEXT,
          fontSize: 15.5,
          boxSizing: "border-box",
        }}
      >
        {secondary}
      </button>
    </div>
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
        const res = await fetch("/api/app/config", { headers: { "X-Project": PROJECT_ID } });
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

  const fade = (i: number): React.CSSProperties => ({ flexShrink: 0, animation: `fgnFade 0.35s ease ${0.05 * i}s both` });
  const msgStyle = { flexShrink: 0, marginTop: 12, fontSize: 14.5, lineHeight: "20px" } as const;

  return (
    <FgnPage>
      <FgnHeader title="Безопасность" onBack={goBack} btnStyle={{ background: CARD_BG, borderColor: CARD_BORDER }} />

      {loading ? (
        <div style={{ marginTop: 20, flexShrink: 0, fontSize: 15, lineHeight: "20px", color: MUTED }}>Загрузка…</div>
      ) : (
        <>
          <div style={{ ...fade(0), marginTop: 12, fontSize: 14.5, lineHeight: "20px", color: MUTED }}>
            Привяжите почту, чтобы войти в аккаунт и без Telegram.
          </div>

          <div style={fade(1)}>
            <Section top={24}>Способы входа</Section>
            <div style={{ ...cardStyle, marginTop: 7.5 }}>
              <Row
                icon="send"
                title="Telegram"
                subtitle={hasTelegram ? "Привязан" : "Не привязан"}
                right={
                  <>
                    {hasTelegram ? <OkMark /> : null}
                    {!inTelegram ? (
                      hasTelegram ? (
                        <RoundBtn
                          icon="edit"
                          label="Изменить"
                          disabled={busy}
                          onClick={() => { setShowTgWidget((v) => !v); setError(""); }}
                        />
                      ) : (
                        <SmallBtn disabled={busy} onClick={() => { setShowTgWidget((v) => !v); setError(""); }}>
                          Привязать
                        </SmallBtn>
                      )
                    ) : null}
                  </>
                }
                last={!inTelegram && showTgWidget}
              />

              {!inTelegram && showTgWidget ? (
                <div
                  style={{
                    padding: "14px 16px",
                    borderBottom: `1px solid rgba(255, 255, 255, 0.07)`,
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  {botUsername ? (
                    <TelegramLoginWidget botUsername={botUsername} onAuth={(u) => void onTgAuth(u)} />
                  ) : (
                    <div style={{ fontSize: 14, lineHeight: "20px", color: DANGER }}>
                      Вход через Telegram не настроен на сервере
                    </div>
                  )}
                </div>
              ) : null}

              <Row
                icon="mail"
                title="Почта"
                subtitle={hasEmail ? user?.email : "Не привязана"}
                right={
                  emailStep === "idle" ? (
                    hasEmail ? (
                      <>
                        <OkMark />
                        <RoundBtn icon="edit" label="Изменить" disabled={busy} onClick={startEmailEdit} />
                        {hasTelegram ? (
                          <RoundBtn icon="trash" label="Отвязать" danger disabled={busy} onClick={() => void removeEmail()} />
                        ) : null}
                      </>
                    ) : (
                      <SmallBtn disabled={busy} onClick={startEmailEdit}>Привязать</SmallBtn>
                    )
                  ) : null
                }
                last={emailStep === "idle"}
              />

              {emailStep === "email" ? (
                <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <input
                    type="email"
                    inputMode="email"
                    value={emailDraft}
                    autoFocus
                    placeholder="you@mail.com"
                    onChange={(e) => setEmailDraft(e.target.value)}
                    style={{ ...fgnInput, height: 50, fontSize: 16 }}
                  />
                  <Pair
                    primary={busy ? "Отправляем…" : "Получить код"}
                    onPrimary={() => void sendEmailCode()}
                    secondary="Отмена"
                    onSecondary={() => { setEmailStep("idle"); setError(""); setInfo(""); }}
                    disabled={busy}
                  />
                </div>
              ) : null}

              {emailStep === "code" ? (
                <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 14.5, lineHeight: "20px", color: MUTED }}>
                    Код отправлен на {emailDraft.trim()}
                  </div>
                  {emailMerge && emailMergeOk ? (
                    <div style={{ fontSize: 14, lineHeight: "20px", color: "#FFB23F" }}>
                      После ввода кода аккаунты объединятся. Будет: {subSummary(emailMerge.result.days, emailMerge.result.devices, Boolean(emailMerge.keep?.has_sub || emailMerge.drop?.has_sub))}.
                    </div>
                  ) : null}
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="······"
                    value={emailCode}
                    autoFocus
                    maxLength={6}
                    onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                    style={{ ...fgnInput, height: 56, letterSpacing: 10, textAlign: "center", fontSize: 22, fontWeight: 500 }}
                  />
                  <Pair
                    primary={busy ? "Проверяем…" : "Подтвердить"}
                    onPrimary={() => void confirmEmailCode()}
                    secondary={resendIn > 0 ? `${resendIn} с` : "Ещё раз"}
                    onSecondary={() => void sendEmailCode()}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="blin-press"
                    onClick={() => { setEmailStep("email"); setEmailCode(""); setInfo(""); }}
                    style={{
                      appearance: "none",
                      alignSelf: "flex-start",
                      margin: 0,
                      padding: "2px 0",
                      background: "transparent",
                      border: "none",
                      color: TEXT,
                      fontFamily: C.font,
                      fontSize: 15,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Изменить почту
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {info ? <div style={{ ...msgStyle, color: GREEN }}>{info}</div> : null}
          {error ? <div style={{ ...msgStyle, color: DANGER }}>{error}</div> : null}

          {!inTelegram ? (
            <div style={fade(2)}>
              <Section top={24}>Сеанс</Section>
              <div style={{ ...cardStyle, marginTop: 7.5 }}>
                <button
                  type="button"
                  className="blin-press"
                  onClick={async () => {
                    await logout();
                    window.location.assign("/");
                  }}
                  style={{
                    appearance: "none",
                    margin: 0,
                    width: "100%",
                    minHeight: 62,
                    padding: "15px 15px 15px 16px",
                    display: "flex",
                    alignItems: "center",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    fontFamily: C.font,
                    color: DANGER,
                    cursor: "pointer",
                    boxSizing: "border-box",
                  }}
                >
                  <RIcon name="logout" color={DANGER} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 16.5, fontWeight: 500, lineHeight: "24px" }}>
                    Выйти из аккаунта
                  </span>
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {emailStep === "code" && emailMerge && !emailMergeOk && (
        <FgnDialog
          title="Объединить аккаунты"
          text={<MergeText m={emailMerge} what="email" />}
          primary="Продолжить"
          onPrimary={() => setEmailMergeOk(true)}
          secondary="Отмена"
          onClose={() => { setEmailMerge(null); setEmailStep("email"); setEmailCode(""); setInfo(""); }}
        />
      )}
      {tgMerge && (
        <FgnDialog
          title="Объединить аккаунты"
          text={<MergeText m={tgMerge.m} what="telegram" />}
          primary={busy ? "Подождите…" : "Объединить"}
          onPrimary={() => void confirmTgMerge()}
          secondary="Отмена"
          onClose={() => setTgMerge(null)}
        />
      )}
    </FgnPage>
  );
}