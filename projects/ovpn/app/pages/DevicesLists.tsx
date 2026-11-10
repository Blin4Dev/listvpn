import React, { useEffect, useState } from "react";
import { useSmartBack } from "../utils/navigation";
import { appFetch, revokeDevice } from "../utils/api";
import ReissueKey from "../components/ReissueKey";
import { useNavigate } from "react-router-dom";
import { btnReset } from "../components/ui";
import { NoirButton, NoirSheet, useTgBack } from "../components/noir";
import { O, OBack, OButton, OCard, OIcon, OScreen } from "../components/ovpn";

// O-VPN: 13 «Устройства · пусто», 14 «Устройства · список», 38 «Ключ перевыпущен»

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
  const navigate = useNavigate();
  useTgBack(goBack);
  const [devices, setDevices] = useState<Device[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmDev, setConfirmDev] = useState<{ id: string; title: string } | null>(null);
  const [reissue, setReissue] = useState(false);
  // гость семьи видит устройства общей подписки, но отвязывает их только владелец
  const [canDelete, setCanDelete] = useState(true);

  const load = async () => {
    try {
      const data = await appFetch<{ devices?: Device[]; used?: number; limit?: number; can_delete?: boolean }>("/devices");
      setCanDelete(data?.can_delete !== false);
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

  // дата подключения: «27 окт. 2026»
  const seen = (d: Device) => {
    const v = d.last_seen || d.lastSeen;
    if (!v) return "";
    try { return new Date(v).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }).replace(/\s*г\.?$/, ""); } catch { return ""; }
  };
  const platform = (d: Device) => {
    const p = (d.platform || (d.name || "").split("·")[0] || "").trim();
    const l = p.toLowerCase();
    if (l.includes("ios") || l.includes("iphone")) return "iOS";
    if (l.includes("android")) return "Android";
    if (l.includes("windows")) return "Windows";
    if (l.includes("mac")) return "macOS";
    if (l.includes("linux")) return "Linux";
    return p;
  };
  const iconOf = (d: Device) => {
    const l = `${d.platform || ""} ${d.name || ""}`.toLowerCase();
    return l.includes("windows") || l.includes("mac") || l.includes("linux") ? "monitor" : "smartphone";
  };

  return (
    <OScreen>
      <OBack onClick={goBack} />
      <div style={{ paddingTop: 12, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: 30, fontWeight: 800, lineHeight: "30px" }}>Устройства</div>
        {limit != null ? <span style={{ fontSize: 14, lineHeight: "20px", color: O.muted, fontVariantNumeric: "tabular-nums" }}>{devices.length}/{limit}</span> : null}
      </div>

      {loading ? (
        <div style={{ paddingTop: 16, fontSize: 14, color: O.muted }}>Загрузка…</div>
      ) : devices.length === 0 ? (
        <div style={{ ...rise(0), flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingBottom: 60 }}>
          <div style={{ maxWidth: 320, fontSize: 16, lineHeight: "24px", color: O.muted, textAlign: "center" }}>
            Пока нет подключённых устройств. Они появятся здесь после первого подключения к VPN.
          </div>
          {canDelete ? (
            <div style={{ paddingTop: 32 }}>
              <OButton tone="dark" style={{ width: "auto", padding: "0 32px" }} onClick={() => setReissue(true)}>Перевыпустить ключ</OButton>
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ paddingTop: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {devices.map((d, idx) => {
              const id = String(d.id ?? "");
              const title = deviceTitle(d, idx);
              const busy = removing === id;
              const sub = [platform(d), seen(d)].filter(Boolean).join(" · ");
              return (
                <OCard key={id || idx} style={{ ...rise(idx), display: "flex", alignItems: "center", gap: 12, minHeight: 78, opacity: busy ? 0.45 : 1, transition: "opacity 0.2s ease" }}>
                  <OIcon name={iconOf(d)} size={20} color={O.muted} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 600, lineHeight: "24px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
                    {sub ? <div style={{ fontSize: 14, lineHeight: "20px", color: O.muted }}>{sub}</div> : null}
                  </div>
                  {canDelete ? (
                    <button
                      type="button"
                      aria-label="Удалить устройство"
                      disabled={!id || busy}
                      onClick={() => setConfirmDev({ id, title })}
                      className="blin-press"
                      style={{ ...btnReset, width: 20, height: 20, padding: 0, border: "none", background: "transparent", color: O.muted, cursor: "pointer" }}
                    >
                      <OIcon name="trash-2" size={20} />
                    </button>
                  ) : null}
                </OCard>
              );
            })}
          </div>
          <div style={{ ...rise(devices.length + 1), display: "flex", flexDirection: "column", gap: 12, paddingTop: 12 }}>
            <OButton tone="red" onClick={() => navigate("/subscription?setup=1")}>Подключить это устройство</OButton>
            {canDelete ? <OButton tone="dark" onClick={() => setReissue(true)}>Перевыпустить ключ</OButton> : (
              <div style={{ fontSize: 14, lineHeight: "20px", color: O.muted }}>Устройства общие для семьи — отвязывает их владелец подписки.</div>
            )}
          </div>
        </div>
      )}

      {confirmDev ? (
        <NoirSheet title="Удалить устройство?" onClose={() => setConfirmDev(null)}>
          <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted }}>
            «{confirmDev.title}» будет отвязано от подписки и освободит место. Чтобы снова пользоваться VPN на нём, достаточно просто подключиться.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16 }}>
            <NoirButton primary onClick={() => void doRemove()}>Удалить</NoirButton>
            <NoirButton onClick={() => setConfirmDev(null)}>Отмена</NoirButton>
          </div>
        </NoirSheet>
      ) : null}
      {reissue ? <ReissueKey onClose={() => setReissue(false)} onDone={() => { setDevices([]); void load(); }} /> : null}
    </OScreen>
  );
}
