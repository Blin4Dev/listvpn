import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { applyDiscount, fetchDiscount, fetchQuote, fetchTariffs, type TariffPeriod } from "../utils/api";
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
  { months: 1, days: 30, price: 180, whitelist_price: 0 },
  { months: 3, days: 90, price: 470, whitelist_price: 0 },
  { months: 6, days: 180, price: 900, whitelist_price: 0 },
  { months: 12, days: 365, price: 1600, whitelist_price: 0 },
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
  const [devices, setDevices] = useState(3);
  const [wlAvailable, setWlAvailable] = useState(false);
  const [discount, setDiscount] = useState(0);
  // устройства: сколько всего (минимум — тариф или то, что уже есть в подписке), цена доп. устройства в месяц
  const [devTotal, setDevTotal] = useState<number | null>(null);
  const [devMin, setDevMin] = useState(3);
  const [devMax, setDevMax] = useState(20);
  const [devPrice, setDevPrice] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const t = await fetchTariffs();
        if (t.periods.length) setPeriods(t.periods);
        setDevices(t.devices);
        setWlAvailable(t.whitelist_available);
      } catch { /* запасные цены */ }
      try {
        const d = await fetchDiscount();
        if (d.active && d.percent > 0) setDiscount(d.percent);
      } catch { /* без скидки */ }
      try {
        // минимум устройств и цену доп. устройства считает сервер (учитывает текущую подписку)
        const q = await fetchQuote({ plan_devices: 1, months: 1, method: "sbp", extra_devices: 0, purpose: "subscription",
          subscription_id: null, use_referral_balance: false, whitelist: false });
        if (!q) throw new Error("no quote");
        const min = Number(q.min_devices || q.plan_devices || 3);
        setDevMin(min);
        setDevMax(Number(q.max_devices || 20));
        setDevPrice(Number(q.extra_device_price || 0));
        setDevTotal(min);
      } catch { /* без выбора устройств */ }
      setLoaded(true);
    })();
  }, []);

  const choose = (m: number) => {
    const q = new URLSearchParams();
    q.set("months", String(m));
    if (devTotal) q.set("dev", String(devTotal));
    if (returnTo) q.set("return", returnTo);
    navigate(`/payment?${q.toString()}`);
  };

  // единый тариф: ВПН + белые списки на тот же срок, одна цена
  const shown = periods;
  const devNow = devTotal ?? devices;
  const devExtra = Math.max(0, devNow - devices);
  const showDevices = devTotal != null && devPrice > 0;
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
      {showDevices ? (
        <NoirCard style={{ ...rise(0), marginTop: 22, padding: "16px 16px 16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: N.text, letterSpacing: "-0.01em" }}>Устройства</div>
              <div style={{ marginTop: 4, fontSize: 13.5, lineHeight: 1.4, color: N.muted }}>
                {devices} в тарифе · +{Math.round(devPrice)} ₽/мес за каждое следующее
              </div>
            </div>
            <StepBtn icon="remove" label="Меньше устройств" disabled={devNow <= devMin} onClick={() => setDev(devNow - 1)} />
            <div style={{ minWidth: 34, textAlign: "center", fontSize: 21, fontWeight: 600, color: N.text, fontVariantNumeric: "tabular-nums" }}>
              {devNow}
            </div>
            <StepBtn icon="add" label="Больше устройств" disabled={devNow >= devMax} onClick={() => setDev(devNow + 1)} />
          </div>
          {devMin > devices ? (
            <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.4, color: N.dim }}>
              Сейчас в подписке {devMin} {devicesWord(devMin)} — при продлении они сохраняются.
            </div>
          ) : null}
        </NoirCard>
      ) : null}

      <div style={{ margin: "22px 0 10px", fontSize: 14.5, color: N.muted }}>
        Выберите период{wlAvailable ? " · ВПН + белые списки" : ""}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map((p, i) => {
          const full = Math.round(p.price + devExtra * devPrice * p.months);
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
