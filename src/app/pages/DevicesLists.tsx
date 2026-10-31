import React, { useEffect, useState } from "react";
import { useSmartBack } from "../utils/navigation";
import { appFetch, revokeDevice } from "../utils/api";
import ReissueKey from "../components/ReissueKey";
import { btnReset } from "../components/ui";
import { N, NoirBack, NoirButton, NoirScreen, NoirSheet } from "../components/noir";

type Device = { id?: string | number; name?: string; platform?: string; last_seen?: string; lastSeen?: string };

// «iOS · iPhone 15» → «iPhone 15»; платформа без модели → красивое имя
function deviceTitle(d: Device, idx: number): string {
  const raw = (d.name || "").trim();
  const parts = raw.split("·").map((x) => x.trim()).filter(Boolean);
  const model = parts.length > 1 ? parts[parts.length - 1] : "";
  if (model) return model;
  const p = (d.platform || parts[0] || "").toLowerCase();
  if (p.includes("ios") || p.includes("iphone")) return "iPhone";
  if (p.includes("ipad")) return "iPad";
  if (p.includes("android")) return "Android";
  if (p.includes("windows")) return "Windows";
  if (p.includes("mac")) return "Mac";
  if (p.includes("linux")) return "Linux";
  return raw || `Устройство ${idx + 1}`;
}

export default function DevicesLists() {
  const goBack = useSmartBack("/subscription");
  const [devices, setDevices] = useState<Device[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmDev, setConfirmDev] = useState<{ id: string; title: string } | null>(null);
  const [reissue, setReissue] = useState(false);

  const load = async () => {
    try {
      const data = await appFetch<{ devices?: Device[]; used?: number; limit?: number }>("/devices");
      setDevices(Array.isArray(data?.devices) ? data.devices : []);
      if (data?.limit != null) setLimit(Number(data.limit));
    } catch {
      setDevices([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const doRemove = async () => {
    if (!confirmDev || removing) return;
    const id = confirmDev.id;
    setConfirmDev(null);
    setRemoving(id);
    const ok = await revokeDevice(id);
    if (ok) setDevices((list) => list.filter((d) => String(d.id ?? "") !== id));
    setRemoving(null);
    if (ok) void load();
  };

  const rise = (i: number): React.CSSProperties => ({ animation: `blinvpnRise 0.55s var(--ease-out) ${0.04 * i}s both` });

  return (
    <NoirScreen dim={0.5}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, paddingTop: 20, marginBottom: 26 }}>
        <NoirBack onClick={goBack} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", color: N.text, lineHeight: 1.1 }}>
          Устройства
        </div>
        {limit != null ? (
          <span style={{ fontSize: 15, color: N.dim, fontVariantNumeric: "tabular-nums" }}>
            {devices.length}/{limit}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div style={{ fontSize: 15.5, color: N.muted, padding: "8px 0 20px" }}>Загрузка…</div>
      ) : devices.length === 0 ? (
        <div style={{ ...rise(0), fontSize: 15.5, lineHeight: 1.5, color: N.muted, padding: "4px 0 22px", borderBottom: `1px solid ${N.divider}` }}>
          Пока нет подключённых устройств.
          <br />
          Они появятся здесь после первого подключения к VPN.
        </div>
      ) : (
        <div>
          {devices.map((d, idx) => {
            const id = String(d.id ?? "");
            const title = deviceTitle(d, idx);
            const busy = removing === id;
            return (
              <div
                key={id || idx}
                style={{
                  ...rise(idx),
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 57,
                  borderBottom: `1px solid ${N.divider}`,
                  opacity: busy ? 0.45 : 1,
                  transition: "opacity 0.2s ease",
                }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 17, color: N.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {title}
                </span>
                <button
                  type="button"
                  disabled={!id || busy}
                  onClick={() => setConfirmDev({ id, title })}
                  className="blin-press"
                  style={{
                    ...btnReset,
                    fontFamily: N.font,
                    background: "transparent",
                    border: "none",
                    padding: "10px 0 10px 12px",
                    fontSize: 15.5,
                    color: N.redText,
                    cursor: "pointer",
                  }}
                >
                  {busy ? "Удаляем…" : "Удалить"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ ...rise(devices.length + 1), marginTop: 32 }}>
        <NoirButton onClick={() => setReissue(true)}>Сбросить ключ</NoirButton>
      </div>

      {confirmDev ? (
        <NoirSheet title="Удалить устройство?" onClose={() => setConfirmDev(null)}>
          <div style={{ fontSize: 15, lineHeight: 1.5, color: N.muted, marginBottom: 20 }}>
            «{confirmDev.title}» будет отвязано от подписки и освободит место. Чтобы снова пользоваться VPN на нём, достаточно просто подключиться.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <NoirButton primary onClick={() => void doRemove()}>Удалить</NoirButton>
            <NoirButton onClick={() => setConfirmDev(null)}>Отмена</NoirButton>
          </div>
        </NoirSheet>
      ) : null}

      {reissue ? <ReissueKey onClose={() => setReissue(false)} onDone={() => { setDevices([]); void load(); }} /> : null}
    </NoirScreen>
  );
}
