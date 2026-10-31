import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { useSmartBack } from "../utils/navigation";
import { appFetch, fetchAppLink } from "../utils/api";
import { formatDateRu } from "../utils/date";
import SetupSheet from "../components/SetupSheet";
import { copyText } from "../components/SubLinkBox";
import { MSIcon } from "../components/ui";
import { N, NoirBack, NoirButton, NoirCard, NoirRow, NoirScreen, NoirSection, NoirSheet } from "../components/noir";

type SubResponse = {
  status?: string;
  until?: string | null;
  key?: { devices_limit?: number; days_left?: number | null; no_renew?: boolean; type?: string } | null;
  expired_key?: { expiry_date?: string | null } | null;
  delete_at?: string | null;
};

type DevicesResponse = { used?: number; limit?: number; can_buy?: boolean };

// 1 день / 2 дня / 5 дней
function plural(n: number, one: string, few: string, many: string) {
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

export default function ManageSubscription() {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useSmartBack("/");

  const [untilIso, setUntilIso] = useState<string | null>(null);
  // истекла, но ещё не удалена: даты окончания и авто-удаления
  const [expiredAt, setExpiredAt] = useState<string | null>(null);
  const [deleteAt, setDeleteAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // продление запрещено админом
  const [noRenew, setNoRenew] = useState(false);
  // пробная: доп. устройства не купить
  const [isTrial, setIsTrial] = useState(false);
  const [devices, setDevices] = useState<DevicesResponse | null>(null);
  const [keyLimit, setKeyLimit] = useState<number | null>(null);

  const [sheet, setSheet] = useState<null | "setup" | "qr" | "key">(null);

  useEffect(() => {
    appFetch<DevicesResponse>("/devices").then(setDevices).catch(() => { /* нет данных */ });
  }, []);

  const closeSheet = () => {
    setSheet(null);
    // убрать ?setup=1, чтобы лист не открылся снова при «назад»
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
          // показать экран «истекла» даже без даты с сервера
          setExpiredAt(data.expired_key?.expiry_date || new Date().toISOString());
          setDeleteAt(data.delete_at || null);
          return;
        }
        if (!data.until) {
          // нет подписки (или уже удалена) → на главную к оформлению
          setLoaded(true);
          navigate("/", { replace: true });
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

  // подписка истекла, пока страница открыта → экран «истекла»
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
  const soon = msLeft < 3 * 86_400_000;

  const shareWithFriend = async () => {
    try {
      const r = await fetchAppLink("other");
      const url = `https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent("Держи ключ VPN — добавь его в приложение")}`;
      const wa = (window as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (u: string) => void } } }).Telegram?.WebApp;
      if (wa?.openTelegramLink) wa.openTelegramLink(url);
      else window.open(url, "_blank");
    } catch {
      setSheet("key");
    }
  };

  // ── истекла ──
  if (expiredAt) {
    const deleteIn = deleteAt ? Math.max(1, Math.ceil((new Date(deleteAt).getTime() - Date.now()) / 86_400_000)) : null;
    return (
      <NoirScreen dim={0.45}>
        <Header onBack={goBack} />
        <div style={{ fontSize: 52, fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 1.05, color: N.redText }}>Истекла</div>
        <div style={{ marginTop: 8, fontSize: 15.5, color: N.muted }}>Закончилась {formatDateRu(expiredAt)}</div>
        {deleteIn != null ? (
          <NoirCard style={{ marginTop: 22, padding: "16px 18px", fontSize: 14.5, lineHeight: 1.5, color: N.muted }}>
            Продлите подписку — иначе через {deleteIn} {plural(deleteIn, "день", "дня", "дней")} она будет удалена вместе с настройками в приложении.
          </NoirCard>
        ) : null}
        <div style={{ marginTop: 18 }}>
          <NoirButton primary icon="bolt" onClick={() => navigate("/subscription/extend")}>Продлить подписку</NoirButton>
        </div>
      </NoirScreen>
    );
  }

  const limit = devices?.limit ?? keyLimit ?? 0;
  const used = devices?.used ?? 0;
  const free = Math.max(0, limit - used);
  const canBuyDevices = !isTrial && (devices?.can_buy ?? true);

  // плавное появление блоков
  const rise = (i: number): React.CSSProperties => ({
    animation: loaded ? `blinvpnRise 0.6s var(--ease-out) ${0.04 * i}s both` : undefined,
    opacity: loaded ? undefined : 0,
  });

  return (
    <NoirScreen>
      <Header onBack={goBack} />

      <div style={rise(0)}>
        <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.15, color: N.text }}>Подписка</div>
        <div
          style={{
            fontSize: 56,
            fontWeight: 500,
            letterSpacing: "-0.04em",
            lineHeight: 1.08,
            color: soon ? N.warn : N.redText,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {loaded ? leftLabel : " "}
        </div>
        <div style={{ marginTop: 4, fontSize: 15.5, color: N.muted }}>
          {untilIso ? `до ${formatDateRu(untilIso)} г.` : " "}
        </div>
        {noRenew ? (
          <NoirCard style={{ marginTop: 16, padding: "14px 18px", fontSize: 14, lineHeight: 1.5, color: N.muted }}>
            Продление этой подписки недоступно. После окончания срока она будет удалена — тогда можно будет оформить новую.
          </NoirCard>
        ) : null}
      </div>

      <div style={rise(1)}>
        <NoirSection>Устройства</NoirSection>
        <NoirCard style={{ padding: "18px 18px 18px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 18, fontWeight: 600, color: N.text }}>
              {devices || keyLimit ? `${used} из ${limit}` : "—"}
            </span>
            {limit > 0 ? (
              <span style={{ fontSize: 14.5, color: free > 0 ? N.muted : N.redText }}>
                {free > 0 ? `свободно ${free}` : "мест нет"}
              </span>
            ) : null}
          </div>
          {limit > 0 ? (
            <div style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.45, color: N.muted }}>
              {limit} {plural(limit, "устройство входит", "устройства входят", "устройств входят")} в тариф.
              {canBuyDevices ? " Дальше можно докупить." : ""}
            </div>
          ) : null}
        </NoirCard>
      </div>

      <div style={{ ...rise(2), display: "flex", flexDirection: "column", gap: 12, marginTop: 26 }}>
        <NoirButton primary icon="download" onClick={() => setSheet("setup")}>Добавить подписку</NoirButton>
        {!noRenew ? (
          <NoirButton green icon="shopping_bag" onClick={() => navigate("/subscription/extend")}>Купить подписку</NoirButton>
        ) : null}
        <NoirRow icon="group" title="Поделиться с другом" onClick={() => void shareWithFriend()} />
        <NoirRow icon="qr_code_2" title="QR код подписки" onClick={() => setSheet("qr")} />
        {canBuyDevices ? (
          <NoirRow icon="smartphone" title="Купить устройства" onClick={() => navigate("/subscription/increase")} />
        ) : null}
        <NoirRow icon="desktop_windows" title="Управление устройствами" onClick={() => navigate("/subscription/devices")} />
        <NoirRow icon="chat_bubble" title="Как вставить ключ" onClick={() => setSheet("key")} />
      </div>

      {sheet === "setup" && <SetupSheet onClose={closeSheet} />}
      {sheet === "qr" && <QrSheet onClose={closeSheet} />}
      {sheet === "key" && <KeySheet onClose={closeSheet} />}
    </NoirScreen>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ paddingTop: 20, marginBottom: 22 }}>
      <NoirBack onClick={onBack} />
    </div>
  );
}

// ссылка подписки для QR / копирования
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

function CopyButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <NoirButton
      primary
      disabled={!link}
      icon={copied ? "check" : "content_copy"}
      onClick={() => {
        void copyText(link).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        });
      }}
    >
      {copied ? "Скопировано" : "Скопировать ключ"}
    </NoirButton>
  );
}

function QrSheet({ onClose }: { onClose: () => void }) {
  const { link, err } = useSubLink();
  const [svg, setSvg] = useState("");
  useEffect(() => {
    if (!link) return;
    QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#FFFFFF" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [link]);
  return (
    <NoirSheet title="QR код подписки" onClose={onClose}>
      <div style={{ fontSize: 14.5, lineHeight: 1.5, color: N.muted, marginBottom: 16 }}>
        Отсканируйте код в приложении на другом устройстве — подписка добавится автоматически.
      </div>
      <div
        style={{
          width: "min(260px, 72vw)",
          aspectRatio: "1 / 1",
          margin: "0 auto 18px",
          borderRadius: 22,
          background: "#FFFFFF",
          padding: 14,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {svg ? (
          <div style={{ width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: svg.replace("<svg", '<svg width="100%" height="100%"') }} />
        ) : (
          <span style={{ color: "#555", fontSize: 14, textAlign: "center" }}>{err || "Получаем ключ…"}</span>
        )}
      </div>
      <CopyButton link={link} />
    </NoirSheet>
  );
}

function KeySheet({ onClose }: { onClose: () => void }) {
  const { link, err } = useSubLink();
  const steps = [
    "Скопируйте ключ кнопкой ниже.",
    "Откройте VPN-приложение (Happ, INCY, v2RayTun, Hiddify и т.п.).",
    "Нажмите «+» или «Добавить» и выберите «Вставить из буфера обмена».",
    "Включите подключение — готово.",
  ];
  return (
    <NoirSheet title="Как вставить ключ" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span
              style={{
                flex: "none",
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "rgba(224, 0, 0, 0.16)",
                color: N.redText,
                fontSize: 13.5,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontSize: 15, lineHeight: 1.5, color: N.text, paddingTop: 2 }}>{s}</span>
          </div>
        ))}
      </div>
      <div
        style={{
          background: "rgba(255,255,255,0.05)",
          border: `1px solid ${N.cardBorder}`,
          borderRadius: 16,
          padding: "12px 14px",
          fontSize: 13,
          lineHeight: 1.45,
          color: err ? N.redText : N.muted,
          wordBreak: "break-all",
          userSelect: "all",
          WebkitUserSelect: "all",
          marginBottom: 14,
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <MSIcon name="key" style={{ fontSize: 18, color: N.dim, flex: "none", marginTop: 1 }} />
        <span>{err || link || "Получаем ключ…"}</span>
      </div>
      <CopyButton link={link} />
    </NoirSheet>
  );
}
