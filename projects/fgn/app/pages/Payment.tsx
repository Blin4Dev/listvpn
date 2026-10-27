// FGN: «Способ оплаты» (переопределение src/app/pages/Payment.tsx; маршрут /payment). Логика — как в оригинале.
// Макет: шапка «назад» + заголовок, подпись (что покупаем), карточка «Сумма / Итого», три способа оплаты
// (карточки 70px, выбранная — с белой рамкой и заполненной радиокнопкой), строка «У меня есть промокод»
// (открывает лист «Промокод»), внизу — светлая кнопка «Оплатить N ₽».
import React, { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAppError } from "../components/ErrorModal";
import PaymentSheet, { type PendingPayment } from "../components/PaymentSheet";
import { DayGiftSheet } from "../components/DayGiftSheet";
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
  redeemPromo,
  type DayGift,
  type PayMethodInfo,
  type PaymentMethod,
  type PaymentQuote,
  type TrafficInfo,
} from "../utils/api";
import { deviceWord } from "../utils/devices";
import { hasFeature } from "../utils/brand";
import { C, FgnHeader, FgnIcon, FgnPage, FgnSheet, fgnButton } from "../components/fgn";

const MUTED = "rgba(196, 196, 206, 0.62)";
const BORDER = "rgba(255, 255, 255, 0.1)";

const METHOD_ICON: Record<string, string> = { sbp: "bank", card: "card", tg_stars: "star" };

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

/** 1 290 ₽ — разделитель разрядов NBSP (toLocaleString в Telegram на Android бывает без него) */
function fmt(n: number) {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
}

function haptic(kind: "success" | "error") {
  try {
    (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: { notificationOccurred?: (s: string) => void } } } })
      .Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(kind);
  } catch { /* ignore */ }
}

/** строка карточки сумм: 56px, подпись слева (серая), значение справа */
function SumRow({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, height: 56 }}>
      <span style={{ fontSize: 15.5, lineHeight: "19px", color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <span style={{ fontSize: 15.5, lineHeight: "19px", color: accent ? C.green : C.text, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

/** разделитель строк карточки сумм (на 2px длиннее текста справа — как в макете) */
function SumLine() {
  return <div style={{ height: 1, background: BORDER, marginRight: -2 }} />;
}

/** радиокнопка 20px: рамка 1px; выбранная — белая рамка + точка 10px */
function Radio({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: 20,
        height: 20,
        borderRadius: "50%",
        border: `1px solid ${on ? C.text : BORDER}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        transition: "border-color 0.18s ease",
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: C.text,
          transform: on ? "scale(1)" : "scale(0)",
          transition: "transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      />
    </span>
  );
}

/** круг 44 (способы оплаты) / 36 (промокод) с контурной иконкой */
function IconCircle({ icon, size, iconSize, dim }: { icon: string; size: number; iconSize: number; dim?: boolean }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        border: `1px solid ${BORDER}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        opacity: dim ? 0.55 : 1,
      }}
    >
      <FgnIcon name={icon} size={iconSize} stroke={1.8} />
    </span>
  );
}

/** лист «Промокод»: поле-пилюля 54 + кнопка «Активировать» 52 */
function PromoSheet({ onClose, onDiscount, onDayGift }: { onClose: () => void; onDiscount: () => void; onDayGift: (g: DayGift) => void }) {
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
      haptic("success");
      if (r.type === "days" && r.gift_id) {
        onDayGift({ id: r.gift_id, days: Number(r.days || 0), source: "promo", text: r.message || "" });
        onClose();
      } else if (r.type === "gift") {
        setNote({ ok: true, text: "Подарок активирован — подписка уже ваша" });
        setCode("");
      } else {
        onDiscount();
        onClose();
      }
    } catch (e) {
      haptic("error");
      setNote({ ok: false, text: e instanceof Error && e.message ? e.message : "Не удалось применить промокод" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FgnSheet title="Промокод" onClose={onClose}>
      <div style={{ marginTop: 20, fontSize: 15, lineHeight: "18px", color: C.muted }}>
        Введите код. Скидка применится к этой оплате.
      </div>
      <input
        value={code}
        autoFocus
        onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/\s+/g, "")); setNote(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") void apply(); }}
        placeholder="Промокод"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="fgn-pay-promo"
        style={{
          appearance: "none",
          display: "block",
          width: "100%",
          height: 54,
          margin: "13px 0 0",
          padding: "0 17px",
          borderRadius: 27,
          border: `1px solid ${note && !note.ok ? "rgba(255, 75, 75, 0.55)" : BORDER}`,
          background: "transparent",
          color: C.text,
          fontFamily: C.font,
          fontSize: 17,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      <style>{`.fgn-pay-promo::placeholder{color:rgba(196,196,206,0.5);opacity:1}`}</style>
      {note ? (
        <div style={{ marginTop: 10, fontSize: 14, lineHeight: "17px", color: note.ok ? C.green : C.danger, animation: "fgnFade 0.25s ease both" }}>
          {note.text}
        </div>
      ) : null}
      <button
        type="button"
        className="blin-press"
        onClick={() => void apply()}
        style={{ ...fgnButton, marginTop: 12, borderRadius: 26, cursor: code.trim() && !busy ? "pointer" : "default" }}
      >
        {busy ? "Проверяем…" : "Активировать"}
      </button>
    </FgnSheet>
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
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoTick, setPromoTick] = useState(0);
  const [dayGift, setDayGift] = useState<DayGift | null>(null);

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
  }, [planDevices, method, extraDevices, useRefBal, purpose, subParam, months, whitelist, methodsReady, isStars, promoTick]);

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
  const payDisabled = paying || !quoteReady || belowMin || methodOff;

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
  const hasDiscount = quoteReady && discountPct > 0;
  const discountRub = hasDiscount ? Math.max(0, Math.round(full - price)) : 0;
  const pctText = `${Math.round(discountPct)}%`;
  const sumRows: { label: string; value: React.ReactNode }[] = [];
  if (showBreakdown && quote?.base_price != null) {
    sumRows.push({ label: `Тариф · ${periodLabel(months)}`, value: v(Number(quote.base_price)) });
    sumRows.push({ label: `Доп. устройства · ${devExtra} × ${months} мес`, value: v(Number(quote.devices_price || 0)) });
  }
  sumRows.push({ label: "Сумма", value: v(hasDiscount ? full : price) });
  if (hasDiscount) {
    sumRows.push({ label: "Промокод", value: `выдан на ${pctText}` });
    if (discountRub > 0) sumRows.push({ label: "Скидка", value: `−${fmt(discountRub)}` });
  }
  if (refApplied > 0) sumRows.push({ label: "С баланса", value: `−${fmt(refApplied)}` });
  const showPromo = hasFeature("promo_at_payment") && !isGift;

  return (
    <FgnPage>
      <FgnHeader title="Способ оплаты" onBack={goBack} />
      <div style={{ marginTop: 12, fontSize: 14, lineHeight: "17px", color: MUTED }}>{what}</div>

      {/* карточка сумм: строки по 56 через линию (Сумма / Промокод / Скидка / С баланса), низ 60 (Итого) */}
      <div
        style={{
          marginTop: 19,
          borderRadius: 23,
          border: `1px solid ${BORDER}`,
          background: C.cardBg,
          padding: "0 18px 0 16px",
        }}
      >
        {sumRows.map((r) => (
          <React.Fragment key={r.label}>
            <SumRow label={r.label} value={r.value} />
            <SumLine />
          </React.Fragment>
        ))}
        <div style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 16, lineHeight: "20px", fontWeight: 500 }}>Итого</span>
          <span style={{ fontSize: 17, lineHeight: "21px", fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {quoteReady ? (isStars ? `${Math.round(total)} ⭐` : fmt(paidFromBalance ? 0 : total)) : "…"}
          </span>
        </div>
      </div>

      {/* способы оплаты: 70px, промежуток 8 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {methods.map((m) => {
          const on = m.id === method;
          const off = !m.enabled;
          return (
            <button
              key={m.id}
              type="button"
              disabled={off}
              onClick={() => setMethod(m.id)}
              className={off ? undefined : "blin-press"}
              aria-pressed={on}
              style={{
                appearance: "none",
                margin: 0,
                width: "100%",
                height: 70,
                padding: "0 16px",
                borderRadius: 23,
                border: `1px solid ${on ? C.text : BORDER}`,
                background: C.cardBg,
                color: C.text,
                fontFamily: C.font,
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                cursor: off ? "default" : "pointer",
                boxSizing: "border-box",
                transition: "border-color 0.18s ease",
              }}
            >
              <IconCircle icon={METHOD_ICON[m.id] || "card"} size={44} iconSize={20} dim={off} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 16.5, fontWeight: 500, lineHeight: "20px", letterSpacing: "-0.005em", color: off ? "rgba(255, 255, 255, 0.6)" : C.text }}>
                  {m.title}
                </span>
                <span style={{ fontSize: 15, lineHeight: "18px", color: MUTED }}>{off ? "пока недоступно" : "без комиссии"}</span>
              </span>
              <Radio on={on} />
            </button>
          );
        })}
      </div>

      {canUseRef ? (
        <button
          type="button"
          className="blin-press"
          onClick={() => setUseRefBal((x) => !x)}
          aria-pressed={useRefBal}
          style={{
            appearance: "none",
            margin: "8px 0 0",
            width: "100%",
            height: 70,
            padding: "0 16px",
            borderRadius: 23,
            border: `1px solid ${useRefBal ? C.text : BORDER}`,
            background: C.cardBg,
            color: C.text,
            fontFamily: C.font,
            display: "flex",
            alignItems: "center",
            gap: 12,
            textAlign: "left",
            cursor: "pointer",
            boxSizing: "border-box",
            transition: "border-color 0.18s ease",
          }}
        >
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 16.5, fontWeight: 500, lineHeight: "20px" }}>Списать с баланса</span>
            <span style={{ fontSize: 15, lineHeight: "18px", color: MUTED }}>
              {useRefBal && refApplied > 0 ? `−${fmt(refApplied)} · останется ${fmt(Math.max(0, Math.floor(refBalance) - refApplied))}` : `доступно ${fmt(Math.floor(refBalance))}`}
            </span>
          </span>
          <Radio on={useRefBal} />
        </button>
      ) : null}

      {showPromo ? (
        <button
          type="button"
          className="blin-press"
          onClick={() => setPromoOpen(true)}
          style={{
            appearance: "none",
            margin: "16px 0 0",
            width: "100%",
            height: 58,
            padding: "0 16px",
            borderRadius: 22,
            border: `1px solid ${BORDER}`,
            background: C.cardBg,
            color: C.text,
            fontFamily: C.font,
            display: "flex",
            alignItems: "center",
            gap: 14.5,
            textAlign: "left",
            cursor: "pointer",
            boxSizing: "border-box",
          }}
        >
          <IconCircle icon="ticket" size={36} iconSize={16} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1.5 }}>
            <span style={{ fontSize: 15, fontWeight: 500, lineHeight: "18px" }}>У меня есть промокод</span>
            {hasDiscount ? (
              <span style={{ fontSize: 13, lineHeight: "16px", color: MUTED }}>Промокод выдан на {pctText}</span>
            ) : null}
          </span>
          <FgnIcon name="chevron" size={18} stroke={1.8} style={{ color: "rgba(255, 255, 255, 0.62)" }} />
        </button>
      ) : null}

      <div style={{ marginTop: "auto", paddingTop: 20, paddingBottom: 4 }}>
        <button
          type="button"
          className={payDisabled ? undefined : "blin-press"}
          disabled={payDisabled}
          onClick={() => void handlePay()}
          style={{
            ...fgnButton,
            borderRadius: 26,
            background: payDisabled && quoteReady && !paying ? "#232326" : C.btnSoft,
            color: payDisabled && quoteReady && !paying ? "rgba(200, 200, 206, 0.72)" : C.btnText,
            cursor: payDisabled ? "default" : "pointer",
            transition: "background 0.2s ease, color 0.2s ease",
          }}
        >
          {payLabel}
        </button>
      </div>

      {promoOpen ? (
        <PromoSheet onClose={() => setPromoOpen(false)} onDiscount={() => setPromoTick((t) => t + 1)} onDayGift={setDayGift} />
      ) : null}
      {pending ? <PaymentSheet payment={pending} returnTo={returnTo} onClose={() => setPending(null)} /> : null}
      {dayGift ? <DayGiftSheet gift={dayGift} onClose={() => setDayGift(null)} /> : null}
    </FgnPage>
  );
}
