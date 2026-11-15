import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch, applyDiscount, fetchDiscount, fetchTariffs, openTgLink, type TariffPeriod } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { copyText } from "../components/SubLinkBox";
import { btnReset } from "../components/ui";
import { N, NoirBack, NoirCard, NoirScreen, NoirSection } from "../components/noir";
import { BRAND_NAME } from "../utils/brand";

// Hustler: 20 «Купить подарок» — общий экран в стиле Hustler (компоненты noir → дизайн Hustler)

type BoughtGift = { code: string; status: string; months: number; created_at: string; redeemed_at?: string | null };

const FALLBACK: TariffPeriod[] = [
  { months: 1, days: 30, price: 180 },
  { months: 3, days: 90, price: 470 },
  { months: 6, days: 180, price: 900 },
  { months: 12, days: 365, price: 1600 },
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

  useEffect(() => {
    void (async () => {
      try {
        const t = await fetchTariffs();
        if (t.periods.length) setPeriods(t.periods);
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
    navigate(`/payment?type=gift&months=${m}&return=${encodeURIComponent("/gift/buy")}`);
  const shown = periods;

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
      <NoirBack onClick={goBack} />
      <div style={{ fontSize: 36, fontWeight: 800, lineHeight: "36px", letterSpacing: "-0.025em", paddingTop: 16, color: N.text, marginBottom: 20 }}>
        Купить подарок
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {shown.map((p, i) => {
          const full = Math.round(p.price);
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
                minHeight: 84,
                padding: 16,
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                background: N.card,
                border: "none",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.14)",
                borderRadius: 21.6,
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                color: N.text,
                cursor: "pointer",
              }}
            >
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 18, fontWeight: 800, lineHeight: "28px" }}>{periodTitle(p.months)}</span>
                <span style={{ display: "block", marginTop: 4, fontSize: 14, lineHeight: "20px", color: N.muted }}>{p.days} {daysWord(p.days)} + белые списки</span>
              </span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                {final < full ? <span style={{ fontSize: 14, color: N.dim, textDecoration: "line-through" }}>{full} ₽</span> : null}
                <span style={{ fontSize: 20, fontWeight: 800, lineHeight: "28px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{final.toLocaleString("ru-RU").replace(/\u00a0/g, " ")} ₽</span>
              </span>
            </button>
          );
        })}
      </div>

    </NoirScreen>
  );
}
