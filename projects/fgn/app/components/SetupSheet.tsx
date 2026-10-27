// FGN: лист «Куда добавить» (макет 49) и дальнейшие шаги установки в том же стиле.
// Логика как в src/app/components/SetupSheet.tsx: устройство → приложение → установка → добавить (tv/другое короче).
import React, { useEffect, useState } from "react";
import { useTgBack } from "./noir";
import { copyText } from "./SubLinkBox";
import { C, FGN_DIM, FgnIcon, fgnButton } from "./fgn";
import { fetchAppLink, openDeepLink } from "../utils/api";
import { APP_META, DEVICE_TITLE, installUrl, type AppKind, type DeviceKind } from "../utils/apps";

type Step = "pick" | "device" | "install" | "add" | "link" | "done";

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

export default function SetupSheet({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("device");
  const [app, setApp] = useState<AppKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [link, setLink] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [device, setDevice] = useState<DeviceKind>("ios");

  const isTv = device === "android_tv";
  const needLink = step === "link" || (step === "install" && isTv);
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

  const install = () => {
    if (!app) return;
    const url = installUrl(app, device);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

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

  const back = step === "pick" || step === "install" || step === "add" || step === "link";
  const goBack = () => {
    setErr("");
    if (step === "add") setStep("install");
    else if (step === "install") setStep(isTv ? "device" : "pick");
    else if (step === "link") setStep("pick");
    else setStep("device");
  };
  useTgBack(() => { if (busy) return; if (back) goBack(); else onClose(); });

  const title = step === "device" ? "Куда добавить"
    : step === "pick" ? "Приложение"
    : step === "link" ? "Ссылка на подписку"
    : step === "done" ? "Подписка добавлена"
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
              {(["incy", "happ", "other"] as const).map((a) => {
                const m = APP_META[a];
                return (
                  <button
                    key={a}
                    type="button"
                    className="blin-press"
                    onClick={() => pick(a)}
                    style={{ ...cell, width: "100%", minHeight: 68, padding: "0 16px", display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}
                  >
                    <AppIcon app={a} />
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 16, fontWeight: 500, lineHeight: "20px" }}>{m.title}</span>
                      <span style={{ fontSize: 13, lineHeight: "18px", color: m.recommended ? C.green : MUTED }}>{m.sub}</span>
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
            <div style={{ ...hint, marginTop: 15 }}>Скачайте и установите {APP_META[app].title} на {DEVICE_TITLE[device]}.</div>
            <button type="button" className="blin-press" style={{ ...mainBtn, marginTop: 20, gap: 8 }} onClick={install}>
              <FgnIcon name="download" size={18} stroke={2} /> Скачать {APP_META[app].title}
            </button>
            <button type="button" className="blin-press" style={{ ...ghostBtn, marginTop: 8 }} onClick={() => { setErr(""); setStep("add"); }}>
              Уже установлено — далее
            </button>
          </>
        )}

        {step === "add" && app && (
          <>
            <div style={{ ...hint, marginTop: 15 }}>
              Нажмите кнопку — подписка сама добавится в {APP_META[app].title}. После этого откройте приложение и подключитесь.
            </div>
            <button type="button" className="blin-press" disabled={busy} style={{ ...mainBtn, marginTop: 20, opacity: busy ? 0.6 : 1 }} onClick={() => void add()}>
              {busy ? "Открываем…" : "Добавить подписку"}
            </button>
            {err ? <div style={{ marginTop: 10, fontSize: 13, color: C.danger, textAlign: "center" }}>{err}</div> : null}
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
            <div style={{ ...hint, marginTop: 15 }}>Откройте {APP_META[app].title} и нажмите «Подключиться».</div>
            <button type="button" className="blin-press" style={{ ...mainBtn, marginTop: 20 }} onClick={onClose}>Готово</button>
            <button type="button" className="blin-press" style={{ ...ghostBtn, marginTop: 8 }} onClick={() => void add()}>Не добавилась? Ещё раз</button>
          </>
        )}
      </div>
    </div>
  );
}
