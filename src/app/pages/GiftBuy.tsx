import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch, applyDiscount, fetchDiscount, fetchTariffs, openTgLink, type TariffPeriod } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { copyText } from "../components/SubLinkBox";
import { btnReset } from "../components/ui";
import { N, NoirBack, NoirCard, NoirScreen, NoirSection } from "../components/noir";
import { BRAND_NAME } from "../utils/brand";

type BoughtGift = { code: string; status: string; months: number; created_at: string; redeemed_at?: string | null };

const FALLBACK: TariffPeriod[] = [
  { months: 1, days: 30, price: 180, whitelist_price: 0 },
  { months: 3, days: 90, price: 470, whitelist_price: 0 },
  { months: 6, days: 180, price: 900, whitelist_price: 0 },
  { months: 12, days: 365, price: 1600, whitelist_price: 0 },
];

function periodTitle(m: number) {
  if (m === 12) return "1 год";
  return `${m} ${m === 1 ? "месяц" : m < 5 ? "месяца" : "месяцев"}`;
}

function daysWord(n: number) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return "день";
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return "дня";
  return "дней";
}

export default function GiftBuy() {
  const navigate = useNavigate();
  const goBack = useSmartBack("/");
  const [periods, setPeriods] = useState<TariffPeriod[]>(FALLBACK);
  const [discount, setDiscount] = useState(0);
  const [gifts, setGifts] = useState<BoughtGift[]>([]);
  const [botLink, setBotLink] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // подарок с белыми списками (анти-тариф, как в старом боте)
  const [wlAvailable, setWlAvailable] = useState(false);
  const [wl, setWl] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const t = await fetchTariffs();
        if (t.periods.length) setPeriods(t.periods);
        setWlAvailable(t.whitelist_available);
      } catch { /* запасные цены */ }
      try {
        const d = await fetchDiscount();
        if (d.active && d.percent > 0) setDiscount(d.percent);
      } catch { /* без скидки */ }
      try {
        const g = await appFetch<{ items?: BoughtGift[]; bot_link?: string }>("/gifts");
        setGifts(g.items || []);
        setBotLink(g.bot_link || "");
      } catch { /* нет подарков */ }
      setLoaded(true);
    })();
  }, []);

  const choose = (m: number) =>
    navigate(`/payment?type=gift&months=${m}${wl ? "&wl=1" : ""}&return=${encodeURIComponent("/gift/buy")}`);
  const wlPeriods = periods.filter((p) => Number(p.whitelist_price) > 0);
  const shown = wl ? wlPeriods : periods;

  const send = (code: string) => {
    const text = `Дарю тебе подписку ${BRAND_NAME}! Открой бота → «Подарки» и введи код ${code}`;
    openTgLink(`https://t.me/share/url?url=${encodeURIComponent(botLink || code)}&text=${encodeURIComponent(text)}`);
  };

  const rise = (i: number): React.CSSProperties => ({
    animation: loaded ? `blinvpnRise 0.55s var(--ease-out) ${0.05 * i}s both` : undefined,
    opacity: loaded ? undefined : 0,
  });

  return (
    <NoirScreen>
      <div style={{ paddingTop: 20, marginBottom: 22 }}>
        <NoirBack onClick={goBack} />
      </div>
      <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.15, color: N.text, marginBottom: 18 }}>
        Купить подарок
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map((p, i) => {
          const full = Math.round(wl ? p.whitelist_price : p.price);
          const final = discount > 0 ? applyDiscount(full, discount) : full;
          return (
            <button
              key={p.months}
              type="button"
              onClick={() => choose(p.months)}
              className="blin-press"
              style={{
                ...btnReset,
                ...rise(i),
                fontFamily: N.font,
                width: "100%",
                minHeight: 82,
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                background: N.card,
                border: `1px solid ${N.cardBorder}`,
                borderRadius: 26,
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                color: N.text,
                cursor: "pointer",
              }}
            >
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 17.5, fontWeight: 500 }}>{periodTitle(p.months)}</span>
                <span style={{ display: "block", marginTop: 5, fontSize: 14.5, color: N.muted }}>{p.days} {daysWord(p.days)}{wl ? " + белые списки" : ""}</span>
              </span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                {final < full ? <span style={{ fontSize: 14, color: N.dim, textDecoration: "line-through" }}>{full} ₽</span> : null}
                <span style={{ fontSize: 18.5, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{final} ₽</span>
              </span>
            </button>
          );
        })}
      </div>

      {wlAvailable && wlPeriods.length ? (
        <NoirCard style={{ ...rise(shown.length), marginTop: 18, padding: "18px 18px 20px", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17.5, fontWeight: 600, color: N.text }}>С белыми списками</div>
            <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.45, color: N.muted }}>
              Друг получит подписку и отдельный ключ для обхода белых списков.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={wl}
            aria-label="С белыми списками"
            onClick={() => setWl((v) => !v)}
            style={{
              ...btnReset, position: "relative", flex: "none", width: 56, height: 32, borderRadius: 16, border: "none",
              background: wl ? N.red : "rgba(255,255,255,0.14)", transition: "background 0.2s ease", cursor: "pointer",
            }}
          >
            <span style={{
              position: "absolute", top: 3, left: wl ? 27 : 3, width: 26, height: 26, borderRadius: "50%", background: "#fff",
              boxShadow: "0 2px 6px rgba(0,0,0,0.35)", transition: "left 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
            }} />
          </button>
        </NoirCard>
      ) : null}
    </NoirScreen>
  );
}
