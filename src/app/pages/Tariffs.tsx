import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { applyDiscount, fetchDiscount, fetchTariffs, type TariffPeriod } from "../utils/api";
import { btnReset } from "../components/ui";
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
  { months: 1, days: 30, price: 99, whitelist_price: 200 },
  { months: 3, days: 90, price: 249, whitelist_price: 500 },
  { months: 6, days: 180, price: 449, whitelist_price: 900 },
  { months: 12, days: 365, price: 799, whitelist_price: 1600 },
];

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Белые списки"
      onClick={onToggle}
      style={{
        ...btnReset,
        position: "relative",
        flex: "none",
        width: 56,
        height: 32,
        borderRadius: 16,
        border: "none",
        background: on ? N.red : "rgba(255,255,255,0.14)",
        transition: "background 0.2s ease",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 27 : 3,
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
          transition: "left 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
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
  const [wl, setWl] = useState(false);
  const [discount, setDiscount] = useState(0);

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
      setLoaded(true);
    })();
  }, []);

  const choose = (m: number) => {
    const q = new URLSearchParams();
    q.set("months", String(m));
    if (wl) q.set("wl", "1");
    if (returnTo) q.set("return", returnTo);
    navigate(`/payment?${q.toString()}`);
  };

  const wlPrices = Array.from(new Set(periods.map((p) => Math.round(p.whitelist_price))));
  const wlText = wlPrices.length === 1
    ? `К выбранному тарифу добавляется ${wlPrices[0]} ₽.`
    : `К выбранному тарифу добавляется от ${Math.min(...wlPrices)} ₽ — зависит от срока.`;

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
      <div style={{ margin: "22px 0 10px", fontSize: 14.5, color: N.muted }}>Выберите период</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {periods.map((p, i) => {
          const full = Math.round(p.price + (wl ? p.whitelist_price : 0));
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
                  {p.days} {daysWord(p.days)}, {devices} {devicesWord(devices)}
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

      {wlAvailable ? (
        <NoirCard style={{ ...rise(periods.length), marginTop: 18, padding: "18px 18px 20px", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17.5, fontWeight: 600, color: N.text, letterSpacing: "-0.01em" }}>Белые списки</div>
            <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.45, color: N.muted }}>
              Это отдельная опция. {wlText} Срок и число устройств на эту сумму не влияют.
            </div>
          </div>
          <Switch on={wl} onToggle={() => setWl((v) => !v)} />
        </NoirCard>
      ) : null}
    </NoirScreen>
  );
}
