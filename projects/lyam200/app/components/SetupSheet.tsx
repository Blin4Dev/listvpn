import { useEffect, useState } from "react";
import { useTgBack } from "./noir";
import { O, OSheet } from "./lyam";
import { fetchAppLink } from "../utils/api";
import { DEVICE_TITLE, type DeviceKind } from "../utils/apps";
import { CopyButton, KeySteps, OLinkField } from "../pages/ManageSubscription";

// ЛЯМ200: 13 «Добавить подписку» — выбор устройства, 14 — шаги и ключ для этого устройства

const DEVICES: DeviceKind[] = ["ios", "android", "windows", "macos", "linux", "android_tv"];

export default function SetupSheet({ onClose }: { onClose: () => void }) {
  const [device, setDevice] = useState<DeviceKind | null>(null);
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!device || link) return;
    let alive = true;
    setErr("");
    fetchAppLink("other")
      .then((r) => { if (alive) setLink(r.link); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Не удалось получить ключ"); });
    return () => { alive = false; };
  }, [device, link]);

  useTgBack(() => { if (device) setDevice(null); else onClose(); });

  return (
    <OSheet title="Добавить подписку" onClose={onClose}>
      {!device ? (
        <>
          <div style={{ paddingTop: 12, fontSize: 14, lineHeight: "20px", color: O.muted }}>На каком устройстве будете пользоваться VPN?</div>
          <div style={{ paddingTop: 16, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {DEVICES.map((d) => (
              <button
                key={d}
                type="button"
                className="blin-press"
                onClick={() => setDevice(d)}
                style={{
                  appearance: "none", WebkitAppearance: "none", WebkitTapHighlightColor: "transparent", outline: "none", margin: 0,
                  boxSizing: "border-box", height: 52, border: "none", borderRadius: 16, background: O.bg, color: O.text,
                  fontFamily: O.font, fontSize: 14, lineHeight: "20px", cursor: "pointer", padding: "0 4px",
                }}
              >
                {DEVICE_TITLE[d]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={{ paddingTop: 12, fontSize: 14, lineHeight: "20px", color: O.muted }}>Устройство: {DEVICE_TITLE[device]}</div>
          <KeySteps style={{ paddingTop: 12 }} />
          <div style={{ paddingTop: 12 }}><OLinkField text={err || link || "Получаем ключ…"} error={!!err} /></div>
          <div style={{ paddingTop: 16 }}><CopyButton text={link} label="Скопировать ключ" /></div>
        </>
      )}
    </OSheet>
  );
}
