import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch, fetchQuote, fetchSubscription } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { MSIcon, btnReset } from "../components/ui";
import { N, NoirBack, NoirButton, NoirCard, NoirScreen } from "../components/noir";

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
        width: 40,
        height: 40,
        flex: "none",
        borderRadius: "50%",
        border: plus ? "none" : `1px solid ${N.cardBorder}`,
        background: plus ? (disabled ? "rgba(224,0,0,0.3)" : N.red) : "transparent",
        color: plus ? "#fff" : disabled ? N.dim : N.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: !plus && disabled ? 0.55 : 1,
      }}
    >
      <MSIcon name={plus ? "add" : "remove"} style={{ fontSize: 22, color: "inherit", fontVariationSettings: "'wght' 300" }} />
    </button>
  );
}

function SumRow({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: strong ? "16px 0 2px" : "6px 0" }}>
      <span style={{ fontSize: strong ? 17 : 15.5, color: strong ? N.text : N.muted, fontWeight: strong ? 500 : 400 }}>{label}</span>
      <span style={{ fontSize: strong ? 20 : 15.5, color: N.text, fontWeight: strong ? 600 : 400, textAlign: "right" }}>{value}</span>
    </div>
  );
}

export default function IncreaseDevices() {
  const navigate = useNavigate();
  const goBack = useSmartBack("/subscription");

  const [loaded, setLoaded] = useState(false);
  const [current, setCurrent] = useState(1);
  const [price, setPrice] = useState(49);
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
  const estimate = price * count * months;

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

  return (
    <NoirScreen>
      <div style={{ paddingTop: 20, marginBottom: 22 }}>
        <NoirBack onClick={goBack} />
      </div>

      <div style={rise(0)}>
        <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.15, color: N.text }}>
          Купить устройства
        </div>
        <div style={{ marginTop: 10, fontSize: 15.5, lineHeight: 1.5, color: N.muted }}>
          {isTrial
            ? "В пробной подписке докупать устройства нельзя. Оформите подписку — и сможете добавить сколько нужно."
            : `Сейчас ${current}. Одно дополнительное устройство стоит ${price} ₽ в месяц. Выберите, сколько добавить и на какой срок.`}
        </div>
      </div>

      {isTrial ? (
        <div style={{ ...rise(1), marginTop: 24 }}>
          <NoirButton primary icon="bolt" onClick={() => navigate("/subscription/extend")}>Оформить подписку</NoirButton>
        </div>
      ) : maxAdd <= 0 && loaded ? (
        <NoirCard style={{ ...rise(1), marginTop: 22, padding: "16px 18px", fontSize: 15, color: N.muted }}>
          В подписке уже максимум — {MAX_DEVICES} устройств.
        </NoirCard>
      ) : (
        <>
          <NoirCard style={{ ...rise(1), marginTop: 22, padding: "16px 16px 16px 18px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 500, color: N.text }}>Сколько добавить</div>
              <div style={{ marginTop: 5, fontSize: 14.5, color: N.muted }}>Станет {current + count}</div>
            </div>
            <StepBtn kind="minus" disabled={count <= 1} onClick={() => setAdd(Math.max(1, count - 1))} />
            <div style={{ width: 40, textAlign: "center", fontSize: 19, fontWeight: 500, color: N.text, fontVariantNumeric: "tabular-nums" }}>
              {count}
            </div>
            <StepBtn kind="plus" disabled={count >= maxAdd} onClick={() => setAdd(Math.min(maxAdd, count + 1))} />
          </NoirCard>

          <div style={{ ...rise(2), margin: "22px 0 12px", fontSize: 15, color: N.muted }}>На сколько месяцев</div>
          <div style={{ ...rise(2), display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
                    padding: "18px 17px",
                    minHeight: 80,
                    borderRadius: 22,
                    border: `1.5px solid ${on ? N.red : N.cardBorder}`,
                    background: on ? "rgba(120, 0, 0, 0.32)" : N.card,
                    backdropFilter: "blur(10px)",
                    WebkitBackdropFilter: "blur(10px)",
                    cursor: "pointer",
                    transition: "border-color 0.18s ease, background 0.18s ease",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 17.5, fontWeight: 600, color: N.text }}>{m} {monthsWord(m)}</span>
                  <span style={{ fontSize: 14.5, color: N.muted }}>{price * count * m} ₽</span>
                </button>
              );
            })}
          </div>

          <NoirCard style={{ ...rise(3), marginTop: 12, padding: "12px 18px 16px" }}>
            <SumRow label="Устройства" value={`+${count}`} />
            <SumRow label="Срок" value={`${months} ${monthsWord(months)}`} />
            <SumRow label="Расчёт" value={`${price} ₽ × ${count} × ${months}`} />
            {hasDiscount ? <SumRow label="Скидка" value={`−${Math.round(quote!.discount)}%`} /> : null}
            <div style={{ height: 1, background: N.divider, marginTop: 10 }} />
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
            />
          </NoirCard>

          {outlivesSub && subUntil ? (
            <div style={{ ...rise(4), marginTop: 12, fontSize: 13.5, lineHeight: 1.5, color: N.muted }}>
              Подписка действует до {formatDateRu(subUntil)}. Устройства будут работать, пока активна подписка, — не забудьте её продлить.
            </div>
          ) : null}

          <div style={{ ...rise(4), marginTop: 22 }}>
            <NoirButton primary disabled={!loaded || quoteBusy} onClick={pay}>
              {quoteBusy ? "Считаем…" : `Оплатить ${total} ₽`}
            </NoirButton>
          </div>
        </>
      )}
    </NoirScreen>
  );
}
