// FGN: «Купить подарок» (переопределение src/app/pages/GiftBuy.tsx).
// Макет: шапка «назад» + заголовок, 4 карточки тарифов (срок, «N дней + белые списки», цена справа).
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { applyDiscount, fetchDiscount, fetchTariffs, type TariffPeriod } from "../utils/api";
import { C, FgnCard, FgnHeader, FgnPage } from "../components/fgn";

const FALLBACK: TariffPeriod[] = [
  { months: 1, days: 30, price: 200, whitelist_price: 0 },
  { months: 3, days: 90, price: 580, whitelist_price: 0 },
  { months: 6, days: 180, price: 1100, whitelist_price: 0 },
  { months: 12, days: 365, price: 2200, whitelist_price: 0 },
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

// «1 100 ₽» — разряды через узкий неразрывный пробел, как в макете
// ru-RU не группирует 4-значные числа («1100»), а в макете «1 100 ₽» — группируем сами.
const rub = (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;

export default function GiftBuy() {
  const navigate = useNavigate();
  const goBack = useSmartBack("/");
  const [periods, setPeriods] = useState<TariffPeriod[]>(FALLBACK);
  const [discount, setDiscount] = useState(0);
  const [wlAvailable, setWlAvailable] = useState(true);

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
    })();
  }, []);

  const choose = (m: number) =>
    navigate(`/payment?type=gift&months=${m}&return=${encodeURIComponent("/gift/buy")}`);

  return (
    <FgnPage>
      <FgnHeader title="Купить подарок" onBack={goBack} />
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        {periods.map((p, i) => {
          const full = Math.round(p.price);
          const final = discount > 0 ? applyDiscount(full, discount) : full;
          return (
            <FgnCard
              key={p.months}
              onClick={() => choose(p.months)}
              style={{ animation: `fgnFade 0.35s ease ${0.04 * i}s both` }}
              title={periodTitle(p.months)}
              subtitle={`${p.days} ${daysWord(p.days)}${wlAvailable ? " + белые списки" : ""}`}
              right={
                <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexShrink: 0 }}>
                  {final < full ? (
                    <span style={{ fontSize: 14, color: C.muted, textDecoration: "line-through" }}>{rub(full)}</span>
                  ) : null}
                  <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.005em", fontVariantNumeric: "tabular-nums" }}>{rub(final)}</span>
                </span>
              }
            />
          );
        })}
      </div>
    </FgnPage>
  );
}
