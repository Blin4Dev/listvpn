import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch, applyDiscount, fetchDiscount, fetchTariffs, openTgLink, type TariffPeriod } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { copyText } from "../components/SubLinkBox";
import { btnReset } from "../components/ui";
import { N, NoirBack, NoirCard, NoirScreen, NoirSection } from "../components/noir";
import { BRAND_NAME } from "../utils/brand";

// ЛЯМ200: 20 «Купить подарок» — общий экран в стиле ЛЯМ200 (компоненты noir → дизайн ЛЯМ200)

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
      <div style={{ fontSize: 24, fontWeight: 600, lineHeight: "32px", paddingTop: 6, color: N.text, marginBottom: 16 }}>
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
                minHeight: 80,
                padding: 16,
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                background: N.card,
                border: "none",
                borderRadius: 16,
                color: N.text,
                cursor: "pointer",
              }}
            >
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 16, fontWeight: 600, lineHeight: "24px" }}>{periodTitle(p.months)}</span>
                <span style={{ display: "block", marginTop: 4, fontSize: 14, lineHeight: "20px", color: N.muted }}>{p.days} {daysWord(p.days)}</span>
              </span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                {final < full ? <span style={{ fontSize: 14, color: N.dim, textDecoration: "line-through" }}>{full} ₽</span> : null}
                <span style={{ fontSize: 16, fontWeight: 600, lineHeight: "24px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{final.toLocaleString("ru-RU").replace(/\u00a0/g, " ")} ₽</span>
              </span>
            </button>
          );
        })}
      </div>

    </NoirScreen>
  );
}
