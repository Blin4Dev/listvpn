import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { applyDiscount, fetchDiscount, fetchQuote, fetchTariffs, periodTotalRub, PLAN_PACK_DEVICES, type TariffPeriod } from "../utils/api";
import { btnReset } from "../components/ui";
import { useTgBack } from "../components/noir";
import { O, OBack, OCard, OIcon, OScreen, OTitle } from "../components/ovpn";

// O-VPN: 07 «Выбор тарифа»

const GREEN = O.green;

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
        width: 48,
        height: 48,
        borderRadius: 16,
        border: `1px solid ${O.border}`,
        background: O.bg,
        color: O.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.35 : 1,
        transition: "opacity 0.15s ease",
      }}
    >
      <OIcon name={icon} size={20} />
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
  // участник семьи: продлевает семейную подписку — на столько устройств, сколько в ней сейчас, или больше
  const [famMember, setFamMember] = useState(false);

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
          if (q.family_member) setFamMember(true);
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

  useTgBack(goBack);
  return (
    <OScreen>
      <OBack onClick={goBack} />
      <OTitle>Выбор тарифа</OTitle>
      <OCard style={{ ...rise(0), marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 64 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, lineHeight: "24px" }}>Устройства</div>
            <div style={{ fontSize: 14, lineHeight: "20px", color: O.muted }}>
              {included} в тарифе · следующее +{Math.round(devNow >= devMax ? priceOf(devNow) : nextPrice)} ₽/мес
            </div>
          </div>
          <StepBtn icon="minus" label="Меньше" disabled={devNow <= devMin} onClick={() => setDev(devNow - 1)} />
          <div style={{ width: 40, textAlign: "center", fontSize: 24, fontWeight: 800, lineHeight: "36px", fontVariantNumeric: "tabular-nums" }}>{devNow}</div>
          <StepBtn icon="plus" label="Больше" disabled={devNow >= devMax} onClick={() => setDev(devNow + 1)} />
        </div>
        {famMember ? (
          <div style={{ paddingTop: 12, fontSize: 14, lineHeight: "20px", color: O.muted }}>
            Оплата продлит семейную подписку: устройств — от {devMin} и больше.
          </div>
        ) : devMin > devices ? (
          <div style={{ paddingTop: 12, fontSize: 14, lineHeight: "20px", color: O.muted }}>
            Сейчас в подписке {devMin} {devicesWord(devMin)} — при продлении они сохраняются.
          </div>
        ) : null}
      </OCard>

      <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted }}>Выберите период · ВПН + белые списки</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16 }}>
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
                ...rise(i + 1),
                fontFamily: O.font,
                width: "100%",
                minHeight: 82,
                padding: 16,
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                background: O.card,
                border: `1px solid ${O.border}`,
                borderRadius: 24,
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                cursor: "pointer",
                color: O.text,
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 20, fontWeight: 800, lineHeight: "28px" }}>{periodTitle(p.months)}</span>
                <span style={{ display: "block", fontSize: 14, lineHeight: "20px", color: O.muted }}>
                  {p.days} {daysWord(p.days)}, {devNow} {devicesWord(devNow)}
                </span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flex: "none" }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  {final < full ? <span style={{ fontSize: 14, color: O.muted, textDecoration: "line-through" }}>{full} ₽</span> : null}
                  <span style={{ fontSize: 20, fontWeight: 800, lineHeight: "28px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtRub(final)} ₽</span>
                </span>
                {final < full ? <span style={{ fontSize: 14, color: GREEN, fontWeight: 600 }}>−{Math.round(discount)}%</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </OScreen>
  );
}

// «1 300» — с пробелом-разделителем тысяч, как в макете
export function fmtRub(n: number): string {
  return Math.round(n).toLocaleString("ru-RU").replace(/\u00a0/g, " ");
}
