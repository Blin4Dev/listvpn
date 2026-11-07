import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { applyDiscount, fetchDiscount, fetchQuote, fetchTariffs, periodTotalRub, PLAN_PACK_DEVICES, type TariffPeriod } from "../utils/api";
import { MSIcon, btnReset } from "../components/ui";
import { N, NoirBack, NoirCard, NoirScreen } from "../components/noir";

const GREEN = "#3DD68C";

function periodTitle(m: number): string {
  if (m === 12) return "1 год";
  const a = m % 10, b = m % 100;
  if (a === 1 && b !== 11) return `${m} месяц`;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return `${m} месяца`;
  return `${m} месяцев`;
}

function daysWord(n: number) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return "день";
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return "дня";
  return "дней";
}

function devicesWord(n: number) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return "устройство";
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return "устройства";
  return "устройств";
}

const FALLBACK: TariffPeriod[] = [
  { months: 1, days: 30, price: 180 },
  { months: 3, days: 90, price: 470 },
  { months: 6, days: 180, price: 900 },
  { months: 12, days: 365, price: 1600 },
];

function StepBtn({ icon, disabled, onClick, label }: { icon: string; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="blin-press"
      style={{
        ...btnReset,
        flex: "none",
        width: 44,
        height: 44,
        borderRadius: 14,
        border: `1px solid ${N.cardBorder}`,
        background: "rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.35 : 1,
        transition: "opacity 0.15s ease",
      }}
    >
      <MSIcon name={icon} style={{ fontSize: 22, color: N.text, fontVariationSettings: "'wght' 300" }} />
    </button>
  );
}

export default function Tariffs() {
  const navigate = useNavigate();
  const goBack = useSmartBack("/");
  const [params] = useSearchParams();
  const returnTo = params.get("return") || "";

  const [loaded, setLoaded] = useState(false);
  const [periods, setPeriods] = useState<TariffPeriod[]>(FALLBACK);
  const [devices, setDevices] = useState(5);
  const [discount, setDiscount] = useState(0);
  // устройства: сколько всего (минимум — тариф или то, что уже есть в подписке), цена доп. устройства в месяц
  const [devTotal, setDevTotal] = useState(PLAN_PACK_DEVICES);
  const [devMin, setDevMin] = useState(3);
  const [devMax, setDevMax] = useState(20);
  const [devPrice, setDevPrice] = useState(0);
  const [devTable, setDevTable] = useState<number[]>([]); // цена n-го устройства в месяц
  // участник семьи: степпер виден, но число устройств меняет только владелец
  const [devLocked, setDevLocked] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const t = await fetchTariffs();
        if (t.periods.length) setPeriods(t.periods);
        setDevices(t.devices);
        const min = Number(t.min_devices || 3);
        setDevMin(min);
        setDevMax(Number(t.max_devices || 20));
        setDevPrice(Number(t.extra_device_price || 0));
        if (t.device_prices?.length) setDevTable(t.device_prices);
        setDevTotal(Math.max(min, Number(t.default_devices || PLAN_PACK_DEVICES)));
      } catch { /* запасные цены */ }
      try {
        const d = await fetchDiscount();
        if (d.active && d.percent > 0) setDiscount(d.percent);
      } catch { /* без скидки */ }
      try {
        const q = await fetchQuote({ plan_devices: PLAN_PACK_DEVICES, months: 1, method: "sbp", extra_devices: 0, purpose: "subscription",
          subscription_id: null, use_referral_balance: false });
        if (q) {
          const min = Number(q.min_devices || 3);
          setDevMin(min);
          if (q.max_devices) setDevMax(Number(q.max_devices));
          if (q.extra_device_price != null) setDevPrice(Number(q.extra_device_price));
          if (Array.isArray(q.device_prices) && q.device_prices.length) setDevTable(q.device_prices.map(Number));
          // по умолчанию — сколько устройств сейчас в подписке (уменьшить можно до минимума)
        setDevTotal(Math.max(min, Number(q.default_devices || min)));
          if (q.devices_locked) {
            setDevLocked(true);
            if (q.devices_total) setDevTotal(Number(q.devices_total));
          }
        }
      } catch { /* степпер уже есть из /plans */ }
      setLoaded(true);
    })();
  }, []);

  const choose = (m: number) => {
    const q = new URLSearchParams();
    q.set("months", String(m));
    q.set("dev", String(devNow));
    if (returnTo) q.set("return", returnTo);
    navigate(`/payment?${q.toString()}`);
  };

  const shown = periods;
  const pack = PLAN_PACK_DEVICES;
  const devNow = devTotal ?? devices;
  const included = pack;
  const priceOf = (n: number) => (devTable.length ? Number(devTable[Math.min(n, devTable.length) - 1] ?? devPrice) : devPrice);
  const nextPrice = priceOf(devNow + 1);
  const setDev = (n: number) => setDevTotal(Math.min(devMax, Math.max(devMin, n)));

  const rise = (i: number): React.CSSProperties => ({
    animation: loaded ? `blinvpnRise 0.55s var(--ease-out) ${0.05 * i}s both` : undefined,
    opacity: loaded ? undefined : 0,
  });

  return (
    <NoirScreen>
      <div style={{ paddingTop: 20, marginBottom: 22 }}>
        <NoirBack onClick={goBack} />
      </div>
      <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.15, color: N.text }}>
        Выбор тарифа
      </div>
      <NoirCard style={{ ...rise(0), marginTop: 22, padding: "16px 16px 16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: N.text, letterSpacing: "-0.01em" }}>Устройства</div>
              <div style={{ marginTop: 4, fontSize: 13.5, lineHeight: 1.4, color: N.muted }}>
                {included} в тарифе · следующее +{Math.round(devNow >= devMax ? priceOf(devNow) : nextPrice)} ₽/мес
              </div>
            </div>
            <StepBtn icon="remove" label="Меньше устройств" disabled={devLocked || devNow <= devMin} onClick={() => setDev(devNow - 1)} />
            <div style={{ minWidth: 34, textAlign: "center", fontSize: 21, fontWeight: 600, color: N.text, fontVariantNumeric: "tabular-nums" }}>
              {devNow}
            </div>
            <StepBtn icon="add" label="Больше устройств" disabled={devLocked || devNow >= devMax} onClick={() => setDev(devNow + 1)} />
          </div>
          {devLocked ? (
            <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.4, color: N.dim }}>
              Вы в семейной подписке — оплатить можно только столько устройств, сколько в ней сейчас. Менять число устройств может владелец семьи.
            </div>
          ) : devMin > devices ? (
            <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.4, color: N.dim }}>
              Сейчас в подписке {devMin} {devicesWord(devMin)} — при продлении они сохраняются.
            </div>
          ) : null}
        </NoirCard>

      <div style={{ margin: "22px 0 10px", fontSize: 14.5, color: N.muted }}>
        Выберите период
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map((p, i) => {
          const fb = FALLBACK.find((x) => x.months === p.months)?.price ?? 0;
          const full = periodTotalRub(p, devNow, devTable, devPrice, fb);
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
                minHeight: 74,
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                background: N.card,
                border: `1px solid ${N.cardBorder}`,
                borderRadius: 24,
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                cursor: "pointer",
                color: N.text,
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 17.5, fontWeight: 600, letterSpacing: "-0.01em" }}>
                  {periodTitle(p.months)}
                </span>
                <span style={{ display: "block", marginTop: 5, fontSize: 14, color: N.muted }}>
                  {p.days} {daysWord(p.days)}, {devNow} {devicesWord(devNow)}
                </span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flex: "none" }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  {final < full ? (
                    <span style={{ fontSize: 14.5, color: N.dim, textDecoration: "line-through" }}>{full} ₽</span>
                  ) : null}
                  <span style={{ fontSize: 19, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{final} ₽</span>
                </span>
                {final < full ? (
                  <span style={{ fontSize: 14, color: GREEN, fontWeight: 500 }}>−{Math.round(discount)}%</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

    </NoirScreen>
  );
}
