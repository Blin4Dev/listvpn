// FGN: «Выбор тарифа» (переопределение src/app/pages/Tariffs.tsx).
// Макет: шапка, карточка «Устройства» со степпером (−/N/+, подпись «N в тарифе · следующее +X ₽/мес»),
// подпись «Выберите период», 4 карточки периодов («30 дней, 2 устройства», цена справа).
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { applyDiscount, fetchDiscount, fetchQuote, fetchTariffs, type TariffPeriod } from "../utils/api";
import { C, FgnCard, FgnHeader, FgnIcon, FgnPage } from "../components/fgn";

const FALLBACK: TariffPeriod[] = [
  { months: 1, days: 30, price: 200 },
  { months: 3, days: 90, price: 580 },
  { months: 6, days: 180, price: 1100 },
  { months: 12, days: 365, price: 2200 },
];

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

function periodTitle(m: number) {
  if (m === 12) return "1 год";
  return `${m} ${plural(m, "месяц", "месяца", "месяцев")}`;
}

// ru-RU не группирует 4-значные числа («1100»), а в макете «1 100 ₽» — группируем сами
const rub = (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;

const MUTED = "rgba(196, 196, 206, 0.62)";

/** круглая кнопка степпера: 35px, контур; выключенная — почти невидимая */
function StepBtn({ icon, disabled, onClick, label }: { icon: string; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={disabled ? undefined : "blin-press"}
      style={{
        appearance: "none",
        margin: 0,
        padding: 0,
        width: 35,
        height: 35,
        flexShrink: 0,
        borderRadius: "50%",
        background: "#0E0E10",
        border: `1px solid ${disabled ? "rgba(255, 255, 255, 0.06)" : "rgba(255, 255, 255, 0.16)"}`,
        color: disabled ? "rgba(255, 255, 255, 0.28)" : C.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        boxSizing: "border-box",
        transition: "color 0.15s ease, border-color 0.15s ease",
      }}
    >
      <FgnIcon name={icon} size={17} stroke={1.8} />
    </button>
  );
}

export default function Tariffs() {
  const navigate = useNavigate();
  const goBack = useSmartBack("/");
  const [params] = useSearchParams();
  const returnTo = params.get("return") || "";

  const [periods, setPeriods] = useState<TariffPeriod[]>(FALLBACK);
  const [devices, setDevices] = useState(2);
  const [discount, setDiscount] = useState(0);
  // устройства: сколько всего (минимум — тариф или то, что уже есть в подписке), цена доп. устройства в месяц
  const [devTotal, setDevTotal] = useState<number | null>(null);
  const [devMin, setDevMin] = useState(2);
  const [devMax, setDevMax] = useState(20);
  const [devPrice, setDevPrice] = useState(0);
  const [devTable, setDevTable] = useState<number[]>([]); // цена n-го устройства в месяц

  useEffect(() => {
    void (async () => {
      try {
        const t = await fetchTariffs();
        if (t.periods.length) setPeriods(t.periods);
        setDevices(t.devices);
      } catch { /* запасные цены */ }
      try {
        const d = await fetchDiscount();
        if (d.active && d.percent > 0) setDiscount(d.percent);
      } catch { /* без скидки */ }
      try {
        // минимум устройств и цену доп. устройства считает сервер (учитывает текущую подписку)
        const q = await fetchQuote({ plan_devices: 1, months: 1, method: "sbp", extra_devices: 0, purpose: "subscription",
          subscription_id: null, use_referral_balance: false });
        if (!q) throw new Error("no quote");
        const min = Number(q.min_devices || q.plan_devices || 2);
        setDevMin(min);
        setDevMax(Number(q.max_devices || 20));
        setDevPrice(Number(q.extra_device_price || 0));
        if (Array.isArray(q.device_prices)) setDevTable(q.device_prices.map(Number));
        setDevTotal(min);
      } catch { /* без выбора устройств */ }
    })();
  }, []);

  const choose = (m: number) => {
    const q = new URLSearchParams();
    q.set("months", String(m));
    if (devTotal) q.set("dev", String(devTotal));
    if (returnTo) q.set("return", returnTo);
    navigate(`/payment?${q.toString()}`);
  };

  const devNow = devTotal ?? devices;
  const priceOf = (n: number) => (devTable.length ? Number(devTable[Math.min(n, devTable.length) - 1] ?? devPrice) : devPrice);
  // ₽/мес за устройства сверх тарифа: у каждого номера своя цена (панель → Цены)
  let devMonthly = 0;
  for (let n = devices + 1; n <= devNow; n++) devMonthly += priceOf(n);
  const nextPrice = Math.round(devNow >= devMax ? priceOf(devNow) : priceOf(devNow + 1));
  const showDevices = devTotal != null && (devPrice > 0 || devTable.some((x) => x > 0));
  const setDev = (n: number) => setDevTotal(Math.min(devMax, Math.max(devMin, n)));

  return (
    <FgnPage>
      <FgnHeader title="Выбор тарифа" onBack={goBack} />

      {showDevices ? (
        <div
          style={{
            marginTop: 20.5,
            padding: "17px 17px 16px 17px",
            borderRadius: 30,
            border: "1px solid rgba(42, 42, 48, 1)",
            background: C.cardBg,
            boxSizing: "border-box",
            animation: "fgnFade 0.35s ease both",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", height: 35 }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 500, lineHeight: "20px", letterSpacing: "-0.005em" }}>
              Устройства
            </div>
            <StepBtn icon="minus" label="Меньше устройств" disabled={devNow <= devMin} onClick={() => setDev(devNow - 1)} />
            <div style={{ width: 41, textAlign: "center", fontSize: 18, fontWeight: 600, lineHeight: "22px", fontVariantNumeric: "tabular-nums" }}>
              {devNow}
            </div>
            <StepBtn icon="plus" label="Больше устройств" disabled={devNow >= devMax} onClick={() => setDev(devNow + 1)} />
          </div>
          <div style={{ marginTop: 13.5, fontSize: 14.5, lineHeight: "18px", color: MUTED }}>
            {devices} в тарифе · следующее +{nextPrice}{" "}₽/мес
          </div>
          {devMin > devices ? (
            <div style={{ marginTop: 6, fontSize: 13.5, lineHeight: "17px", color: MUTED }}>
              Сейчас в подписке {devMin} {plural(devMin, "устройство", "устройства", "устройств")} — при продлении они сохраняются.
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ marginTop: showDevices ? 21.5 : 20, fontSize: 14.5, lineHeight: "18px", color: MUTED }}>
        Выберите период
      </div>

      <div style={{ marginTop: 13.5, display: "flex", flexDirection: "column", gap: 8 }}>
        {periods.map((p, i) => {
          const full = Math.round(p.price + devMonthly * p.months);
          const final = discount > 0 ? applyDiscount(full, discount) : full;
          return (
            <FgnCard
              key={p.months}
              onClick={() => choose(p.months)}
              style={{ animation: `fgnFade 0.35s ease ${0.04 * i}s both` }}
              title={periodTitle(p.months)}
              subtitle={`${p.days} ${plural(p.days, "день", "дня", "дней")}, ${devNow} ${plural(devNow, "устройство", "устройства", "устройств")}`}
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
