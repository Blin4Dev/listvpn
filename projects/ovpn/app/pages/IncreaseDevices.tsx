import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch, fetchQuote, fetchSubscription } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { btnReset } from "../components/ui";
import { N, NoirButton, NoirCard, useTgBack } from "../components/noir";
import { O, OBack, OIcon, OScreen, OTitle } from "../components/ovpn";

// O-VPN: 15 «Купить устройства»

const MAX_DEVICES = 50;
const PERIODS = [1, 3, 6, 12] as const;

function monthsWord(n: number) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return "месяц";
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return "месяца";
  return "месяцев";
}

type DevicesInfo = {
  limit?: number;
  can_buy?: boolean;
  extra_device_price?: number;
  device_prices?: number[]; // цена n-го устройства в месяц (индекс n-1)
  addon_months?: number[];
  addons?: { count: number; expires_at: string }[];
};

function StepBtn({ kind, disabled, onClick }: { kind: "minus" | "plus"; disabled: boolean; onClick: () => void }) {
  const plus = kind === "plus";
  return (
    <button
      type="button"
      aria-label={plus ? "Больше" : "Меньше"}
      disabled={disabled}
      onClick={onClick}
      className="blin-press"
      style={{
        ...btnReset,
        width: 48,
        height: 48,
        flex: "none",
        borderRadius: 16,
        border: `1px solid ${O.border}`,
        background: O.bg,
        color: O.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <OIcon name={plus ? "plus" : "minus"} size={20} />
    </button>
  );
}

function SumRow({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: strong ? "12px 0 0" : "4px 0" }}>
      <span style={{ fontSize: strong ? 20 : 14, lineHeight: strong ? "28px" : "20px", color: strong ? O.text : O.muted, fontWeight: strong ? 800 : 400 }}>{label}</span>
      <span style={{ fontSize: strong ? 24 : 14, lineHeight: strong ? "32px" : "20px", color: O.text, fontWeight: strong ? 800 : 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}

export default function IncreaseDevices() {
  const navigate = useNavigate();
  const goBack = useSmartBack("/subscription");

  const [loaded, setLoaded] = useState(false);
  const [current, setCurrent] = useState(1);
  const [price, setPrice] = useState(49);
  const [table, setTable] = useState<number[]>([]);
  const [periods, setPeriods] = useState<number[]>([...PERIODS]);
  const [subId, setSubId] = useState<number | null>(null);
  const [subUntil, setSubUntil] = useState<string | null>(null);
  const [isTrial, setIsTrial] = useState(false);

  const [add, setAdd] = useState(1);
  const [months, setMonths] = useState(1);

  const [quote, setQuote] = useState<{ price: number; full: number; discount: number } | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const d = await appFetch<DevicesInfo>("/devices");
        if (d.limit) setCurrent(Math.max(1, Number(d.limit)));
        if (d.extra_device_price) setPrice(Number(d.extra_device_price));
        if (Array.isArray(d.device_prices)) setTable(d.device_prices.map(Number));
        if (Array.isArray(d.addon_months) && d.addon_months.length) setPeriods(d.addon_months);
      } catch { /* defaults */ }
      try {
        const sub = await fetchSubscription();
        const k = sub?.key;
        if (k?.id) setSubId(Number(k.id));
        if (k?.type === "trial") setIsTrial(true);
        setSubUntil(sub?.until || (k?.expiry_date ? String(k.expiry_date) : null));
        if (k?.devices_limit) setCurrent((c) => Math.max(c, Number(k.devices_limit)));
      } catch { /* defaults */ } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const maxAdd = Math.max(0, MAX_DEVICES - current);
  const count = Math.min(Math.max(1, add), Math.max(1, maxAdd));
  // у каждого устройства (по номеру) своя цена — настраивается в панели
  const priceOf = (n: number) => (table.length ? Number(table[Math.min(n, table.length) - 1] ?? price) : price);
  let perMonth = 0;
  for (let n = current + 1; n <= current + count; n++) perMonth += priceOf(n);
  const estimate = perMonth * months;
  const nextPrice = priceOf(current + 1);

  // цена с сервера (скидки), с небольшой задержкой при щёлканье
  useEffect(() => {
    if (!loaded || isTrial || maxAdd <= 0) return;
    let alive = true;
    setQuoteBusy(true);
    const t = window.setTimeout(() => {
      void fetchQuote({
        plan_devices: 1,
        months,
        method: "sbp",
        extra_devices: count,
        purpose: "devices",
        subscription_id: subId,
        use_referral_balance: false,
      }).then((q) => {
        if (!alive) return;
        setQuote(q ? { price: Math.round(q.price), full: Math.round(q.full_price ?? q.price), discount: Number(q.discount_percent || 0) } : null);
        setQuoteBusy(false);
      });
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [count, months, subId, loaded, isTrial, maxAdd]);

  const total = quote ? quote.price : estimate;
  const hasDiscount = !!quote && quote.discount > 0 && quote.full > quote.price;

  // устройства переживут подписку → предупредить
  const outlivesSub = useMemo(() => {
    if (!subUntil) return false;
    const end = Date.now() + months * 30 * 86_400_000;
    return end > new Date(subUntil).getTime() + 86_400_000;
  }, [subUntil, months]);

  const pay = () => {
    navigate(`/payment?type=devices&count=${count}&months=${months}${subId ? `&sub=${subId}` : ""}`);
  };

  const rise = (i: number): React.CSSProperties => ({
    animation: loaded ? `blinvpnRise 0.6s var(--ease-out) ${0.05 * i}s both` : undefined,
    opacity: loaded ? undefined : 0,
  });

  useTgBack(goBack);
  return (
    <OScreen>
      <OBack onClick={goBack} />

      <div style={rise(0)}>
        <OTitle sub={isTrial
          ? "В пробной подписке докупать устройства нельзя. Оформите подписку — и сможете добавить сколько нужно."
          : `Сейчас ${current}. Следующее устройство стоит ${nextPrice} ₽ в месяц.`}>
          Купить устройства
        </OTitle>
      </div>

      {isTrial ? (
        <div style={{ ...rise(1), paddingTop: 16 }}>
          <NoirButton primary icon="bolt" onClick={() => navigate("/subscription/extend")}>Оформить подписку</NoirButton>
        </div>
      ) : maxAdd <= 0 && loaded ? (
        <NoirCard style={{ ...rise(1), marginTop: 16, padding: 16, fontSize: 14, lineHeight: "20px", color: O.muted }}>
          В подписке уже максимум — {MAX_DEVICES} устройств.
        </NoirCard>
      ) : (
        <>
          <NoirCard style={{ ...rise(1), marginTop: 16, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, lineHeight: "24px", color: O.text }}>Сколько добавить</div>
              <div style={{ fontSize: 14, lineHeight: "20px", color: O.muted }}>Станет {current + count}</div>
            </div>
            <StepBtn kind="minus" disabled={count <= 1} onClick={() => setAdd(Math.max(1, count - 1))} />
            <div style={{ width: 40, textAlign: "center", fontSize: 24, fontWeight: 800, lineHeight: "36px", color: O.text, fontVariantNumeric: "tabular-nums" }}>
              {count}
            </div>
            <StepBtn kind="plus" disabled={count >= maxAdd} onClick={() => setAdd(Math.min(maxAdd, count + 1))} />
          </NoirCard>

          <div style={{ ...rise(2), paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted }}>На сколько месяцев</div>
          <div style={{ ...rise(2), display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, paddingTop: 16 }}>
            {periods.map((m) => {
              const on = m === months;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMonths(m)}
                  className="blin-press"
                  aria-pressed={on}
                  style={{
                    ...btnReset,
                    fontFamily: N.font,
                    textAlign: "left",
                    padding: 16,
                    minHeight: 90,
                    borderRadius: 24,
                    border: `1px solid ${on ? O.red : O.border}`,
                    background: on ? "rgba(227, 27, 35, 0.14)" : O.card,
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    cursor: "pointer",
                    transition: "border-color 0.18s ease, background 0.18s ease",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 16, fontWeight: 600, lineHeight: "24px", color: O.text }}>{m} {monthsWord(m)}</span>
                  <span style={{ fontSize: 20, fontWeight: 800, lineHeight: "28px", color: O.text }}>{price * count * m} ₽</span>
                </button>
              );
            })}
          </div>

          <NoirCard style={{ ...rise(3), marginTop: 16, padding: "16px" }}>
            <SumRow label="Устройства" value={`+${count}`} />
            <SumRow label="Срок" value={`${months} ${monthsWord(months)}`} />
            <SumRow label="Расчёт" value={`${price} ₽ × ${count} × ${months}`} />
            {hasDiscount ? <SumRow label="Скидка" value={`−${Math.round(quote!.discount)}%`} /> : null}
            {hasDiscount ? <><div style={{ height: 1, background: O.border, marginTop: 8 }} />
            <SumRow
              strong
              label="К оплате"
              value={
                <>
                  {hasDiscount ? (
                    <span style={{ fontSize: 15, color: N.dim, textDecoration: "line-through", marginRight: 8, fontWeight: 400 }}>
                      {quote!.full} ₽
                    </span>
                  ) : null}
                  {quoteBusy && !quote ? "…" : `${total} ₽`}
                </>
              }
            /></> : null}
          </NoirCard>

          {outlivesSub && subUntil ? (
            <div style={{ ...rise(4), paddingTop: 12, fontSize: 14, lineHeight: "20px", color: O.muted }}>
              Подписка действует до {formatDateRu(subUntil)}. Устройства будут работать, пока активна подписка, — не забудьте её продлить.
            </div>
          ) : null}

          <div style={{ ...rise(4), paddingTop: 16 }}>
            <NoirButton primary disabled={!loaded || quoteBusy} onClick={pay}>
              {quoteBusy ? "Считаем…" : `Оплатить ${total} ₽`}
            </NoirButton>
          </div>
        </>
      )}
    </OScreen>
  );
}
