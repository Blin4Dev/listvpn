// FGN: «Устройства» (переопределение src/app/pages/DevicesLists.tsx), макет 52.
// Подпись «Занято N из M. Свободно K.», карточки устройств (78, радиус 16, «Отвязать» красным справа),
// пунктирные «Свободный слот» (54) и светлая кнопка «Докупить слот» (52).
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch, revokeDevice } from "../utils/api";
import { C, FgnDialog, FgnHeader, FgnPage, fgnButton } from "../components/fgn";

const MUTED = "#9B9BA4";
const LABEL = "#6E6E78";
const CARD_BG = "#141416";
const CARD_BORDER = "#2A2A30";
const TEXT = "#F4F4F5";
const RED = "#FF6B6B";

type Device = { id?: string | number; name?: string; platform?: string };
type DevicesResponse = { devices?: Device[]; used?: number; limit?: number; can_buy?: boolean };

/** «iOS · iPhone 15» → заголовок «iPhone 15», подпись «iOS» */
function deviceText(d: Device, idx: number): { title: string; subtitle: string } {
  const raw = (d.name || "").trim();
  const parts = raw.split("·").map((x) => x.trim()).filter(Boolean);
  const platform = (d.platform || (parts.length > 1 ? parts[0] : "")).trim();
  const model = parts.length > 1 ? parts[parts.length - 1] : parts[0] && parts[0] !== platform && parts[0] !== "Устройство" ? parts[0] : "";
  return { title: model || `Устройство ${idx + 1}`, subtitle: platform };
}

/** пунктирная рамка 1px (штрих 2, просвет 1), радиус 16 — как в макете; CSS dashed так не умеет */
function DashedSlot({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const upd = () => setW(el.offsetWidth);
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);
  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        height: 54,
        padding: "0 16px",
        display: "flex",
        alignItems: "center",
        fontSize: 14.5,
        lineHeight: "20px",
        color: LABEL,
        boxSizing: "border-box",
      }}
    >
      {w > 0 ? (
        <svg width={w} height={54} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
          <rect x={0.5} y={0.5} width={w - 1} height={53} rx={15.5} fill="none" stroke={CARD_BORDER} strokeWidth={1} strokeDasharray="2 1" />
        </svg>
      ) : null}
      <span style={{ position: "relative" }}>{children}</span>
    </div>
  );
}

export default function DevicesLists() {
  const navigate = useNavigate();
  const goBack = useSmartBack("/subscription");
  const [devices, setDevices] = useState<Device[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [canBuy, setCanBuy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmDev, setConfirmDev] = useState<{ id: string; title: string } | null>(null);

  const load = async () => {
    try {
      const data = await appFetch<DevicesResponse>("/devices");
      setDevices(Array.isArray(data?.devices) ? data.devices : []);
      if (data?.limit != null) setLimit(Number(data.limit));
      setCanBuy(!!data?.can_buy);
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

  const used = devices.length;
  const free = limit != null ? Math.max(0, limit - used) : 0;
  const fade = (i: number): React.CSSProperties => ({ animation: `fgnFade 0.35s ease ${0.04 * i}s both` });

  return (
    <FgnPage>
      <FgnHeader title="Устройства" onBack={goBack} btnStyle={{ background: CARD_BG, borderColor: CARD_BORDER }} />

      <div style={{ marginTop: 20, fontSize: 14, lineHeight: "20px", color: MUTED }}>
        {loading
          ? "Загрузка…"
          : limit != null
            ? `Занято ${used} из ${limit}. Свободно ${free}.`
            : used
              ? `Занято ${used}.`
              : "Пока нет подключённых устройств."}
      </div>

      {!loading ? (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {devices.map((d, idx) => {
            const id = String(d.id ?? "");
            const { title, subtitle } = deviceText(d, idx);
            const busy = removing === id;
            return (
              <div
                key={id || idx}
                style={{
                  ...fade(idx),
                  height: 78,
                  padding: "0 16px",
                  borderRadius: 16,
                  border: `1px solid ${CARD_BORDER}`,
                  background: CARD_BG,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  boxSizing: "border-box",
                  opacity: busy ? 0.45 : 1,
                  transition: "opacity 0.2s ease",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 500, lineHeight: "20px", color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {title}
                  </div>
                  {subtitle ? (
                    <div style={{ marginTop: 1.5, fontSize: 14, lineHeight: "20px", color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {subtitle}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={!id || busy}
                  onClick={() => setConfirmDev({ id, title })}
                  className="blin-press"
                  style={{
                    appearance: "none",
                    margin: 0,
                    padding: "10px 0 10px 12px",
                    background: "transparent",
                    border: "none",
                    fontFamily: C.font,
                    fontSize: 14.5,
                    lineHeight: "20px",
                    color: RED,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  {busy ? "Отвязываем…" : "Отвязать"}
                </button>
              </div>
            );
          })}
          {Array.from({ length: Math.min(free, 10) }, (_, i) => (
            <div key={`free-${i}`} style={fade(used + i)}>
              <DashedSlot>Свободный слот</DashedSlot>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && canBuy ? (
        <button
          type="button"
          className="blin-press"
          onClick={() => navigate("/subscription/increase")}
          style={{ ...fgnButton, ...fade(used + free), marginTop: 24, flexShrink: 0, height: 52, borderRadius: 16, background: "#F3F3F4", fontSize: 16, letterSpacing: 0 }}
        >
          Докупить слот
        </button>
      ) : null}

      {confirmDev ? (
        <FgnDialog
          text={<>Отвязать «{confirmDev.title}»? Место освободится, а чтобы снова пользоваться VPN на этом устройстве, достаточно просто подключиться.</>}
          primary="Отвязать"
          onPrimary={() => void doRemove()}
          secondary="Отмена"
          onClose={() => setConfirmDev(null)}
        />
      ) : null}
    </FgnPage>
  );
}
