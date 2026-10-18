import React, { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { MSIcon, btnReset } from "../components/ui";
import { useAppError } from "../components/ErrorModal";
import PaymentSheet, { type PendingPayment } from "../components/PaymentSheet";
import { N, NoirBack, NoirButton, NoirCard, NoirScreen } from "../components/noir";
import { useSmartBack } from "../utils/navigation";
import {
  createPayment,
  fetchConfig,
  fetchMe,
  fetchQuote,
  fetchTariffs,
  fetchTraffic,
  formatBytesRu,
  openPayUrl,
  openStarsInvoice,
  type PayMethodInfo,
  type PaymentMethod,
  type PaymentQuote,
  type TrafficInfo,
} from "../utils/api";
import { deviceWord } from "../utils/devices";

const METHOD_ICON: Record<string, string> = {
  sbp: "account_balance",
  card: "credit_card",
  tg_stars: "star",
};

// на случай, если сервер не прислал список
const FALLBACK_METHODS: PayMethodInfo[] = [
  { id: "sbp", title: "СБП", enabled: true },
  { id: "card", title: "Банковские карты", enabled: true },
  { id: "tg_stars", title: "Telegram Stars", enabled: true },
];

function periodLabel(m: number) {
  if (m === 12) return "1 год";
  return `${m} ${m === 1 ? "месяц" : m < 5 ? "месяца" : "месяцев"}`;
}

function fmt(n: number) {
  return `${Math.round(n).toLocaleString("ru-RU")} ₽`;
}

function SumRow({ label, value, strong, accent }: { label: string; value: React.ReactNode; strong?: boolean; accent?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: strong ? "14px 0 0" : "6px 0" }}>
      <span style={{ fontSize: strong ? 18 : 15.5, color: strong ? N.text : N.muted, fontWeight: strong ? 500 : 400 }}>{label}</span>
      <span style={{ fontSize: strong ? 21 : 15.5, color: accent ? "#3DD68C" : N.text, fontWeight: strong ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        flex: "none",
        width: 24,
        height: 24,
        borderRadius: "50%",
        border: `1.5px solid ${on ? N.red : "rgba(255,255,255,0.22)"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "border-color 0.18s ease",
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: "50%", background: N.red, transform: on ? "scale(1)" : "scale(0)", transition: "transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)" }} />
    </span>
  );
}

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      style={{ ...btnReset, position: "relative", flex: "none", width: 50, height: 30, borderRadius: 15, border: "none", background: on ? N.red : "rgba(255,255,255,0.14)", cursor: "pointer", transition: "background 0.2s ease" }}
    >
      <span style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", transition: "left 0.22s cubic-bezier(0.22, 1, 0.36, 1)" }} />
    </button>
  );
}

export default function Payment() {
  const { showError } = useAppError();
  const goBack = useSmartBack("/");
  const [searchParams] = useSearchParams();

  const returnTo = searchParams.get("return") || "";
  const flowType = searchParams.get("type");
  // подписка и доп. устройства — 1/3/6/12 месяцев
  const monthsParam = parseInt(searchParams.get("months") || "0", 10);
  const hasPeriod = [1, 3, 6, 12].includes(monthsParam);
  const months = hasPeriod && flowType !== "traffic_reset" ? monthsParam : 1;
  // белые списки (отдельный тариф с анти-ключом): подписка или подарок
  // единый тариф: белые списки включаются сервером автоматически (подписка/продление/подарок)
  const whitelist = false;
  const subParam = searchParams.get("sub");
  const isDevicesFlow = flowType === "devices";
  const isTrafficReset = flowType === "traffic_reset";
  const isGift = flowType === "gift";
  const purpose: "subscription" | "devices" | "traffic_reset" | "gift" = isTrafficReset ? "traffic_reset" : isDevicesFlow ? "devices" : isGift ? "gift" : "subscription";
  const isSubFlow = purpose === "subscription";
  // подписка/продление: сколько устройств всего выбрано на экране тарифов (?dev=N)
  const devParam = parseInt(searchParams.get("dev") || "0", 10);
  const totalDevices = isSubFlow && devParam > 0 ? Math.min(20, devParam) : null;

  const [methods, setMethods] = useState<PayMethodInfo[]>(FALLBACK_METHODS);
  const [method, setMethod] = useState<PaymentMethod>("sbp");
  const [methodsReady, setMethodsReady] = useState(false);
  const [providerMin, setProviderMin] = useState<Record<string, number>>({ card: 50, sbp: 10 });
  const [refBalance, setRefBalance] = useState(0);
  const [useRefBal, setUseRefBal] = useState(false);
  const [quote, setQuote] = useState<PaymentQuote | null>(null);
  const [quoteReady, setQuoteReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [tariffDevices, setTariffDevices] = useState(3);
  const [trafficNow, setTrafficNow] = useState<TrafficInfo | null>(null);

  useEffect(() => { if (isTrafficReset) void fetchTraffic().then(setTrafficNow); }, [isTrafficReset]);
  useEffect(() => {
    if (purpose !== "subscription" && purpose !== "gift") return;
    void fetchTariffs().then((t) => setTariffDevices(t.devices)).catch(() => { /* по умолчанию */ });
  }, [purpose]);

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await fetchConfig();
        if (cfg?.providerMin && typeof cfg.providerMin === "object") setProviderMin(cfg.providerMin as Record<string, number>);
        const list = Array.isArray(cfg?.payMethods) ? (cfg.payMethods as PayMethodInfo[]) : null;
        if (list && list.length) {
          setMethods(list);
          // по умолчанию — первый доступный
          const first = list.find((m) => m.enabled);
          if (first) setMethod(first.id);
        }
      } catch { /* запасной список */ }
      setMethodsReady(true);
      try {
        const me = await fetchMe();
        if (me && typeof me.partner_balance === "number") setRefBalance(me.partner_balance);
      } catch { /* */ }
    })();
  }, []);

  const planDevices = isDevicesFlow ? 1 : tariffDevices;
  const isStars = method === "tg_stars";
  const extraDevices = isDevicesFlow
    ? Math.max(0, parseInt(searchParams.get("count") || "0", 10))
    : isSubFlow && totalDevices != null
      ? Math.max(0, totalDevices - planDevices)
      : 0;

  useEffect(() => {
    if (!methodsReady) return;
    let alive = true;
    setQuoteReady(false);
    void (async () => {
      const q = await fetchQuote({
        plan_devices: planDevices,
        months,
        method,
        extra_devices: extraDevices,
        purpose,
        subscription_id: subParam ? Number(subParam) : null,
        use_referral_balance: useRefBal && !isStars,
        whitelist,
      });
      if (!alive) return;
      setQuote(q);
      setQuoteReady(true);

    })();
    return () => { alive = false; };
  }, [planDevices, method, extraDevices, useRefBal, purpose, subParam, months, whitelist, methodsReady, isStars]);

  // суммы
  const price = quote ? quote.price : 0;
  const full = quote?.full_price ?? price;
  const discountPct = Number(quote?.discount_percent || 0);
  const refApplied = quote && !isStars ? Math.round(quote.referral_applied) : 0;
  const base = quote ? (isStars ? quote.stars : quote.charge) : 0;
  const total = quote?.total ?? base;
  const pMin = Number(providerMin[method] ?? 10);
  const canUseRef = quoteReady && !isStars && refBalance > 0 && price > 0;
  const paidFromBalance = quoteReady && !isStars && base <= 0 && price > 0;
  const belowMin = quoteReady && !isStars && total > 0 && total < pMin;
  const current = methods.find((m) => m.id === method);
  const methodOff = !current?.enabled;

  const payLabel = !quoteReady
    ? "Считаем…"
    : paying
      ? "Создаём платёж…"
      : methodOff
        ? "Способ недоступен"
        : belowMin
          ? `Минимум ${pMin} ₽`
          : paidFromBalance
            ? "Оплатить с баланса"
            : `Оплатить ${isStars ? `${Math.round(total)} ⭐` : fmt(total)}`;

  const handlePay = async () => {
    if (paying || !quoteReady || methodOff) return;
    if (belowMin) {
      showError(`Минимальная сумма оплаты этим способом — ${pMin} ₽`);
      return;
    }
    setPaying(true);
    try {
      const result = await createPayment({
        plan_devices: planDevices,
        months,
        method,
        extra_devices: extraDevices,
        purpose,
        subscription_id: subParam ? Number(subParam) : null,
        use_referral_balance: canUseRef && useRefBal,
        return_to: returnTo || "/subscription",
        whitelist,
      });
      const goWaiting = (extra: Partial<PendingPayment> = {}) =>
        setPending({
          paymentId: String(result.payment_id),
          provider: String(result.provider || ""),
          invoiceLink: result.invoice_link || undefined,
          purpose,
          method,
          ...extra,
        });
      if (result.provider === "balance" || (result as { paid?: boolean }).paid) {
        goWaiting();
      } else if (result.provider === "tg_stars" && result.invoice_link) {
        void openStarsInvoice(result.invoice_link);
        goWaiting();
      } else if (result.pay_url) {
        openPayUrl(result.pay_url);
        goWaiting({ payUrl: result.pay_url });
      } else {
        goWaiting();
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : "Ошибка оплаты");
    } finally {
      setPaying(false);
    }
  };

  // устройства в подписке (сервер учитывает и те, что уже есть сверх тарифа)
  const devNow = Number(quote?.devices_total || totalDevices || planDevices);
  const devExtra = Math.max(0, devNow - planDevices);
  const showBreakdown = isSubFlow && devExtra > 0 && quote?.base_price != null;

  // подписку покупают через выбор тарифа
  if (purpose === "subscription" && !hasPeriod) {
    return <Navigate to={`/tariffs${returnTo ? `?return=${encodeURIComponent(returnTo)}` : ""}`} replace />;
  }

  const what = isGift
    ? `Подарок другу: ${periodLabel(months)} · ${planDevices} ${deviceWord(planDevices)}${quote?.whitelist ? " · белые списки" : ""}`
    : isTrafficReset
    ? `Досрочный сброс трафика${trafficNow?.available && trafficNow.used_bytes != null ? ` · потрачено ${formatBytesRu(trafficNow.used_bytes)}${trafficNow.limit_bytes ? ` из ${formatBytesRu(trafficNow.limit_bytes)}` : ""}` : ""}`
    : isDevicesFlow
      ? `Доп. устройства: +${extraDevices} на ${periodLabel(months)}`
      : `${periodLabel(months)} · ${devNow} ${deviceWord(devNow)}${quote?.whitelist ? " · белые списки" : ""}`;

  const v = (n: number) => (quoteReady ? fmt(n) : "…");

  return (
    <NoirScreen>
      <div style={{ paddingTop: 20, marginBottom: 22 }}>
        <NoirBack onClick={goBack} />
      </div>
      <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.15, color: N.text }}>Способ оплаты</div>
      <div style={{ marginTop: 8, fontSize: 14.5, color: N.muted, lineHeight: 1.4 }}>{what}</div>

      <NoirCard style={{ marginTop: 20, padding: "12px 18px 18px" }}>
        {showBreakdown && quote?.base_price != null ? (
          <>
            <SumRow label={`Тариф · ${periodLabel(months)}`} value={v(Number(quote.base_price))} />
            <SumRow label={`Доп. устройства · ${devExtra} × ${months} мес`} value={v(Number(quote.devices_price || 0))} />
          </>
        ) : null}
        <SumRow
          label="Сумма"
          value={
            <>
              {discountPct > 0 && full > price && quoteReady ? (
                <span style={{ color: N.dim, textDecoration: "line-through", marginRight: 8 }}>{fmt(full)}</span>
              ) : null}
              {v(price)}
            </>
          }
        />
        {discountPct > 0 && quoteReady ? <SumRow label="Скидка" value={`−${Math.round(discountPct)}%`} accent /> : null}
        {refApplied > 0 ? <SumRow label="С баланса" value={`−${fmt(refApplied)}`} /> : null}
        <div style={{ height: 1, background: N.divider, marginTop: 10 }} />
        <SumRow strong label="Итого" value={quoteReady ? (isStars ? `${Math.round(total)} ⭐` : fmt(paidFromBalance ? 0 : total)) : "…"} />
      </NoirCard>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
        {methods.map((m) => {
          const on = m.id === method;
          const off = !m.enabled;
          const sub = off ? "пока недоступно" : "без комиссии";
          return (
            <button
              key={m.id}
              type="button"
              disabled={off}
              onClick={() => setMethod(m.id)}
              className="blin-press"
              aria-pressed={on}
              style={{
                ...btnReset,
                fontFamily: N.font,
                width: "100%",
                minHeight: 76,
                padding: "12px 18px 12px 14px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                textAlign: "left",
                borderRadius: 26,
                border: `1.5px solid ${on ? N.red : N.cardBorder}`,
                background: on ? "rgba(120, 0, 0, 0.32)" : N.card,
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                cursor: off ? "default" : "pointer",
                transition: "border-color 0.18s ease, background 0.18s ease",
                color: N.text,
              }}
            >
              <span style={{ flex: "none", width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", opacity: off ? 0.55 : 1 }}>
                <MSIcon name={METHOD_ICON[m.id] || "payments"} style={{ fontSize: 23, color: N.text, fontVariationSettings: "'wght' 300" }} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 17.5, fontWeight: 400, color: off ? "rgba(255,255,255,0.75)" : N.text }}>{m.title}</span>
                <span style={{ display: "block", marginTop: 4, fontSize: 14, color: N.muted }}>{sub}</span>
              </span>
              <Radio on={on} />
            </button>
          );
        })}
      </div>

      {canUseRef ? (
        <NoirCard style={{ marginTop: 12, padding: "14px 16px 14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, color: N.text }}>Списать с баланса</div>
            <div style={{ marginTop: 3, fontSize: 13.5, color: N.muted }}>
              {useRefBal && refApplied > 0 ? `−${refApplied} ₽ · останется ${Math.max(0, Math.floor(refBalance) - refApplied)} ₽` : `доступно ${Math.floor(refBalance)} ₽`}
            </div>
          </div>
          <Switch on={useRefBal} onToggle={() => setUseRefBal((x) => !x)} />
        </NoirCard>
      ) : null}

      <div style={{ marginTop: "auto", paddingTop: 22 }}>
        <NoirButton primary disabled={paying || !quoteReady || belowMin || methodOff} onClick={() => void handlePay()}>
          {payLabel}
        </NoirButton>
      </div>

      {pending ? <PaymentSheet payment={pending} returnTo={returnTo} onClose={() => setPending(null)} /> : null}
    </NoirScreen>
  );
}
