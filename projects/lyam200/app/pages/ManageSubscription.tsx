import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { useSmartBack } from "../utils/navigation";
import { appFetch, fetchAppLink, fetchTraffic, formatBytesRu, SUPPORT_PREFILL_KEY, type TrafficInfo } from "../utils/api";
import { loadReferral, peekReferral } from "../utils/referral";
import { formatDateRu } from "../utils/date";
import SetupSheet from "../components/SetupSheet";
import { copyText } from "../components/SubLinkBox";
import { useTgBack } from "../components/noir";
import { O, OBack, OButton, OCard, OIcon, OLabel, OMenuRow, OScreen, OSheet, OSheetText, OTitle } from "../components/lyam";

// ЛЯМ200: 06 «Управление подпиской» + листы 35 «Поделиться», 36 «QR код», 37 «Как вставить ключ»

type SubResponse = {
  status?: string;
  until?: string | null;
  key?: { devices_limit?: number; days_left?: number | null; no_renew?: boolean; type?: string } | null;
  expired_key?: { expiry_date?: string | null } | null;
  delete_at?: string | null;
};

type DevicesResponse = { used?: number; limit?: number; can_buy?: boolean };

export function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

const dateG = (iso: string) => {
  const t = formatDateRu(iso);
  return /г\.?$/.test(t) ? t : `${t} г.`;
};

export default function ManageSubscription() {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useSmartBack("/");
  useTgBack(goBack);

  const [untilIso, setUntilIso] = useState<string | null>(null);
  const [expiredAt, setExpiredAt] = useState<string | null>(null);
  const [deleteAt, setDeleteAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [noRenew, setNoRenew] = useState(false);
  const [isTrial, setIsTrial] = useState(false);
  const [devices, setDevices] = useState<DevicesResponse | null>(null);
  const [keyLimit, setKeyLimit] = useState<number | null>(null);
  const [traffic, setTraffic] = useState<TrafficInfo | null>(null);
  const [sheet, setSheet] = useState<null | "setup" | "qr" | "key" | "share">(null);
  const [noSub, setNoSub] = useState(false);

  useEffect(() => {
    appFetch<DevicesResponse>("/devices").then(setDevices).catch(() => { /* нет данных */ });
    void fetchTraffic().then(setTraffic);
  }, []);

  const closeSheet = () => {
    setSheet(null);
    if (new URLSearchParams(location.search).has("setup")) navigate("/subscription", { replace: true });
  };

  useEffect(() => {
    if (new URLSearchParams(location.search).get("setup") === "1") setSheet("setup");
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
          setNoSub(true);
          return;
        }
        setUntilIso(data.until);
        setNoRenew(!!data.key?.no_renew);
        setIsTrial(data.key?.type === "trial" || data.status === "trial");
        if (data.key?.devices_limit) setKeyLimit(Number(data.key.devices_limit));
      } catch { /* placeholder */ } finally {
        setLoaded(true);
      }
    })();
  }, [navigate]);

  const now = useNow(30_000);
  const msLeft = untilIso ? new Date(untilIso).getTime() - now : 0;

  useEffect(() => {
    if (untilIso && msLeft <= 0 && !expiredAt) {
      setExpiredAt(untilIso);
      setDeleteAt(new Date(new Date(untilIso).getTime() + 7 * 86_400_000).toISOString());
    }
  }, [msLeft, untilIso, expiredAt]);

  const leftLabel = useMemo(() => {
    const days = Math.floor(msLeft / 86_400_000);
    if (days >= 1) return `${days} ${plural(days, "день", "дня", "дней")}`;
    const hours = Math.max(1, Math.ceil(msLeft / 3_600_000));
    return `${hours} ${plural(hours, "час", "часа", "часов")}`;
  }, [msLeft]);

  const rise = (i: number): React.CSSProperties => ({
    animation: loaded ? `blinvpnRise 0.55s var(--ease-out) ${0.04 * i}s both` : undefined,
    opacity: loaded ? undefined : 0,
  });

  const title = <OTitle>Подписка</OTitle>;

  // ── подписки нет (12) ──
  if (noSub) {
    return (
      <OScreen>
        <OBack onClick={goBack} />
        {title}
        <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted }}>Сначала оформите подписку.</div>
        <OButton tone="red" style={{ marginTop: 16 }} onClick={() => navigate("/tariffs")}>Оформить подписку</OButton>
      </OScreen>
    );
  }

  // ── истекла ──
  if (expiredAt) {
    const deleteIn = deleteAt ? Math.max(1, Math.ceil((new Date(deleteAt).getTime() - Date.now()) / 86_400_000)) : null;
    return (
      <OScreen>
        <OBack onClick={goBack} />
        {title}
        <div style={{ paddingTop: 16, fontSize: 30, fontWeight: 600, lineHeight: "36px", color: O.danger }}>Истекла</div>
        <div style={{ paddingTop: 4, fontSize: 14, lineHeight: "20px", color: O.muted }}>Закончилась {dateG(expiredAt)}</div>
        {deleteIn != null ? (
          <OCard style={{ marginTop: 12, fontSize: 14, lineHeight: "20px", color: O.muted }}>
            Продлите подписку — иначе через {deleteIn} {plural(deleteIn, "день", "дня", "дней")} она будет удалена вместе с настройками в приложении.
          </OCard>
        ) : null}
        <OButton tone="red" icon="shopping-bag" style={{ marginTop: 16 }} onClick={() => navigate("/subscription/extend")}>
          Купить подписку
        </OButton>
      </OScreen>
    );
  }

  const limit = devices?.limit ?? keyLimit ?? 0;
  const used = devices?.used ?? 0;
  const free = Math.max(0, limit - used);
  const canBuyDevices = !isTrial && (devices?.can_buy ?? true);
  const trafficText = (t: TrafficInfo | null) => {
    if (!t?.available || t.used_bytes == null) return "—";
    const usedTxt = formatBytesRu(Math.max(0, t.used_bytes));
    return t.limit_bytes ? `${usedTxt} из ${formatBytesRu(t.limit_bytes)}` : `${usedTxt} · без лимита`;
  };

  return (
    <OScreen>
      <OBack onClick={goBack} />

      <div style={rise(0)}>
        {title}
        <div style={{ paddingTop: 16, fontSize: 30, fontWeight: 600, lineHeight: "36px", color: O.text, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {loaded ? leftLabel : " "}
        </div>
        <div style={{ paddingTop: 4, fontSize: 14, lineHeight: "20px", color: O.muted }}>
          {untilIso ? `до ${dateG(untilIso)}` : " "}
        </div>
        {noRenew ? (
          <OCard style={{ marginTop: 12, fontSize: 14, lineHeight: "20px", color: O.muted }}>
            Продление этой подписки недоступно. После окончания срока она будет удалена — тогда можно будет оформить новую.
          </OCard>
        ) : null}
      </div>

      <div style={rise(1)}>
        <OLabel>Устройства</OLabel>
        <OCard style={{ marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 28 }}>
            <span style={{ fontSize: 20, fontWeight: 600, lineHeight: "28px" }}>{devices || keyLimit ? `${used} из ${limit}` : "—"}</span>
            {limit > 0 ? (
              <span style={{ fontSize: 14, lineHeight: "20px", color: free > 0 ? O.muted : O.danger }}>{free > 0 ? `свободно ${free}` : "мест нет"}</span>
            ) : null}
          </div>
          {limit > 0 ? (
            <div style={{ paddingTop: 4, fontSize: 14, lineHeight: "20px", color: O.muted }}>
              {limit} {plural(limit, "устройство", "устройства", "устройств")} в тарифе.{canBuyDevices ? " Дальше можно докупить." : ""}
            </div>
          ) : null}
        </OCard>
      </div>

      <div style={rise(2)}>
        <OLabel>Трафик</OLabel>
        <TrafficRow name="Основной" value={trafficText(traffic)} style={{ marginTop: 8 }} />
        <ResetRow
          onClick={() => {
            try { sessionStorage.setItem(SUPPORT_PREFILL_KEY, "Здравствуйте. Прошу сбросить трафик по моей подписке."); } catch { /* ignore */ }
            navigate("/support");
          }}
        />
      </div>

      <div style={{ ...rise(3), display: "flex", flexDirection: "column", gap: 8, paddingTop: 16 }}>
        <OButton tone="red" icon="download" onClick={() => setSheet("setup")}>Добавить подписку</OButton>
        {!noRenew ? (
          <DarkButton icon="shopping-bag" onClick={() => navigate("/subscription/extend")}>Купить подписку</DarkButton>
        ) : null}
        <DarkButton icon="share-2" onClick={() => setSheet("share")}>Поделиться с другом</DarkButton>
        <DarkButton icon="qr-code" onClick={() => setSheet("qr")}>QR код подписки</DarkButton>
        {canBuyDevices ? <DarkButton icon="smartphone" onClick={() => navigate("/subscription/increase")}>Купить устройства</DarkButton> : null}
        <DarkButton icon="monitor-smartphone" onClick={() => navigate("/subscription/devices")}>Управление устройствами</DarkButton>
        <DarkButton icon="key-round" onClick={() => setSheet("key")}>Как вставить ключ</DarkButton>
      </div>

      {sheet === "setup" && <SetupSheet onClose={closeSheet} />}
      {sheet === "qr" && <QrSheet onClose={closeSheet} onHowTo={() => setSheet("key")} />}
      {sheet === "key" && <KeySheet onClose={closeSheet} />}
      {sheet === "share" && <ShareSheet onClose={closeSheet} />}
    </OScreen>
  );
}

/** «мягкая» кнопка ЛЯМ200: иконка 16 + Medium 14 по центру, 48, r16 */
function DarkButton({ icon, children, onClick }: { icon: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="blin-press"
      style={{
        appearance: "none", WebkitAppearance: "none", WebkitTapHighlightColor: "transparent", outline: "none", margin: 0, boxSizing: "border-box",
        width: "100%", height: 48, padding: "0 16px", border: "none", borderRadius: 16, background: O.card,
        color: O.text, fontFamily: O.font, fontSize: 14, fontWeight: 500, lineHeight: "20px",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer",
      }}
    >
      <OIcon name={icon} size={16} />
      {children}
    </button>
  );
}

function TrafficRow({ name, value, style }: { name: string; value: string; style?: React.CSSProperties }) {
  return (
    <OCard style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8, ...style }}>
      <span style={{ fontSize: 14, lineHeight: "20px" }}>{name}</span>
      <span style={{ fontSize: 14, lineHeight: "20px", color: O.muted, whiteSpace: "nowrap" }}>{value}</span>
    </OCard>
  );
}

function ResetRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="blin-press"
      style={{
        appearance: "none", WebkitAppearance: "none", WebkitTapHighlightColor: "transparent", outline: "none", margin: 0, boxSizing: "border-box",
        width: "100%", minHeight: 76, padding: 16, border: "none", borderRadius: 16, background: O.card, color: O.text, fontFamily: O.font,
        display: "flex", alignItems: "center", gap: 12, textAlign: "left", cursor: "pointer",
      }}
    >
      <OIcon name="rotate-ccw" size={16} color={O.muted} />
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 500, lineHeight: "20px" }}>Сбросить трафик</span>
        <span style={{ fontSize: 14, lineHeight: "20px", color: O.muted }}>Сброс по заявке в поддержку.</span>
      </span>
    </button>
  );
}

function useSubLink() {
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    fetchAppLink("other")
      .then((r) => setLink(r.link))
      .catch((e) => setErr(e instanceof Error ? e.message : "Не удалось получить ключ"));
  }, []);
  return { link, err };
}

/** поле со ссылкой/ключом: 44, r16, #141C2E, моноширинный 14 */
export function OLinkField({ text, error }: { text: string; error?: boolean }) {
  return (
    <div
      style={{
        height: 44, boxSizing: "border-box", padding: 12, borderRadius: 16, background: O.bg,
        fontFamily: "Consolas, 'SFMono-Regular', Menlo, monospace", fontSize: 14, lineHeight: "20px", color: error ? O.danger : O.text,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", userSelect: "all", WebkitUserSelect: "all",
      }}
    >
      {text}
    </div>
  );
}

export function CopyButton({ text, label }: { text: string; label: string; icon?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <OButton
      tone="red"
      disabled={!text}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        });
      }}
    >
      {copied ? "Скопировано" : label}
    </OButton>
  );
}

/** шаги «как вставить ключ» (15, 14) */
export function KeySteps({ style }: { style?: React.CSSProperties }) {
  const steps = [
    "Скопируйте ключ кнопкой ниже.",
    "Откройте Happ, v2rayTun или Hiddify.",
    "Нажмите «+» и выберите «Вставить из буфера».",
    "Включите подключение.",
  ];
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12, ...style }}>
      {steps.map((t, i) => (
        <li key={i} style={{ fontSize: 14, lineHeight: "20px", color: O.text }}>{i + 1}. {t}</li>
      ))}
    </ol>
  );
}

// 17 — поделиться с другом: ссылка подписки
function ShareSheet({ onClose }: { onClose: () => void }) {
  useTgBack(onClose);
  const { link, err } = useSubLink();
  return (
    <OSheet title="Поделиться с другом" onClose={onClose}>
      <div style={{ paddingTop: 12, fontSize: 14, lineHeight: "20px", color: O.muted }}>Ссылка подписки. Друг вставит её в клиент или отсканирует QR.</div>
      <div style={{ paddingTop: 12 }}><OLinkField text={err || link || "Получаем ссылку…"} error={!!err} /></div>
      <div style={{ paddingTop: 16 }}><CopyButton text={link} label="Скопировать ссылку" /></div>
    </OSheet>
  );
}

// 16 — QR код подписки
function QrSheet({ onClose }: { onClose: () => void; onHowTo?: () => void }) {
  useTgBack(onClose);
  const { link, err } = useSubLink();
  const [svg, setSvg] = useState("");
  useEffect(() => {
    if (!link) return;
    QRCode.toString(link, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#141C2E", light: "#FFFFFF" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [link]);
  return (
    <OSheet title="QR код подписки" onClose={onClose}>
      <div style={{ paddingTop: 12, display: "flex", justifyContent: "center" }}>
        <div style={{ width: 208, height: 208, boxSizing: "border-box", padding: 8, borderRadius: 16, background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {svg ? (
            <div style={{ width: 192, height: 192 }} dangerouslySetInnerHTML={{ __html: svg.replace("<svg", '<svg width="100%" height="100%"') }} />
          ) : (
            <span style={{ color: "#555", fontSize: 14, textAlign: "center", padding: 8 }}>{err || "Получаем ключ…"}</span>
          )}
        </div>
      </div>
      <div style={{ paddingTop: 12, fontSize: 14, lineHeight: "20px", color: O.muted, textAlign: "center" }}>Наведите камеру клиента на код.</div>
      <div style={{ paddingTop: 16 }}><CopyButton text={link} label="Скопировать ключ" /></div>
    </OSheet>
  );
}

// 15 — как вставить ключ
function KeySheet({ onClose }: { onClose: () => void }) {
  useTgBack(onClose);
  const { link, err } = useSubLink();
  return (
    <OSheet title="Как вставить ключ" onClose={onClose}>
      <KeySteps style={{ paddingTop: 12 }} />
      <div style={{ paddingTop: 12 }}><OLinkField text={err || link || "Получаем ключ…"} error={!!err} /></div>
      <div style={{ paddingTop: 16 }}><CopyButton text={link} label="Скопировать ключ" /></div>
    </OSheet>
  );
}
