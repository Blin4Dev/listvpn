// FGN: лист «Куда добавить» (макет 49) и дальнейшие шаги установки в том же стиле.
// Логика как в src/app/components/SetupSheet.tsx: устройство → приложение → установка → добавить (tv/другое короче).
import React, { useEffect, useState } from "react";
import { useTgBack } from "./noir";
import { copyText } from "./SubLinkBox";
import { C, FGN_DIM, FgnIcon, fgnButton } from "./fgn";
import { fetchAppLink, openDeepLink } from "../utils/api";
import { APP_META, DEVICE_TITLE, KOALA_GUIDE, appSub, appsFor, installOptions, isRecommended, type AppKind, type DeviceKind } from "../utils/apps";

type Step = "pick" | "device" | "install" | "add" | "link" | "region" | "done";

const DEVICES: DeviceKind[] = ["ios", "android", "windows", "macos", "linux", "android_tv"];
const DEVICE_ICON: Record<DeviceKind, string> = {
  ios: "phone",
  android: "phone",
  windows: "monitor",
  macos: "monitor",
  linux: "monitor",
  android_tv: "tv",
};

// цвета по макету
const SHEET_BG = "#141416";
const BORDER = "#2A2A30";
const CELL_BG = "#070708";
const TEXT = "#F4F4F5";
const MUTED = "#9B9BA4";
const ROUND_BTN = "#1E1E22";

const KEYFRAMES = `
@keyframes fgnFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes fgnSheetUp { from { transform: translateY(100%); } to { transform: none; } }
`;

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
        background: ROUND_BTN,
        color: TEXT,
        flexShrink: 0,
      }}
    >
      {m.img ? <img src={m.img} alt="" style={{ width: size, height: size, objectFit: "cover" }} /> : <FgnIcon name="file" size={Math.round(size * 0.5)} stroke={1.8} />}
    </span>
  );
}

/** круглая кнопка 40 (крестик / назад) */
function RoundBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="blin-press"
      onClick={onClick}
      style={{
        appearance: "none",
        margin: 0,
        padding: 0,
        width: 40,
        height: 40,
        flexShrink: 0,
        borderRadius: "50%",
        background: ROUND_BTN,
        border: "none",
        color: TEXT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <FgnIcon name={icon} size={18} stroke={2} />
    </button>
  );
}

const hint: React.CSSProperties = { fontSize: 14, lineHeight: "20px", color: MUTED };

const cell: React.CSSProperties = {
  appearance: "none",
  margin: 0,
  padding: 0,
  borderRadius: 16,
  border: `1px solid ${BORDER}`,
  background: CELL_BG,
  color: TEXT,
  fontFamily: C.font,
  cursor: "pointer",
  boxSizing: "border-box",
};

const mainBtn: React.CSSProperties = { ...fgnButton, height: 52, borderRadius: 16, background: "#F3F3F4", fontSize: 16, letterSpacing: 0 };
const ghostBtn: React.CSSProperties = {
  ...fgnButton,
  height: 54,
  borderRadius: 16,
  background: "transparent",
  border: `1px solid ${BORDER}`,
  color: TEXT,
  fontSize: 16,
  letterSpacing: 0,
  boxSizing: "border-box",
};

// смена региона App Store на США — Incy/Happ нет в российском App Store
const US_ADDRESS: [string, string][] = [
  ["Улица", "1 Apple Park Way"],
  ["Город", "Cupertino"],
  ["Штат", "California"],
  ["Индекс", "95014"],
  ["Телефон", "408 996 1010"],
];

const stepNum: React.CSSProperties = {
  width: 24, height: 24, borderRadius: 12, background: ROUND_BTN, color: TEXT, fontSize: 13, fontWeight: 600,
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};
const strong: React.CSSProperties = { color: TEXT, fontWeight: 600 };

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
      <div style={{ ...hint, marginTop: 15 }}>Если приложения нет в App Store — смените регион Apple ID на США. Подписки и покупки останутся.</div>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {steps.map((t, i) => (
          <React.Fragment key={i}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={stepNum}>{i + 1}</span>
              <span style={{ ...hint, paddingTop: 2 }}>{t}</span>
            </div>
            {i === 5 ? (
              <div style={{ marginLeft: 36, borderRadius: 14, border: `1px solid ${BORDER}`, background: CELL_BG, overflow: "hidden" }}>
                {US_ADDRESS.map(([k, v], j) => (
                  <button
                    key={k}
                    type="button"
                    className="blin-press"
                    onClick={() => void copy(v)}
                    style={{
                      appearance: "none", margin: 0, width: "100%", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
                      border: "none", borderTop: j ? "1px solid #1F1F24" : "none", background: "transparent", color: TEXT,
                      fontFamily: C.font, fontSize: 14, lineHeight: "20px", textAlign: "left", cursor: "pointer",
                    }}
                  >
                    <span style={{ width: 62, flexShrink: 0, fontSize: 12.5, color: "#6E6E78" }}>{k}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{v}</span>
                    <FgnIcon name={copied === v ? "check" : "copy"} size={15} stroke={2} style={{ color: copied === v ? C.green : "#6E6E78" }} />
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

export default function SetupSheet({ onClose, note }: { onClose: () => void; note?: React.ReactNode }) {
  const [step, setStep] = useState<Step>("device");
  const [app, setApp] = useState<AppKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [link, setLink] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [device, setDevice] = useState<DeviceKind>("ios");

  const isTv = device === "android_tv";
  // ссылка подписки: «другое приложение», Android TV и Koala Clash (вставить вручную, если настраивают с телефона)
  const needLink = step === "link" || (step === "install" && isTv) || ((step === "add" || step === "done") && app === "koala");
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

  const copy = async () => {
    if (!link) return;
    if (await copyText(link)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const back = step === "pick" || step === "install" || step === "add" || step === "link" || step === "region";
  const goBack = () => {
    setErr("");
    if (step === "add" || step === "region") setStep("install");
    else if (step === "install") setStep(isTv ? "device" : "pick");
    else if (step === "link") setStep("pick");
    else setStep("device");
  };
  useTgBack(() => { if (busy) return; if (back) goBack(); else onClose(); });

  const title = step === "device" ? "Куда добавить"
    : step === "pick" ? "Приложение"
    : step === "link" ? "Ссылка на подписку"
    : step === "done" ? "Подписка добавлена"
    : step === "region" ? "Регион App Store"
    : step === "install" && isTv ? "Happ" : APP_META[app || "incy"].title;

  const linkBox = (
    <div
      style={{
        marginTop: 16,
        padding: "14px 16px",
        borderRadius: 16,
        border: `1px solid ${BORDER}`,
        background: CELL_BG,
        color: err && !link ? C.danger : TEXT,
        fontSize: 14,
        lineHeight: "20px",
        wordBreak: "break-all",
        userSelect: "all",
      }}
    >
      {linkLoading ? "Загрузка…" : link || err || "—"}
    </div>
  );

  return (
    <div
      onClick={() => !busy && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: FGN_DIM,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        animation: "fgnFade 0.2s ease both",
        fontFamily: C.font,
      }}
    >
      <style>{KEYFRAMES}</style>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "90%",
          overflowY: "auto",
          background: SHEET_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: "24px 24px 0 0",
          padding: "20px 20px",
          paddingBottom: "calc(20px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
          boxSizing: "border-box",
          color: TEXT,
          animation: "fgnSheetUp 0.32s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {/* шапка: заголовок 18/600 + круглая кнопка 40 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, height: 40 }}>
          {back ? <RoundBtn icon="back" label="Назад" onClick={goBack} /> : null}
          {(step === "install" || step === "add") && (app || isTv) ? <AppIcon app={isTv ? "happ" : (app || "happ")} size={32} /> : null}
          <div style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 600, lineHeight: "24px", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </div>
          <RoundBtn icon="close" label="Закрыть" onClick={() => !busy && onClose()} />
        </div>

        {step === "device" && (
          <>
            {note ? (
              <div
                style={{
                  marginTop: 15, padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(52,214,124,.35)",
                  background: "rgba(52,214,124,.08)", color: TEXT, fontSize: 14, lineHeight: "20px",
                }}
              >
                {note}
              </div>
            ) : null}
            <div style={{ ...hint, marginTop: 15 }}>На каком устройстве будете пользоваться?</div>
            <div style={{ marginTop: 16.5, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", columnGap: 9, rowGap: 8 }}>
              {DEVICES.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="blin-press"
                  onClick={() => { setDevice(d); setErr(""); setStep(d === "android_tv" ? "install" : "pick"); }}
                  style={{
                    ...cell,
                    height: 82,
                    paddingTop: 15,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 7,
                  }}
                >
                  <FgnIcon name={DEVICE_ICON[d]} size={22} stroke={1.6} />
                  <span style={{ fontSize: 14, fontWeight: 400, lineHeight: "18px", whiteSpace: "nowrap" }}>{DEVICE_TITLE[d]}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "pick" && (
          <>
            <div style={{ ...hint, marginTop: 15 }}>Выберите приложение для {DEVICE_TITLE[device]}.</div>
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
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
                      ...cell, width: "100%", minHeight: 68, padding: "0 16px", display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                      ...(rec ? { border: "1px solid rgba(52,214,124,.45)", background: "rgba(52,214,124,.06)" } : {}),
                    }}
                  >
                    <AppIcon app={a} />
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 16, fontWeight: 500, lineHeight: "20px" }}>{m.title}</span>
                      <span style={{ fontSize: 13, lineHeight: "18px", color: rec ? C.green : MUTED }}>{appSub(a, device)}</span>
                    </span>
                    <FgnIcon name="chevron" size={17} stroke={2.2} style={{ color: "#6E6E78" }} />
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === "install" && isTv && (
          <>
            {[
              "На телевизоре откройте Google Play и установите Happ.",
              "В Happ добавьте подписку вручную (кнопка «+») и введите ссылку:",
            ].map((text, i) => (
              <div key={i} style={{ marginTop: i ? 10 : 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ width: 24, height: 24, borderRadius: 12, background: ROUND_BTN, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {i + 1}
                </span>
                <span style={{ ...hint, paddingTop: 2 }}>{text}</span>
              </div>
            ))}
            {linkBox}
            <div style={{ ...hint, marginTop: 10, fontSize: 13, textAlign: "center" }}>Вводите внимательно: важны заглавные и строчные буквы.</div>
          </>
        )}

        {step === "install" && !isTv && app && (
          <>
            {app === "koala" && KOALA_GUIDE[device] ? (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                {KOALA_GUIDE[device]!.map((t, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span style={stepNum}>{i + 1}</span>
                    <span style={{ ...hint, paddingTop: 2 }}>{t}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ ...hint, marginTop: 15 }}>Скачайте и установите {APP_META[app].title} на {DEVICE_TITLE[device]}.</div>
            )}
            {installOptions(app, device).map((o, i) => i === 0 ? (
              <button key={o.url} type="button" className="blin-press" style={{ ...mainBtn, marginTop: 20, gap: 8 }} onClick={() => open(o.url)}>
                <FgnIcon name="download" size={18} stroke={2} /> {o.label}
              </button>
            ) : (
              <button key={o.url} type="button" className="blin-press" onClick={() => open(o.url)}
                style={{ ...cell, width: "100%", marginTop: 8, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, textAlign: "left", fontSize: 14, color: MUTED, borderRadius: 14 }}>
                <FgnIcon name="download" size={16} stroke={2} />
                <span style={{ flex: 1, minWidth: 0 }}>{o.label}</span>
                <FgnIcon name="chevron" size={15} stroke={2.2} style={{ color: "#6E6E78" }} />
              </button>
            ))}
            <button type="button" className="blin-press" style={{ ...ghostBtn, marginTop: 8 }} onClick={() => { setErr(""); setStep("add"); }}>
              Уже установлено — далее
            </button>
            {device === "ios" ? (
              <button
                type="button"
                className="blin-press"
                onClick={() => setStep("region")}
                style={{
                  ...cell, width: "100%", marginTop: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                  borderStyle: "dashed", background: "transparent", color: MUTED, fontSize: 13.5, lineHeight: "19px", borderRadius: 14,
                }}
              >
                <FgnIcon name="globe" size={20} stroke={1.7} />
                <span style={{ flex: 1, minWidth: 0 }}><b style={strong}>Нет в App Store?</b> Как сменить регион на США</span>
                <FgnIcon name="chevron" size={17} stroke={2.2} style={{ color: "#6E6E78" }} />
              </button>
            ) : null}
          </>
        )}

        {step === "add" && app && (
          <>
            <div style={{ ...hint, marginTop: 15 }}>
              {app === "koala"
                ? "Откройте мини-приложение на этом компьютере и нажмите кнопку — Koala Clash предложит добавить профиль, нажмите «Да»."
                : `Нажмите кнопку — подписка сама добавится в ${APP_META[app].title}. После этого откройте приложение и подключитесь.`}
            </div>
            <button type="button" className="blin-press" disabled={busy} style={{ ...mainBtn, marginTop: 20, opacity: busy ? 0.6 : 1 }} onClick={() => void add()}>
              {busy ? "Открываем…" : "Добавить подписку"}
            </button>
            {err && app !== "koala" ? <div style={{ marginTop: 10, fontSize: 13, color: C.danger, textAlign: "center" }}>{err}</div> : null}
            {app === "koala" ? (
              <>
                <div style={{ ...hint, marginTop: 18 }}>
                  Настраиваете с телефона? Скопируйте ссылку и вставьте её в Koala Clash: <b style={strong}>Профили → «+»</b>.
                </div>
                {linkBox}
                <button type="button" className="blin-press" disabled={!link} style={{ ...ghostBtn, marginTop: 8, gap: 8, opacity: link ? 1 : 0.6 }} onClick={() => void copy()}>
                  <FgnIcon name={copied ? "check" : "copy"} size={18} stroke={2} /> {copied ? "Скопировано" : "Скопировать ссылку"}
                </button>
              </>
            ) : null}
          </>
        )}

        {step === "region" && (
          <>
            <RegionSteps />
            <button type="button" className="blin-press" style={{ ...mainBtn, marginTop: 20 }} onClick={() => setStep("install")}>
              Регион сменил — к установке
            </button>
          </>
        )}

        {step === "link" && (
          <>
            <div style={{ ...hint, marginTop: 15 }}>Скопируйте ссылку и добавьте её в своё VPN-приложение как подписку.</div>
            {linkBox}
            <button type="button" className="blin-press" disabled={!link} style={{ ...mainBtn, marginTop: 20, gap: 8, opacity: link ? 1 : 0.6 }} onClick={() => void copy()}>
              <FgnIcon name={copied ? "check" : "copy"} size={18} stroke={2} /> {copied ? "Скопировано" : "Скопировать ссылку"}
            </button>
          </>
        )}

        {step === "done" && app && (
          <>
            <div style={{ ...hint, marginTop: 15 }}>
              {app === "koala"
                ? "В Koala Clash подтвердите добавление профиля, выберите его и включите подключение."
                : `Откройте ${APP_META[app].title} и нажмите «Подключиться».`}
            </div>
            <button type="button" className="blin-press" style={{ ...mainBtn, marginTop: 20 }} onClick={onClose}>Готово</button>
            <button type="button" className="blin-press" style={{ ...ghostBtn, marginTop: 8 }} onClick={() => void add()}>Не добавилась? Ещё раз</button>
          </>
        )}
      </div>
    </div>
  );
}
