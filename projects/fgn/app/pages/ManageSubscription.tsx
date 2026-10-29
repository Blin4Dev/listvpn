// FGN: «Настроить подписку» (макет 48; лист «Куда добавить» — 49, лимит устройств — 50) — срок, устройства, трафик, действия цветными строками.
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch, fetchTraffic, formatBytesRu, type TrafficInfo } from "../utils/api";
import { formatDateRu } from "../utils/date";
import SetupSheet from "../components/SetupSheet";
import { C, FgnDialog, FgnHeader, FgnIcon, FgnPage, fgnButton } from "../components/fgn";

type SubResponse = {
  status?: string;
  until?: string | null;
  key?: { devices_limit?: number; no_renew?: boolean; type?: string } | null;
  expired_key?: { expiry_date?: string | null } | null;
  delete_at?: string | null;
  // участник чужой семейной подписки (макет 67); бэкенд семей пока не отдаёт
  family?: { role?: string; owner_name?: string | null } | null;
};
type DevicesResponse = { used?: number; limit?: number; can_buy?: boolean; devices?: unknown[] };

const BUY_PATH = "/tariffs";

// цвета по макету
const MUTED = "#9B9BA4";
const LABEL = "#6E6E78";
const CARD_BG = "#141416";
const CARD_BORDER = "#2A2A30";
const TEXT = "#F4F4F5";

type Tone = "red" | "green" | "yellow" | "gray";
const TONES: Record<Tone, { bg: string; border: string; box: string; icon: string }> = {
  red: { bg: "#241616", border: "#5A3030", box: "#3A2222", icon: "#E7B4B4" },
  green: { bg: "#13241C", border: "#24543A", box: "#1C3A2A", icon: "#B7E7C8" },
  yellow: { bg: "#262014", border: "#5A4C28", box: "#3A3218", icon: "#EAD7A2" },
  gray: { bg: CARD_BG, border: CARD_BORDER, box: "#1E1E22", icon: TEXT },
};

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

function trafficValue(used: number | null | undefined, limit: number | undefined): string {
  const l = Number(limit || 0);
  if (l <= 0) return "без лимита";
  return `${formatBytesRu(Math.max(0, Number(used || 0)))} из ${formatBytesRu(l)}`;
}

/** подпись секции: 12/600, капс, разрядка */
function Section({ children, top }: { children: React.ReactNode; top: number }) {
  return (
    <div
      style={{
        marginTop: top,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: "16px",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: LABEL,
      }}
    >
      {children}
    </div>
  );
}

const card: React.CSSProperties = {
  marginTop: 7.75,
  padding: "15px 16px",
  borderRadius: 16,
  border: `1px solid ${CARD_BORDER}`,
  background: CARD_BG,
  fontSize: 14,
};

function Line({ left, right, warn }: { left: React.ReactNode; right: React.ReactNode; warn?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, height: 32.5, lineHeight: "32.5px", whiteSpace: "nowrap" }}>
      <span style={{ color: MUTED }}>{left}</span>
      <span style={{ color: warn ? C.danger : TEXT, fontWeight: 400, textAlign: "right" }}>{right}</span>
    </div>
  );
}

/** цветная строка-действие: 68 (72 с подписью), иконка в квадрате 40, шеврон справа */
function ActionRow({ tone, icon, title, subtitle, onClick }: { tone: Tone; icon: string; title: string; subtitle?: string; onClick: () => void }) {
  const t = TONES[tone];
  return (
    <button
      type="button"
      className="blin-press"
      onClick={onClick}
      style={{
        appearance: "none",
        margin: 0,
        width: "100%",
        height: subtitle ? 72 : 68.25,
        padding: "0 16px",
        borderRadius: 16,
        border: `1px solid ${t.border}`,
        background: t.bg,
        color: TEXT,
        fontFamily: C.font,
        display: "flex",
        alignItems: "center",
        gap: 12,
        textAlign: "left",
        cursor: "pointer",
        boxSizing: "border-box",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: 12,
          background: t.box,
          color: t.icon,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <FgnIcon name={icon} size={19} stroke={2.2} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2.75 }}>
        <span style={{ fontSize: 16, fontWeight: 500, lineHeight: "20px", letterSpacing: "-0.005em" }}>{title}</span>
        {subtitle ? <span style={{ fontSize: 14, lineHeight: "18px", color: MUTED }}>{subtitle}</span> : null}
      </span>
      <FgnIcon name="chevron" size={17} stroke={2.5} style={{ color: LABEL }} />
    </button>
  );
}

export default function ManageSubscription() {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useSmartBack("/");

  const [untilIso, setUntilIso] = useState<string | null>(null);
  const [expiredAt, setExpiredAt] = useState<string | null>(null);
  const [deleteAt, setDeleteAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [noRenew, setNoRenew] = useState(false);
  const [isTrial, setIsTrial] = useState(false);
  const [traffic, setTraffic] = useState<TrafficInfo | null>(null);
  const [devices, setDevices] = useState<DevicesResponse | null>(null);
  const [keyLimit, setKeyLimit] = useState<number | null>(null);
  const [setup, setSetup] = useState(false);
  const [limitDlg, setLimitDlg] = useState(false);
  const [family, setFamily] = useState<{ ownerName: string } | null>(null);
  const [leaveDlg, setLeaveDlg] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => { void fetchTraffic().then(setTraffic); }, []);
  useEffect(() => {
    appFetch<DevicesResponse>("/devices").then(setDevices).catch(() => { /* нет данных */ });
  }, []);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("setup") === "1") setSetup(true);
  }, [location.search]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await appFetch<SubResponse>("/subscription");
        if (data.status === "expired") {
          setExpiredAt(data.expired_key?.expiry_date || new Date().toISOString());
          setDeleteAt(data.delete_at || null);
          return;
        }
        if (!data.until) {
          navigate("/", { replace: true });
          return;
        }
        setUntilIso(data.until);
        setNoRenew(!!data.key?.no_renew);
        setIsTrial(data.key?.type === "trial" || data.status === "trial");
        if (data.key?.devices_limit) setKeyLimit(Number(data.key.devices_limit));
        if (data.family?.role === "member") setFamily({ ownerName: String(data.family.owner_name || "") });
      } catch { /* нет данных */ } finally {
        setLoaded(true);
      }
    })();
  }, [navigate]);

  const msLeft = untilIso ? new Date(untilIso).getTime() - now : 0;
  useEffect(() => {
    if (untilIso && msLeft <= 0 && !expiredAt) {
      setExpiredAt(untilIso);
      setDeleteAt(new Date(new Date(untilIso).getTime() + 7 * 86_400_000).toISOString());
    }
  }, [msLeft, untilIso, expiredAt]);

  const closeSetup = () => {
    setSetup(false);
    if (new URLSearchParams(location.search).has("setup")) navigate("/subscription", { replace: true });
  };

  // «Выйти из семьи?» → «Выйти» (макет 66)
  const leaveFamily = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await appFetch("/family/leave", { method: "POST" });
      setLeaveDlg(false);
      navigate("/", { replace: true });
    } catch {
      setLeaving(false);
    }
  };

  // ── истекла ──
  if (expiredAt) {
    const deleteIn = deleteAt ? Math.max(1, Math.ceil((new Date(deleteAt).getTime() - Date.now()) / 86_400_000)) : null;
    return (
      <FgnPage>
        <FgnHeader title="Настроить подписку" onBack={goBack} btnStyle={{ background: CARD_BG, borderColor: CARD_BORDER }} />
        <div style={{ marginTop: 18.75, fontSize: 50, fontWeight: 700, lineHeight: "50px", letterSpacing: "-0.03em", color: C.danger }}>Истекла</div>
        <div style={{ marginTop: 3.75, fontSize: 14, lineHeight: "18px", color: MUTED }}>закончилась {formatDateRu(expiredAt)} г.</div>
        {deleteIn != null ? (
          <div style={{ ...card, marginTop: 25.75, lineHeight: "20px", color: MUTED }}>
            Продлите подписку — иначе через {deleteIn} {plural(deleteIn, "день", "дня", "дней")} она будет удалена вместе с настройками в приложении.
          </div>
        ) : null}
        <button type="button" className="blin-press" style={{ ...fgnButton, marginTop: 17, borderRadius: 16 }} onClick={() => navigate(BUY_PATH)}>
          Продлить подписку
        </button>
      </FgnPage>
    );
  }

  const days = Math.max(0, Math.floor(msLeft / 86_400_000));
  const hours = Math.max(1, Math.ceil(msLeft / 3_600_000));
  const [bigNum, bigUnit] = days >= 1
    ? [days, plural(days, "день", "дня", "дней")]
    : [hours, plural(hours, "час", "часа", "часов")];

  const limit = devices?.limit ?? keyLimit ?? 0;
  const used = devices?.used ?? 0;
  const free = Math.max(0, limit - used);
  const canBuyDevices = !isTrial && (devices?.can_buy ?? true);
  const mainTraffic = traffic?.available ? trafficValue(traffic.used_bytes, traffic.limit_bytes) : "без лимита";
  const mainOver = !!(traffic?.available && traffic.limit_bytes && (traffic.used_bytes || 0) >= traffic.limit_bytes);

  // макет 50: все места заняты — вместо листа «Куда добавить» диалог с докупкой
  const addSubscription = () => {
    if (devices && limit > 0 && used >= limit) setLimitDlg(true);
    else setSetup(true);
  };

  const fade: React.CSSProperties = { animation: "fgnFade 0.35s ease both" };

  return (
    <FgnPage>
      <FgnHeader title="Настроить подписку" onBack={goBack} btnStyle={{ background: CARD_BG, borderColor: CARD_BORDER }} />

      <div style={loaded ? fade : { opacity: 0 }}>
        <div style={{ marginTop: 18.75, height: 50, fontSize: 50, lineHeight: "50px", whiteSpace: "nowrap" }}>
          <span style={{ fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{bigNum}</span>
          <span style={{ marginLeft: 8, fontSize: 24, lineHeight: "24px", fontWeight: 600, letterSpacing: "-0.01em" }}>{bigUnit}</span>
        </div>
        <div style={{ marginTop: 3.75, fontSize: 14, lineHeight: "18px", color: MUTED }}>
          {untilIso ? `до ${formatDateRu(untilIso)} г.` : " "}
        </div>

        <Section top={25.75}>Устройства</Section>
        <div style={card}>
          <Line
            left={devices || keyLimit ? `${used} из ${limit}` : "—"}
            right={limit > 0 ? `свободно ${free}` : ""}
          />
          {limit > 0 ? (
            <div style={{ marginTop: 4.5, lineHeight: "20px", color: MUTED }}>
              {limit} {plural(limit, "устройство входит", "устройства входят", "устройств входят")} в тариф.
              {canBuyDevices ? " Дальше можно докупить." : ""}
            </div>
          ) : null}
        </div>

        <Section top={25.25}>Трафик</Section>
        <div style={card}>
          <Line left="VPN" right={mainTraffic} warn={mainOver} />
        </div>

        <div style={{ marginTop: 17, display: "flex", flexDirection: "column", gap: 10 }}>
          <ActionRow tone="red" icon="download" title="Добавить подписку" onClick={addSubscription} />
          {!noRenew ? <ActionRow tone="green" icon="bag" title="Купить подписку" onClick={() => navigate(BUY_PATH)} /> : null}
          {family ? (
            <ActionRow
              tone="gray"
              icon="users"
              title="Выйти из семейной подписки"
              subtitle={family.ownerName ? `Пригласил ${family.ownerName}` : undefined}
              onClick={() => setLeaveDlg(true)}
            />
          ) : (
            <ActionRow tone="yellow" icon="users" title="Добавить в семью" onClick={() => navigate("/family")} />
          )}
          {canBuyDevices ? <ActionRow tone="gray" icon="phone" title="Купить устройства" onClick={() => navigate("/subscription/increase")} /> : null}
          <ActionRow
            tone="gray"
            icon="monitor"
            title="Управление устройствами"
            subtitle={devices ? `${used} подключено` : undefined}
            onClick={() => navigate("/subscription/devices")}
          />
        </div>
      </div>

      {setup ? <SetupSheet onClose={closeSetup} /> : null}
      {limitDlg ? (
        <FgnDialog
          text={canBuyDevices ? "Вы достигли лимит устройств вы можете докупить устройства" : "Вы достигли лимит устройств"}
          primary={canBuyDevices ? "Купить устройства" : undefined}
          onPrimary={() => { setLimitDlg(false); navigate("/subscription/increase"); }}
          onClose={() => setLimitDlg(false)}
        />
      ) : null}
      {leaveDlg ? (
        <FgnDialog
          title="Выйти из семьи?"
          text="Семейная подписка отключится. Вернуться можно только по новому приглашению."
          primary={leaving ? "Выходим…" : "Выйти"}
          onPrimary={() => void leaveFamily()}
          secondary="Остаться"
          onClose={() => { if (!leaving) setLeaveDlg(false); }}
        />
      ) : null}
    </FgnPage>
  );
}
