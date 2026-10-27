// FGN: «Купить устройства» (переопределение src/app/pages/IncreaseDevices.tsx), макет 51.
// Шапка, подпись 14/20, карточка «Сколько добавить» со степпером (круги 40), «НА СКОЛЬКО МЕСЯЦЕВ»,
// сетка 2×2 карточек периодов (78, радиус 16, выбранная — белая рамка), карточка расчёта (строки 32), кнопка 52.
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch, fetchQuote, fetchSubscription } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { C, FgnHeader, FgnIcon, FgnPage, fgnButton } from "../components/fgn";

const MAX_DEVICES = 50;
const PERIODS = [1, 3, 6, 12] as const;

const MUTED = "#9B9BA4";
const LABEL = "#6E6E78";
const CARD_BG = "#141416";
const CARD_BORDER = "#2A2A30";
const TEXT = "#F4F4F5";

function monthsWord(n: number) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return "месяц";
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return "месяца";
  return "месяцев";
}

// «1 100 ₽» — группы разрядов через неразрывный пробел
const rub = (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;

type DevicesInfo = {
  limit?: number;
  can_buy?: boolean;
  extra_device_price?: number;
  device_prices?: number[]; // цена n-го устройства в месяц (индекс n-1)
  addon_months?: number[];
};

const card: React.CSSProperties = {
  borderRadius: 16,
  border: `1px solid ${CARD_BORDER}`,
  background: CARD_BG,
  boxSizing: "border-box",
};

/** круглая кнопка степпера: 40, контур #2A2A30 */
function StepBtn({ icon, label, disabled, onClick }: { icon: string; label: string; disabled: boolean; onClick: () => void }) {
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
        width: 40,
        height: 40,
        flexShrink: 0,
        borderRadius: "50%",
        background: "transparent",
        border: `1px solid ${CARD_BORDER}`,
        color: disabled ? "rgba(244, 244, 245, 0.3)" : TEXT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        boxSizing: "border-box",
        transition: "color 0.15s ease",
      }}
    >
      <FgnIcon name={icon} size={17} stroke={1.5} />
    </button>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        height: 32,
        marginTop: strong ? 4 : 0,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: strong ? 16 : 14, fontWeight: strong ? 500 : 400, color: strong ? TEXT : MUTED }}>{label}</span>
      <span style={{ fontSize: strong ? 16 : 14, fontWeight: strong ? 600 : 400, color: TEXT, fontVariantNumeric: "tabular-nums" }}>{value}</span>
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

  useEffect(() => {
    void (async () => {
      try {
        const d = await appFetch<DevicesInfo>("/devices");
        if (d.limit) setCurrent(Math.max(1, Number(d.limit)));
        if (d.extra_device_price) setPrice(Number(d.extra_device_price));
        if (Array.isArray(d.device_prices)) setTable(d.device_prices.map(Number));
        if (Array.isArray(d.addon_months) && d.addon_months.length) setPeriods(d.addon_months);
      } catch { /* значения по умолчанию */ }
      try {
        const sub = await fetchSubscription();
        const k = sub?.key;
        if (k?.id) setSubId(Number(k.id));
        if (k?.type === "trial") setIsTrial(true);
        setSubUntil(sub?.until || (k?.expiry_date ? String(k.expiry_date) : null));
        if (k?.devices_limit) setCurrent((c) => Math.max(c, Number(k.devices_limit)));
      } catch { /* значения по умолчанию */ } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const maxAdd = Math.max(0, MAX_DEVICES - current);
  const count = Math.min(Math.max(1, add), Math.max(1, maxAdd));
  // у каждого устройства (по номеру) своя цена — настраивается в панели
  const priceOf = (n: number) => (table.length ? Number(table[Math.min(n, table.length) - 1] ?? price) : price);
  const monthlyFor = (c: number) => {
    let s = 0;
    for (let n = current + 1; n <= current + c; n++) s += priceOf(n);
    return s;
  };
  const perMonth = monthlyFor(count);
  const estimate = perMonth * months;
  const nextPrice = Math.round(priceOf(current + 1));
  const flat = perMonth === nextPrice * count; // все добавляемые устройства по одной цене

  // цена с сервера (скидки), с небольшой задержкой при щёлканье
  useEffect(() => {
    if (!loaded || isTrial || maxAdd <= 0) return;
    let alive = true;
    setQuote(null);
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

  const fade: React.CSSProperties = { animation: "fgnFade 0.35s ease both" };

  return (
    <FgnPage>
      <FgnHeader title="Купить устройства" onBack={goBack} btnStyle={{ background: CARD_BG, borderColor: CARD_BORDER }} />

      <div style={{ marginTop: 20, fontSize: 14, lineHeight: "20px", color: MUTED }}>
        {isTrial
          ? "В пробной подписке докупать устройства нельзя. Оформите подписку — и сможете добавить сколько нужно."
          : `Сейчас ${current}. Одно дополнительное устройство стоит ${rub(nextPrice)} в месяц.`}
      </div>

      {!loaded ? null : isTrial ? (
        <button
          type="button"
          className="blin-press"
          onClick={() => navigate("/subscription/extend")}
          style={{ ...fgnButton, ...fade, marginTop: 22, height: 52, borderRadius: 16, background: "#F3F3F4", fontSize: 16, letterSpacing: 0 }}
        >
          Оформить подписку
        </button>
      ) : maxAdd <= 0 ? (
        <div style={{ ...card, ...fade, marginTop: 16, padding: "15px 16px", fontSize: 14, lineHeight: "20px", color: MUTED }}>
          В подписке уже максимум — {MAX_DEVICES} устройств.
        </div>
      ) : (
        <>
          {/* сколько добавить */}
          <div style={{ ...card, ...fade, marginTop: 16, padding: "16px 16px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", height: 40 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 500, lineHeight: "20px", color: TEXT, whiteSpace: "nowrap" }}>
                Сколько добавить
              </div>
              <StepBtn icon="minus" label="Меньше" disabled={count <= 1} onClick={() => setAdd(Math.max(1, count - 1))} />
              <div style={{ width: 48, textAlign: "center", fontSize: 18, fontWeight: 500, lineHeight: "22px", color: TEXT, fontVariantNumeric: "tabular-nums" }}>
                {count}
              </div>
              <StepBtn icon="plus" label="Больше" disabled={count >= maxAdd} onClick={() => setAdd(Math.min(maxAdd, count + 1))} />
            </div>
            <div style={{ marginTop: 7, fontSize: 14, lineHeight: "20px", color: MUTED }}>Станет {current + count}</div>
          </div>

          {/* на сколько месяцев */}
          <div
            style={{
              ...fade,
              marginTop: 25.5,
              fontSize: 12,
              fontWeight: 600,
              lineHeight: "16px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: LABEL,
            }}
          >
            На сколько месяцев
          </div>
          <div style={{ ...fade, marginTop: 7.5, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
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
                    ...card,
                    appearance: "none",
                    margin: 0,
                    height: 78,
                    padding: "18px 12px 0",
                    border: `1px solid ${on ? "#F3F3F4" : CARD_BORDER}`,
                    color: TEXT,
                    fontFamily: C.font,
                    textAlign: "left",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    cursor: "pointer",
                    transition: "border-color 0.18s ease",
                  }}
                >
                  <span style={{ fontSize: 16, fontWeight: 500, lineHeight: "20px", whiteSpace: "nowrap" }}>{m} {monthsWord(m)}</span>
                  <span style={{ marginTop: 1.5, fontSize: 14, lineHeight: "20px", color: MUTED, whiteSpace: "nowrap" }}>{rub(perMonth * m)}</span>
                </button>
              );
            })}
          </div>

          {/* расчёт */}
          <div style={{ ...card, ...fade, marginTop: 16, padding: "16px 16px 17px" }}>
            <Row label="Устройства" value={`+${count}`} />
            <Row label="Срок" value={`${months} мес.`} />
            <Row
              label="Расчёт"
              value={flat ? `${rub(nextPrice)} × ${count} × ${months}` : `${rub(perMonth)} × ${months}`}
            />
            {hasDiscount ? <Row label="Скидка" value={`−${Math.round(quote!.discount)}%`} /> : null}
            <Row
              strong
              label="К оплате"
              value={
                <>
                  {hasDiscount ? (
                    <span style={{ fontSize: 14, fontWeight: 400, color: MUTED, textDecoration: "line-through", marginRight: 8 }}>
                      {rub(quote!.full)}
                    </span>
                  ) : null}
                  {rub(total)}
                </>
              }
            />
          </div>

          {outlivesSub && subUntil ? (
            <div style={{ ...fade, marginTop: 12, fontSize: 13, lineHeight: "18px", color: MUTED }}>
              Подписка действует до {formatDateRu(subUntil)}. Устройства работают, пока активна подписка, — не забудьте её продлить.
            </div>
          ) : null}

          <button
            type="button"
            className="blin-press"
            onClick={pay}
            style={{ ...fgnButton, ...fade, marginTop: 21, flexShrink: 0, height: 52, borderRadius: 16, background: "#F3F3F4", fontSize: 16, letterSpacing: 0 }}
          >
            Оплатить {rub(total)}
          </button>
        </>
      )}
    </FgnPage>
  );
}
