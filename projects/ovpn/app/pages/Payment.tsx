import React, { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { MSIcon, btnReset } from "../components/ui";
import { useAppError } from "../components/ErrorModal";
import PaymentSheet, { type PendingPayment } from "../components/PaymentSheet";
import { N, NoirButton, NoirCard, useTgBack } from "../components/noir";
import { O, OBack, OIcon, OScreen, OTitle } from "../components/ovpn";

// O-VPN: 08 «Способ оплаты»
import { useSmartBack } from "../utils/navigation";
import {
  createPayment,
  fetchConfig,
  fetchMe,
  extraAbovePack,
  fetchQuote,
  PLAN_PACK_DEVICES,
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
import { redeemPromo, type DayGift } from "../utils/api";
import { hasFeature } from "../utils/brand";
import { DayGiftSheet } from "../components/DayGiftSheet";

// промокод прямо на экране оплаты (фишка проекта promo_at_payment)
function PromoField({ onDiscount, onDayGift }: { onDiscount: () => void; onDayGift: (g: DayGift) => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const apply = async () => {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await redeemPromo(c);
      if (r.type === "days" && r.gift_id) {
        onDayGift({ id: r.gift_id, days: Number(r.days || 0), source: "promo", text: r.message || "" });
        setNote({ ok: true, text: `+${r.days} дн. к подписке — заберите подарок` });
      } else if (r.type === "gift") {
        setNote({ ok: true, text: "Подарок активирован — подписка уже ваша" });
      } else {
        setNote({ ok: true, text: `Скидка ${Math.round(Number(r.discount_percent ?? r.value ?? 0))}% применена` });
        onDiscount();
      }
      setCode("");
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Не удалось применить промокод" });
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="blin-press"
        style={{ ...btnReset, marginTop: 12, alignSelf: "flex-start", fontFamily: N.font, fontSize: 14, fontWeight: 600, color: O.muted, background: "transparent", border: "none", padding: 0,
                 display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
        <OIcon name="ticket" size={18} /> У меня есть промокод
      </button>
    );
  }
  return (
    <NoirCard style={{ marginTop: 12, padding: "12px 12px 12px 16px" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          value={code}
          autoFocus
          onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/\s+/g, "")); setNote(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") void apply(); }}
          placeholder="Промокод"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          style={{ flex: 1, minWidth: 0, height: 44, border: "none", outline: "none", background: "transparent",
                   color: N.text, fontFamily: N.font, fontSize: 16.5, letterSpacing: code ? "0.05em" : 0 }}
        />
        <button type="button" onClick={() => void apply()} disabled={!code.trim() || busy} className="blin-press"
          style={{ ...btnReset, height: 40, padding: "0 16px", borderRadius: 14, fontFamily: N.font, fontSize: 15,
                   background: code.trim() ? N.red : "rgba(255,255,255,0.08)", color: N.text, cursor: "pointer" }}>
          {busy ? "…" : "Применить"}
        </button>
      </div>
      {note ? <div style={{ marginTop: 6, fontSize: 13.5, color: note.ok ? "#3DD68C" : "#FF6B6B" }}>{note.text}</div> : null}
    </NoirCard>
  );
}

const METHOD_ICON: Record<string, string> = {
  sbp: "landmark",
  card: "credit-card",
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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: strong ? "12px 0 0" : "0 0 8px" }}>
      <span style={{ fontSize: strong ? 20 : 14, lineHeight: strong ? "28px" : "20px", color: strong ? O.text : O.muted, fontWeight: strong ? 800 : 400 }}>{label}</span>
      <span style={{ fontSize: strong ? 24 : 14, lineHeight: strong ? "32px" : "20px", color: accent ? O.green : O.text, fontWeight: strong ? 800 : 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
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
        border: `2px solid ${on ? O.red : O.border}`,
        boxSizing: "border-box",
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
  const [tariffDevices, setTariffDevices] = useState(PLAN_PACK_DEVICES);
  const [trafficNow, setTrafficNow] = useState<TrafficInfo | null>(null);

  useEffect(() => { if (isTrafficReset) void fetchTraffic().then(setTrafficNow); }, [isTrafficReset]);
  useEffect(() => {
    if (purpose !== "subscription" && purpose !== "gift") return;
    setTariffDevices(PLAN_PACK_DEVICES);
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
      ? extraAbovePack(totalDevices, planDevices)
      : 0;

  const [promoTick, setPromoTick] = useState(0);
  const [dayGift, setDayGift] = useState<DayGift | null>(null);
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
      });
      if (!alive) return;
      setQuote(q);
      setQuoteReady(true);

    })();
    return () => { alive = false; };
  }, [planDevices, method, extraDevices, useRefBal, purpose, subParam, months, methodsReady, isStars, promoTick]);

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

  useTgBack(goBack);
  // подписку покупают через выбор тарифа
  if (purpose === "subscription" && !hasPeriod) {
    return <Navigate to={`/tariffs${returnTo ? `?return=${encodeURIComponent(returnTo)}` : ""}`} replace />;
  }

  const what = isGift
    ? `Подарок другу: ${periodLabel(months)} · ${planDevices} ${deviceWord(planDevices)}`
    : isTrafficReset
    ? `Досрочный сброс трафика${trafficNow?.available && trafficNow.used_bytes != null ? ` · потрачено ${formatBytesRu(trafficNow.used_bytes)}${trafficNow.limit_bytes ? ` из ${formatBytesRu(trafficNow.limit_bytes)}` : ""}` : ""}`
    : isDevicesFlow
      ? `Доп. устройства: +${extraDevices} на ${periodLabel(months)}`
      : `${periodLabel(months)} · ${devNow} ${deviceWord(devNow)}`;

  const v = (n: number) => (quoteReady ? fmt(n) : "…");

  return (
    <OScreen>
      <OBack onClick={goBack} />
      <OTitle sub={what}>Способ оплаты</OTitle>

      <NoirCard style={{ marginTop: 16, padding: 16 }}>
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
        <div style={{ height: 1, background: O.border, marginTop: 4 }} />
        <SumRow strong label="Итого" value={quoteReady ? (isStars ? `${Math.round(total)} ⭐` : fmt(paidFromBalance ? 0 : total)) : "…"} />
      </NoirCard>
      {hasFeature("promo_at_payment") && !isGift ? (
        <PromoField onDiscount={() => setPromoTick((t) => t + 1)} onDayGift={setDayGift} />
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
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
                minHeight: 74,
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                borderRadius: 24,
                border: `1px solid ${on ? O.red : O.border}`,
                background: O.card,
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                cursor: off ? "default" : "pointer",
                transition: "border-color 0.18s ease, background 0.18s ease",
                color: N.text,
              }}
            >
              <span style={{ flex: "none", width: 48, height: 48, borderRadius: 16, background: O.bg, border: `1px solid ${O.border}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", opacity: off ? 0.55 : 1, color: on ? O.red : O.text }}>
                <OIcon name={METHOD_ICON[m.id] || "wallet"} size={20} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 16, fontWeight: 600, lineHeight: "24px", color: off ? O.muted : O.text }}>{m.title}</span>
                <span style={{ display: "block", fontSize: 14, lineHeight: "20px", color: O.muted }}>{sub}</span>
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

      <div style={{ marginTop: "auto", paddingTop: 16 }}>
        <NoirButton primary disabled={paying || !quoteReady || belowMin || methodOff} onClick={() => void handlePay()}>
          {payLabel}
        </NoirButton>
      </div>

      {pending ? <PaymentSheet payment={pending} returnTo={returnTo} onClose={() => setPending(null)} /> : null}
      {dayGift ? <DayGiftSheet gift={dayGift} onClose={() => setDayGift(null)} /> : null}
    </OScreen>
  );
}
