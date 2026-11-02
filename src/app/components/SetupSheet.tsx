import React, { useEffect, useState } from "react";
import { MSIcon, T as OLD_T, btnReset as baseBtnReset } from "./ui";
import { N, NoirButton, NoirLinkBox, useTgBack } from "./noir";

// палитра нового стиля поверх старых токенов
const T = {
  ...OLD_T,
  bg: "#111117",
  surface: "rgba(255, 255, 255, 0.05)",
  surfaceRaised: "rgba(255, 255, 255, 0.08)",
  border: N.cardBorder,
  orange: N.redText,
  orangeSoft: "rgba(224, 0, 0, 0.16)",
  text: N.text,
  textMuted: N.muted,
  textDim: N.dim,
  danger: "#FF6B6B",
  font: N.font,
};
const btnReset = { ...baseBtnReset, fontFamily: N.font };

function Btn({ children, onClick, disabled, style }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <NoirButton primary onClick={() => onClick?.()} disabled={disabled}>{children}</NoirButton>
    </div>
  );
}
import { fetchAppLink, openDeepLink } from "../utils/api";
import { copyText } from "./SubLinkBox";
import { APP_META, DEVICE_TITLE, KOALA_GUIDE, appSub, appsFor, detectDeviceKind, installOptions, isRecommended, type AppKind, type DeviceKind } from "../utils/apps";

// pick → install → add → done; «другое» → link
type Step = "pick" | "device" | "install" | "add" | "link" | "region" | "done";

const DEVICES: DeviceKind[] = ["ios", "android", "windows", "macos", "linux", "android_tv"];

const DEVICE_ICON: Record<DeviceKind, string> = {
  ios: "phone_iphone",
  android: "android",
  windows: "desktop_windows",
  macos: "laptop_mac",
  linux: "terminal",
  android_tv: "tv",
};

function TextButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="blin-press"
      onClick={onClick}
      style={{ ...btnReset, background: "transparent", border: "none", alignSelf: "center", padding: "10px 16px", fontSize: 14, fontWeight: 600, color: T.textMuted, cursor: "pointer", fontFamily: T.font }}
    >
      {children}
    </button>
  );
}

// смена региона App Store на США — Incy/Happ нет в российском App Store
const US_ADDRESS: [string, string][] = [
  ["Улица", "1 Apple Park Way"],
  ["Город", "Cupertino"],
  ["Штат", "California"],
  ["Индекс", "95014"],
  ["Телефон", "408 996 1010"],
];

const stepNum: React.CSSProperties = {
  width: 24, height: 24, borderRadius: 12, background: T.surfaceRaised, color: T.orange, fontSize: 13, fontWeight: 700,
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};
const strong: React.CSSProperties = { color: T.text, fontWeight: 600 };

function RegionSteps() {
  const [copied, setCopied] = useState("");
  const copy = async (v: string) => {
    if (await copyText(v)) {
      setCopied(v);
      window.setTimeout(() => setCopied((c) => (c === v ? "" : c)), 1400);
    }
  };
  const steps: React.ReactNode[] = [
    <>Настройки → нажмите на <b style={strong}>своё имя</b> вверху</>,
    <><b style={strong}>Информация об аккаунте</b>, платежи и настройки</>,
    <><b style={strong}>Страна или регион</b> → Изменить страну или регион</>,
    <>Выберите <b style={strong}>Соединённые Штаты</b> → примите условия</>,
    <>Способ оплаты — <b style={strong}>«Нет»</b></>,
    <>Адрес — любой из США, например (нажмите, чтобы скопировать):</>,
    <>Нажмите <b style={strong}>«Далее»</b> — готово!</>,
  ];
  return (
    <>
      <div style={{ fontSize: 14, color: T.textMuted, lineHeight: 1.45 }}>
        Если приложения нет в App Store — смените регион Apple ID на США. Подписки и покупки останутся.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
        {steps.map((t, i) => (
          <React.Fragment key={i}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={stepNum}>{i + 1}</span>
              <span style={{ fontSize: 14, color: T.textMuted, lineHeight: 1.45, paddingTop: 2 }}>{t}</span>
            </div>
            {i === 5 ? (
              <div style={{ marginLeft: 36, borderRadius: 14, border: `1px solid ${T.border}`, background: T.surface, overflow: "hidden" }}>
                {US_ADDRESS.map(([k, v], j) => (
                  <button
                    key={k}
                    type="button"
                    className="blin-press"
                    onClick={() => void copy(v)}
                    style={{
                      ...btnReset, width: "100%", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
                      border: "none", borderTop: j ? `1px solid ${T.border}` : "none", background: "transparent", color: T.text,
                      fontSize: 14, lineHeight: "20px", textAlign: "left", cursor: "pointer",
                    }}
                  >
                    <span style={{ width: 62, flexShrink: 0, fontSize: 12.5, color: T.textDim }}>{k}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{v}</span>
                    <MSIcon name={copied === v ? "check" : "content_copy"} style={{ fontSize: 16, color: copied === v ? T.orange : T.textDim }} />
                  </button>
                ))}
              </div>
            ) : null}
          </React.Fragment>
        ))}
      </div>
    </>
  );
}

export function AppIcon({ app, size = 40 }: { app: AppKind; size?: number }) {
  const m = APP_META[app];
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size / 4),
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: T.surfaceRaised,
        flexShrink: 0,
      }}
    >
      {m.img ? (
        <img src={m.img} alt="" style={{ width: size, height: size, objectFit: "cover" }} />
      ) : (
        <MSIcon name={m.icon || "link"} style={{ color: T.text, fontSize: Math.round(size * 0.55) }} />
      )}
    </span>
  );
}

// нижний лист: устройство → приложение → установка → добавить (tv/другое короче)
export default function SetupSheet({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("device");
  const [app, setApp] = useState<AppKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [link, setLink] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [device, setDevice] = useState<DeviceKind>(() => detectDeviceKind());

  // ссылка подписки: «другое приложение», Android TV и Koala Clash (вставить вручную, если настраивают с телефона)
  const needLink = step === "link" || (step === "install" && device === "android_tv") || (step === "add" && app === "koala");
  useEffect(() => {
    if (!needLink || link) return;
    let alive = true;
    setLinkLoading(true);
    setErr("");
    void fetchAppLink("other")
      .then((r) => { if (alive) setLink(r.link); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Не удалось получить ссылку"); })
      .finally(() => { if (alive) setLinkLoading(false); });
    return () => { alive = false; };
  }, [needLink, link]);

  const pick = (a: AppKind) => {
    setApp(a);
    setErr("");
    setStep(a === "other" ? "link" : "install");
  };

  const open = (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); };

  const add = async () => {
    if (!app || busy) return;
    setBusy(true);
    setErr("");
    try {
      openDeepLink(await fetchAppLink(app));
      setStep("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось получить ссылку");
    } finally {
      setBusy(false);
    }
  };

  const title = step === "device" ? "Добавить подписку"
    : step === "pick" ? "Приложение"
    : step === "link" ? "Ссылка на подписку"
    : step === "region" ? "Регион App Store"
    : step === "done" ? "" : step === "install" && device === "android_tv" ? "Happ" : APP_META[app || "incy"].title;

  // android tv: только инструкция (happ + вставка ссылки)
  const tvGuide = step === "install" && device === "android_tv";

  const isTv = device === "android_tv";
  const back = step === "pick" || step === "install" || step === "add" || step === "link" || step === "region";
  const goBack = () => {
    setErr("");
    if (step === "add" || step === "region") setStep("install");
    else if (step === "install") setStep(isTv ? "device" : "pick");
    else if (step === "link") setStep("pick");
    else setStep("device");
  };
  // системная «Назад» Telegram: шаг назад, на первом шаге — закрыть
  useTgBack(() => { if (busy) return; if (back) goBack(); else onClose(); });
  // шаг n из total (обычно 4, tv 2, другое 3)
  const stepTotal = isTv ? 2 : app === "other" && (step === "link" || step === "pick") ? 3 : 4;
  const stepNo = step === "device" ? 1
    : step === "pick" ? 2
    : step === "install" || step === "region" ? (isTv ? 2 : 3)
    : step === "add" ? 4
    : step === "link" ? 3 : 0;

  return (
    <div
      onClick={() => !busy && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4, 4, 8, 0.6)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 40,
        animation: "blinvpnFadeIn 0.18s ease both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 402,
          maxHeight: "90%",
          overflowY: "auto",
          background: T.bg,
          borderTop: `1px solid ${T.border}`,
          borderRadius: "26px 26px 0 0",
          padding: "16px 20px calc(26px + var(--blin-tg-pad-bottom, 0px) / var(--blin-scale))",
          fontFamily: N.font,
          color: N.text,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          animation: "blinvpnSheetUp 0.28s var(--ease-out) both",
        }}
      >
        <div style={{ width: 36, height: 3, borderRadius: 2, background: T.textDim, margin: "0 auto 6px" }} />

        {title ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
            {back ? (
              <button
                type="button"
                aria-label="Назад"
                className="blin-press"
                onClick={goBack}
                style={{ ...btnReset, width: 34, height: 34, borderRadius: "50%", background: T.surface, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.text }}
              >
                <MSIcon name="chevron_left" style={{ fontSize: 20 }} />
              </button>
            ) : null}
            {(step === "install" || step === "add") && (app || isTv) ? <AppIcon app={tvGuide ? "happ" : (app || "happ")} size={32} /> : null}
            <div style={{ fontWeight: 500, fontSize: 20, letterSpacing: "-0.015em", color: T.text, flex: 1 }}>{title}</div>
            {stepNo ? (
              <div style={{ fontSize: 12, color: T.textDim, fontWeight: 500 }}>Шаг {stepNo} из {stepTotal}</div>
            ) : null}
          </div>
        ) : null}

        {step === "pick" && (
          <>
            <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 6, lineHeight: 1.4 }}>
              Выберите приложение для {DEVICE_TITLE[device]}.
            </div>
            {appsFor(device).map((a) => {
              const m = APP_META[a];
              const rec = isRecommended(a, device);
              return (
                <button
                  key={a}
                  type="button"
                  className="blin-press"
                  onClick={() => pick(a)}
                  style={{
                    ...btnReset,
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    width: "100%",
                    minHeight: 64,
                    padding: "12px 16px",
                    borderRadius: T.radius.lg,
                    border: rec ? `1px solid ${T.orange}` : `1px solid ${T.border}`,
                    background: T.surface,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <AppIcon app={a} />
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 16, color: T.text }}>{m.title}</span>
                      {rec ? <span style={{ fontSize: 11, fontWeight: 600, color: T.orange }}>рекомендуем</span> : null}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: T.textMuted, marginTop: 2 }}>{rec ? (a === "koala" ? "Windows, macOS, Linux" : m.sub) : appSub(a, device)}</span>
                  </span>
                  <MSIcon name="chevron_right" style={{ color: T.orange }} />
                </button>
              );
            })}
          </>
        )}

        {step === "device" && (
          <>
            <div style={{ fontSize: 14, color: T.textMuted, lineHeight: 1.45 }}>
              На каком устройстве будете пользоваться VPN?
            </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, margin: "4px 0 6px" }}>
                {DEVICES.map((d) => {
                  const on = d === device;
                  return (
                    <button
                      key={d}
                      type="button"
                      className="blin-press"
                      onClick={() => { setDevice(d); setErr(""); setStep(d === "android_tv" ? "install" : "pick"); }}
                      style={{
                        ...btnReset,
                        height: 68,
                        borderRadius: T.radius.md,
                        background: on ? T.orangeSoft : T.surface,
                        border: `1px solid ${on ? T.orange : T.border}`,
                        color: on ? T.orange : T.text,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        cursor: "pointer",
                      }}
                    >
                      <MSIcon name={DEVICE_ICON[d]} style={{ fontSize: 24 }} />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{DEVICE_TITLE[d]}</span>
                    </button>
                  );
                })}
              </div>
          </>
        )}

        {step === "install" && (app || isTv) && (
          <>
            {/* tap to change device */}
            <button
                type="button"
                className="blin-press"
                onClick={() => setStep("device")}
                style={{
                  ...btnReset,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: T.radius.md,
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <MSIcon name={DEVICE_ICON[device]} style={{ fontSize: 22, color: T.text }} />
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontSize: 12, color: T.textDim }}>Устройство</span>
                  <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: T.text }}>{DEVICE_TITLE[device]}</span>
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.orange }}>Сменить</span>
              </button>

            {device === "android_tv" ? (
              <>
                {[
                  "На телевизоре откройте Google Play и установите Happ.",
                  "В Happ добавьте подписку вручную (кнопка «+») и введите ссылку:",
                ].map((text, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span style={{ width: 24, height: 24, borderRadius: 12, background: T.surfaceRaised, color: T.orange, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 14, color: T.textMuted, lineHeight: 1.45, paddingTop: 2 }}>{text}</span>
                  </div>
                ))}
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: T.radius.md,
                    background: T.surfaceRaised,
                    color: T.text,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 15,
                    lineHeight: 1.5,
                    wordBreak: "break-all",
                    userSelect: "all",
                    textAlign: "center",
                  }}
                >
                  {linkLoading ? "Загрузка…" : link || err || "—"}
                </div>
                <div style={{ fontSize: 12, color: T.textDim, textAlign: "center" }}>
                  Вводите внимательно: важны заглавные и строчные буквы.
                </div>
              </>
            ) : app ? (
              <>
                {app === "koala" && KOALA_GUIDE[device] ? (
                  KOALA_GUIDE[device]!.map((text, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <span style={{ width: 24, height: 24, borderRadius: 12, background: T.surfaceRaised, color: T.orange, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {i + 1}
                      </span>
                      <span style={{ fontSize: 14, color: T.textMuted, lineHeight: 1.45, paddingTop: 2 }}>{text}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 14, color: T.textMuted, lineHeight: 1.45 }}>
                    Скачайте и установите {APP_META[app].title} на {DEVICE_TITLE[device]}.
                  </div>
                )}
                {installOptions(app, device).map((o, i) => i === 0 ? (
                  <Btn key={o.url} onClick={() => open(o.url)}>
                    <MSIcon name="download" style={{ fontSize: 18, marginRight: 6 }} /> {o.label}
                  </Btn>
                ) : (
                  <TextButton key={o.url} onClick={() => open(o.url)}>{o.label}</TextButton>
                ))}
                <TextButton onClick={() => { setErr(""); setStep("add"); }}>Далее</TextButton>
                {device === "ios" ? (
                  <button
                    type="button"
                    className="blin-press"
                    onClick={() => setStep("region")}
                    style={{
                      ...btnReset, width: "100%", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                      border: `1px dashed ${T.border}`, borderRadius: 14, background: "transparent", color: T.textMuted,
                      fontSize: 13.5, lineHeight: "19px", cursor: "pointer",
                    }}
                  >
                    <MSIcon name="public" style={{ fontSize: 20 }} />
                    <span style={{ flex: 1, minWidth: 0 }}><b style={strong}>Нет в App Store?</b> Как сменить регион на США</span>
                    <MSIcon name="chevron_right" style={{ fontSize: 18, color: T.textDim }} />
                  </button>
                ) : null}
              </>
            ) : null}
          </>
        )}

        {step === "add" && app && (
          <>
            <div style={{ fontSize: 14, color: T.textMuted, lineHeight: 1.45, marginBottom: 4 }}>
              {app === "koala"
                ? "Откройте мини-приложение на этом компьютере и нажмите кнопку — Koala Clash предложит добавить профиль, нажмите «Да»."
                : `Нажмите кнопку — подписка сама добавится в ${APP_META[app].title}. После этого откройте приложение и подключитесь.`}
            </div>
            <Btn disabled={busy} onClick={() => void add()}>
              {busy ? "Открываем…" : "Добавить подписку"}
            </Btn>
            {err && app !== "koala" ? <div style={{ fontSize: 12, color: T.danger, textAlign: "center" }}>{err}</div> : null}
            {app === "koala" ? (
              <>
                <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.45, marginTop: 8 }}>
                  Настраиваете с телефона? Скопируйте ссылку и вставьте её в Koala Clash: Профили → «+».
                </div>
                <NoirLinkBox link={link} loading={linkLoading} error={err} />
              </>
            ) : null}
          </>
        )}

        {step === "region" && (
          <>
            <RegionSteps />
            <Btn onClick={() => setStep("install")} style={{ marginTop: 6 }}>Регион сменил — к установке</Btn>
          </>
        )}

        {step === "link" && (
          <>
            <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 4, lineHeight: 1.4 }}>
              Скопируйте ссылку и добавьте её в своё VPN-приложение как подписку.
            </div>
            <NoirLinkBox link={link} loading={linkLoading} error={err} />
          </>
        )}

        {step === "done" && app && (
          <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
            <MSIcon name="check_circle" style={{ fontSize: 56, color: T.orange }} />
            <div style={{ fontWeight: 600, fontSize: 18, color: T.text, marginTop: 10 }}>Подписка добавлена</div>
            <div style={{ fontSize: 13, color: T.textMuted, marginTop: 6, lineHeight: 1.45 }}>
              {app === "koala"
                ? "В Koala Clash подтвердите добавление профиля, выберите его и включите подключение."
                : `Откройте ${APP_META[app].title} и нажмите «Подключиться».`}
            </div>
          </div>
        )}


        {step === "device" ? <TextButton onClick={onClose}>Отмена</TextButton> : null}
        {step === "done" ? (
          <>
            <Btn onClick={onClose} style={{ marginTop: 6 }}>Готово</Btn>
            <TextButton onClick={() => void add()}>Не добавилась? Ещё раз</TextButton>
          </>
        ) : null}
      </div>
    </div>
  );
}
