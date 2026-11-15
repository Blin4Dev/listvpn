import React, { useEffect, useState } from "react";
import { useTgBack } from "./noir";
import { O, OButton, OIcon } from "./hustler";
import { fetchAppLink } from "../utils/api";
import { copyText } from "./SubLinkBox";
import { DEVICE_TITLE, detectDeviceKind, type DeviceKind } from "../utils/apps";

// Hustler: 42–45 «Добавить подписку» — устройство → приложение → ключ → готово

type Step = 1 | 2 | 3 | 4;

const DEVICES: DeviceKind[] = ["ios", "android", "windows", "macos", "linux", "android_tv"];
const DEVICE_ICON: Record<DeviceKind, string> = {
  ios: "smartphone",
  android: "smartphone",
  windows: "monitor",
  macos: "laptop",
  linux: "terminal",
  android_tv: "tv",
};
const APPS = ["Happ", "INCY", "v2RayTun", "Hiddify"] as const;
type AppName = (typeof APPS)[number];

const press: React.CSSProperties = {
  appearance: "none", WebkitAppearance: "none", WebkitTapHighlightColor: "transparent", outline: "none", margin: 0,
  boxSizing: "border-box", fontFamily: O.font, cursor: "pointer",
};

function Tile({ on, onClick, style, children }: { on: boolean; onClick: () => void; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="blin-press"
      onClick={onClick}
      style={{
        ...press, border: "none", borderRadius: 21.6, background: "rgba(0, 0, 0, 0.3)",
        boxShadow: on ? `0 0 0 2px ${O.red}` : "none", color: O.text,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", ...style,
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="blin-press"
      onClick={onClick}
      style={{ ...press, width: "100%", height: 56, marginTop: 12, border: "none", borderRadius: 18.4, background: "transparent", color: O.dim, fontSize: 18, fontWeight: 700, lineHeight: "28px" }}
    >
      {children}
    </button>
  );
}

export default function SetupSheet({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [device, setDevice] = useState<DeviceKind>(() => detectDeviceKind());
  const [app, setApp] = useState<AppName>("Happ");
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (step !== 3 || link) return;
    let alive = true;
    setErr("");
    fetchAppLink("other")
      .then((r) => { if (alive) setLink(r.link); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Не удалось получить ключ"); });
    return () => { alive = false; };
  }, [step, link]);

  const back = () => setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  useTgBack(() => { if (step === 2 || step === 3) back(); else onClose(); });

  const copyAndGo = async () => {
    if (!link) return;
    if (await copyText(link)) setStep(4);
  };

  const dev = DEVICE_TITLE[device];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 12,
        paddingBottom: "calc(12px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
        boxSizing: "border-box", animation: "blinvpnFadeIn 0.2s ease both", fontFamily: O.font,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 366, maxHeight: "100%", overflowY: "auto", boxSizing: "border-box",
          background: "#141414", borderRadius: 21.6, boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.1)",
          padding: 20, color: O.text, animation: "blinvpnSheetUp 0.28s var(--ease-out) both",
        }}
      >
        {/* шапка: заголовок в 2 строки, «Шаг N из 4», × */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ width: 215, flex: "none", fontSize: 24, fontWeight: 800, lineHeight: "30px" }}>Добавить подписку</div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
            <span style={{ fontSize: 14, lineHeight: "20px", color: O.muted }}>Шаг {step} из 4</span>
            <button
              type="button"
              aria-label="Закрыть"
              className="blin-press"
              onClick={onClose}
              style={{ ...press, width: 32, height: 36, flex: "none", border: "none", borderRadius: 999, background: "rgba(255, 255, 255, 0.1)", color: O.text, fontSize: 16, lineHeight: "24px", padding: 0 }}
            >
              ×
            </button>
          </div>
        </div>

        {step === 1 && (
          <>
            <div style={{ paddingTop: 12, fontSize: 16, lineHeight: "24px", color: O.dim }}>На каком устройстве будете пользоваться VPN?</div>
            <div style={{ paddingTop: 16, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {DEVICES.map((d) => (
                <Tile key={d} on={d === device} onClick={() => setDevice(d)} style={{ aspectRatio: "1 / 1", gap: 8 }}>
                  <OIcon name={DEVICE_ICON[d]} size={28} stroke={2.33} />
                  <span style={{ fontSize: 14, fontWeight: 600, lineHeight: "20px" }}>{DEVICE_TITLE[d]}</span>
                </Tile>
              ))}
            </div>
            <button
              type="button"
              className="blin-press"
              onClick={onClose}
              style={{ ...press, width: "100%", height: 48, marginTop: 16, border: "none", background: "transparent", color: O.muted, fontSize: 16, lineHeight: "24px" }}
            >
              Отмена
            </button>
            <OButton tone="red" onClick={() => setStep(2)}>Дальше</OButton>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ paddingTop: 12, fontSize: 16, lineHeight: "24px", color: O.dim }}>Куда вставить ключ на {dev}?</div>
            <div style={{ paddingTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {APPS.map((a) => (
                <Tile key={a} on={a === app} onClick={() => setApp(a)} style={{ height: 68 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, lineHeight: "28px" }}>{a}</span>
                </Tile>
              ))}
            </div>
            <div style={{ paddingTop: 16 }}><OButton tone="red" onClick={() => setStep(3)}>Дальше</OButton></div>
            <GhostButton onClick={back}>Назад</GhostButton>
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ paddingTop: 12, fontSize: 16, lineHeight: "24px", color: O.dim }}>В {app} на {dev}:</div>
            {["Скопируйте ключ.", `Откройте ${app}.`, "Нажмите «+» и выберите «Вставить из буфера обмена».", "Включите подключение."].map((t, i) => (
              <div key={i} style={{ paddingTop: 12, fontSize: 14, lineHeight: "22.75px", color: O.text }}>{i + 1}. {t}</div>
            ))}
            <div style={{ paddingTop: 16 }}>
              <div
                style={{
                  height: 44, boxSizing: "border-box", padding: 12, borderRadius: 21.6, background: "rgba(0, 0, 0, 0.4)",
                  fontSize: 14, lineHeight: "20px", color: err ? O.danger : O.muted,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", userSelect: "all", WebkitUserSelect: "all",
                }}
              >
                {err || link || "Получаем ключ…"}
              </div>
            </div>
            <div style={{ paddingTop: 16 }}><OButton tone="red" disabled={!link} onClick={() => void copyAndGo()}>Скопировать и продолжить</OButton></div>
            <GhostButton onClick={back}>Назад</GhostButton>
          </>
        )}

        {step === 4 && (
          <div style={{ textAlign: "center" }}>
            <div style={{ paddingTop: 28, display: "flex", justifyContent: "center" }}>
              <div style={{ width: 80, height: 80, borderRadius: "50%", background: O.red, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <OIcon name="check" size={40} color="#FFFFFF" stroke={2.5} />
              </div>
            </div>
            <div style={{ paddingTop: 16, fontSize: 24, fontWeight: 800, lineHeight: "32px" }}>Готово</div>
            <div style={{ paddingTop: 8, fontSize: 16, lineHeight: "24px", color: O.dim }}>
              Ключ для {app} на {dev} скопирован. Устройство появится в списке после первого включения.
            </div>
            <div style={{ paddingTop: 20 }}><OButton tone="red" onClick={onClose}>Закрыть</OButton></div>
          </div>
        )}
      </div>
    </div>
  );
}
