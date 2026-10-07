import React, { useEffect, useState } from "react";
import { useSmartBack } from "../utils/navigation";
import { appFetch, reissueKey, revokeDevice } from "../utils/api";
import { copyText } from "../components/SubLinkBox";
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
  const [reissue, setReissue] = useState<null | "confirm" | "busy" | { link: string } | { error: string }>(null);
  const [copied, setCopied] = useState(false);

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

  const doReissue = async () => {
    setReissue("busy");
    try {
      const r = await reissueKey();
      setReissue({ link: r.subscription_url || "" });
      setDevices([]);
      void load();
    } catch (e) {
      setReissue({ error: e instanceof Error ? e.message : "Не удалось перевыпустить ключ. Попробуйте позже." });
    }
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
        <NoirButton onClick={() => setReissue("confirm")}>Перевыпустить ключ</NoirButton>
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

      {reissue === "confirm" || reissue === "busy" ? (
        <NoirSheet title="Перевыпустить ключ?" onClose={() => { if (reissue !== "busy") setReissue(null); }}>
          <div style={{ fontSize: 15, lineHeight: 1.5, color: N.muted, marginBottom: 20 }}>
            Старый ключ перестанет работать, а все устройства отвяжутся. Новый ключ нужно будет заново добавить в приложение на каждом устройстве.
            <br />
            <br />
            Делайте это, если ключ попал к посторонним.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <NoirButton primary disabled={reissue === "busy"} onClick={() => void doReissue()}>
              {reissue === "busy" ? "Перевыпускаем…" : "Перевыпустить"}
            </NoirButton>
            <NoirButton disabled={reissue === "busy"} onClick={() => setReissue(null)}>Отмена</NoirButton>
          </div>
        </NoirSheet>
      ) : null}

      {reissue && typeof reissue === "object" ? (
        <NoirSheet title={"error" in reissue ? "Не получилось" : "Ключ перевыпущен"} onClose={() => { setReissue(null); setCopied(false); }}>
          {"error" in reissue ? (
            <>
              <div style={{ fontSize: 15, lineHeight: 1.5, color: N.muted, marginBottom: 20 }}>{reissue.error}</div>
              <NoirButton onClick={() => setReissue(null)}>Закрыть</NoirButton>
            </>
          ) : (
            <>
              <div style={{ fontSize: 15, lineHeight: 1.5, color: N.muted, marginBottom: 14 }}>
                Старый ключ больше не работает. Скопируйте новый и добавьте его в приложение.
              </div>
              {reissue.link ? (
                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: `1px solid ${N.cardBorder}`,
                    borderRadius: 16,
                    padding: "12px 14px",
                    fontSize: 13,
                    lineHeight: 1.45,
                    color: N.muted,
                    wordBreak: "break-all",
                    userSelect: "all",
                    WebkitUserSelect: "all",
                    marginBottom: 14,
                  }}
                >
                  {reissue.link}
                </div>
              ) : null}
              <NoirButton
                primary
                disabled={!reissue.link}
                icon={copied ? "check" : "content_copy"}
                onClick={() => { void copyText(reissue.link).then((ok) => ok && setCopied(true)); }}
              >
                {copied ? "Скопировано" : "Скопировать ключ"}
              </NoirButton>
            </>
          )}
        </NoirSheet>
      ) : null}
    </NoirScreen>
  );
}
