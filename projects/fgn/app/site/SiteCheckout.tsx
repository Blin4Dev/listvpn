// FGN сайт: оплата.
// /checkout?months=&dev=                      — подписка (dev — всего устройств)
// /checkout?type=devices&count=&months=&sub=  — докупить устройства
// /checkout?type=gift&months=                 — подарок другу
// /payment/return?payment_id=[&result=fail]   — сюда ЮKassa возвращает после оплаты (core.py: _payment_return_url по Origin)
// Звёзды Telegram на сайте не предлагаем. Перед оплатой — acceptTerms() (оферта принимается кнопкой «Оплатить»).
import React, { useEffect, useMemo, useState } from "react";
import {
  acceptTerms, claimDayGift, createPayment, fetchConfig, fetchMe, fetchPaymentStatus, fetchQuote, fetchTariffs, markPaymentSeen, redeemPromo,
  type PayMethodInfo, type PaymentMethod, type PaymentPurpose, type PaymentQuote, type PaymentStatusResponse,
} from "../utils/api";
import { formatDateRu } from "../utils/date";
import { deviceWord } from "../utils/devices";
import { C } from "../components/fgn";
import { IcChevron } from "./SiteDownload";
import { CabTop, Ic, Note, PERIOD_DAYS, daysWord, errText, isAuthErr, periodTitle, rub, useCopied, type CabNav } from "./siteKit";

const FALLBACK_METHODS: PayMethodInfo[] = [
  { id: "sbp", title: "СБП", enabled: true },
  { id: "card", title: "Банковские карты", enabled: true },
];
const METHOD_NOTE: Partial<Record<PaymentMethod, string>> = { sbp: "Без комиссии", card: "Visa, Mastercard, МИР", sberpay: "Оплата в СберБанк Онлайн" };

export const CHECKOUT_CSS = `
.fs-pay { max-width: 620px; margin: 0 auto; }
.fs-pay-sum { margin-top: 24px; }
.fs-pay-sum .tot { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding-top: 16px; margin-top: 2px;
  border-top: 1px solid rgba(255,255,255,.07); }
.fs-pay-sum .tot span { font-size: 16px; color: rgba(196,196,206,.8); }
.fs-pay-sum .tot b { font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums; }
.fs-pay-m { margin-top: 10px; display: flex; flex-direction: column; gap: 10px; }
.fs-pay-row { width: 100%; min-height: 76px; display: flex; align-items: center; gap: 16px; padding: 14px 18px; box-sizing: border-box; text-align: left;
  border-radius: 16px; border: 1px solid rgba(255,255,255,.07); background: #18191B; color: #fff; font: inherit; cursor: pointer; transition: border-color .15s; }
.fs-pay-row:hover:not(:disabled) { border-color: rgba(255,255,255,.2); }
.fs-pay-row.on { border-color: ${C.green}; }
.fs-pay-row:disabled { opacity: .5; cursor: default; }
.fs-pay-row .ic { width: 46px; height: 46px; flex-shrink: 0; border-radius: 12px; background: #222326; display: flex; align-items: center; justify-content: center; }
.fs-pay-row .tx { flex: 1; min-width: 0; }
.fs-pay-row b { display: block; font-size: 17px; font-weight: 600; }
.fs-pay-row small { display: block; margin-top: 4px; font-size: 13.5px; color: rgba(196,196,206,.62); }
.fs-radio { width: 22px; height: 22px; flex-shrink: 0; border-radius: 50%; border: 2px solid rgba(255,255,255,.25); box-sizing: border-box; }
.fs-pay-row.on .fs-radio { border: 7px solid ${C.green}; }
.fs-toggle { position: relative; width: 48px; height: 28px; flex-shrink: 0; border-radius: 14px; background: rgba(255,255,255,.14); transition: background .2s; }
.fs-toggle::after { content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: left .2s; }
.fs-toggle.on { background: ${C.green}; }
.fs-toggle.on::after { left: 23px; }
.fs-pay-promo { margin-top: 10px; }
.fs-pay-promo .fs-cab-row { margin-top: 10px; }
.fs-pay-promo .fs-cinput { text-transform: uppercase; letter-spacing: .04em; }
.fs-pay-go { margin-top: 22px; }
.fs-pay-fine { margin-top: 14px; text-align: center; font-size: 13px; line-height: 1.6; color: rgba(196,196,206,.58); }
.fs-pay-fine a { color: rgba(230,230,236,.9); text-decoration: underline; text-underline-offset: 3px; }

.fs-done { max-width: 520px; margin: 0 auto; text-align: center; }
.fs-done-ic { width: 84px; height: 84px; margin: 12px auto 0; border-radius: 50%; background: #fff; color: #0A0A0A; display: flex; align-items: center;
  justify-content: center; animation: fsPop .4s cubic-bezier(.22,1,.36,1) both; }
.fs-done-ic.bad { background: #241616; color: #E7B4B4; border: 1px solid #5A3030; }
.fs-done-ic.wait { background: transparent; }
.fs-done h1 { margin: 26px 0 0; font-size: 44px; line-height: 1.1; font-weight: 800; letter-spacing: -.015em; }
.fs-done .per { margin-top: 10px; font-size: 17px; color: rgba(196,196,206,.78); }
.fs-done .amt { margin-top: 14px; font-size: 40px; font-weight: 800; font-variant-numeric: tabular-nums; }
.fs-done .fs-cab-card { margin-top: 28px; text-align: left; padding-top: 8px; padding-bottom: 8px; }
.fs-done-code { margin-top: 28px; text-align: left; }
.fs-done-code .c { margin-top: 10px; font-size: 30px; font-weight: 800; letter-spacing: .04em; }
.fs-done-btns { margin-top: 24px; display: flex; flex-direction: column; gap: 10px; }
@media (max-width: 860px) {
  .fs-done h1 { font-size: 34px; }
  .fs-done .amt { font-size: 32px; }
  .fs-pay-sum .tot b { font-size: 26px; }
}
`;

function methodIcon(id: PaymentMethod) {
  return id === "sbp" ? Ic.sbp() : id === "card" ? Ic.card() : Ic.wallet();
}

function useQuery() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

// ───────────────────────── выбор способа и оплата ─────────────────────────
function Checkout({ nav }: { nav: CabNav }) {
  const q = useQuery();
  const type = q.get("type");
  const purpose: PaymentPurpose = type === "devices" ? "devices" : type === "gift" ? "gift" : "subscription";
  const monthsParam = parseInt(q.get("months") || "0", 10);
  const months = [1, 3, 6, 12].includes(monthsParam) ? monthsParam : 0;
  const devParam = Math.min(20, Math.max(0, parseInt(q.get("dev") || "0", 10) || 0));
  const count = Math.min(20, Math.max(0, parseInt(q.get("count") || "0", 10) || 0));
  const subId = q.get("sub") ? Number(q.get("sub")) : null;
  const valid = months > 0 && (purpose !== "devices" || count > 0);

  const [methods, setMethods] = useState<PayMethodInfo[]>(FALLBACK_METHODS);
  const [method, setMethod] = useState<PaymentMethod>("sbp");
  const [providerMin, setProviderMin] = useState<Record<string, number>>({ card: 50, sbp: 10 });
  const [planDevices, setPlanDevices] = useState<number | null>(purpose === "subscription" ? null : 1);
  const [ready, setReady] = useState(false);
  const [balance, setBalance] = useState(0);
  const [useBal, setUseBal] = useState(false);
  const [quote, setQuote] = useState<PaymentQuote | null>(null);
  const [quoteReady, setQuoteReady] = useState(false);
  const [tick, setTick] = useState(0);
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState("");
  const [promoOpen, setPromoOpen] = useState(false);
  const [promo, setPromo] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMsg, setPromoMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await fetchConfig();
        if (cfg?.providerMin && typeof cfg.providerMin === "object") setProviderMin(cfg.providerMin as Record<string, number>);
        const list = Array.isArray(cfg?.payMethods) ? (cfg.payMethods as PayMethodInfo[]).filter((m) => m.id !== "tg_stars") : null;
        if (list && list.length) {
          setMethods(list);
          const first = list.find((m) => m.enabled);
          if (first) setMethod(first.id);
        }
      } catch { /* запасной список */ }
      if (purpose === "subscription") {
        try {
          setPlanDevices((await fetchTariffs()).devices);
        } catch {
          setPlanDevices(3);
        }
      }
      setReady(true);
      const me = await fetchMe();
      if (me && typeof me.partner_balance === "number") setBalance(me.partner_balance);
    })();
  }, [purpose]);

  const plan = planDevices ?? 1;
  const extra = purpose === "devices" ? count : purpose === "subscription" && devParam > 0 ? Math.max(0, devParam - plan) : 0;
  const req = { plan_devices: plan, months, method, extra_devices: extra, purpose, subscription_id: purpose === "devices" ? subId : null };

  useEffect(() => {
    if (!ready || !valid) return;
    let alive = true;
    setQuoteReady(false);
    void fetchQuote({ ...req, use_referral_balance: useBal }).then((r) => {
      if (!alive) return;
      setQuote(r);
      setQuoteReady(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, valid, plan, method, extra, useBal, purpose, subId, months, tick]);

  if (!valid) {
    return (
      <div className="fs-pay fs-cab-in">
        <CabTop title="Способ оплаты" onBack={() => nav.go("/tariffs")} />
        <Note kind="info">Не выбран тариф. Выберите срок и устройства на странице «Тарифы».</Note>
        <button type="button" className="fs-cbtn" style={{ marginTop: 16 }} onClick={() => nav.go("/tariffs")}>К тарифам</button>
      </div>
    );
  }

  const price = quote ? quote.price : 0;
  const full = quote?.full_price ?? price;
  const discount = Number(quote?.discount_percent || 0);
  const refApplied = quote ? Math.round(quote.referral_applied || 0) : 0;
  const total = quote ? quote.total ?? quote.charge : 0;
  const pMin = Number(providerMin[method] ?? 10);
  const fromBalance = quoteReady && !!quote && total <= 0 && price > 0;
  const belowMin = quoteReady && total > 0 && total < pMin;
  const current = methods.find((m) => m.id === method);
  const methodOff = !current?.enabled || quote?.method_enabled === false;
  const devTotal = Number(quote?.devices_total || devParam || plan);

  const subtitle =
    purpose === "gift" ? `Подарок · ${periodTitle(months)}`
      : purpose === "devices" ? `+${count} ${deviceWord(count)} · ${periodTitle(months)}`
        : `${periodTitle(months)} · ${devTotal} ${deviceWord(devTotal)} · белые списки`;

  const label = !quoteReady ? "Считаем…"
    : paying ? "Создаём платёж…"
      : !quote ? "Не удалось рассчитать"
        : methodOff && !fromBalance ? "Способ недоступен"
          : belowMin ? `Минимум ${pMin} ₽`
            : fromBalance ? "Оплатить с баланса"
              : `Оплатить ${rub(total)}`;

  const pay = async () => {
    if (paying || !quoteReady || !quote || (methodOff && !fromBalance) || belowMin) return;
    setPaying(true);
    setErr("");
    try {
      try {
        await acceptTerms();
      } catch (e) {
        if (isAuthErr(e)) throw e;
      }
      const r = await createPayment({ ...req, use_referral_balance: useBal && balance > 0, return_to: "/cabinet/subscription" });
      if (r.provider === "balance" || r.paid || !r.pay_url) {
        nav.go(`/payment/return?payment_id=${encodeURIComponent(String(r.payment_id))}`);
      } else {
        // ЮKassa вернёт на /payment/return этого же сайта
        window.location.assign(r.pay_url);
        return;
      }
    } catch (e) {
      if (isAuthErr(e)) return nav.expired();
      setErr(errText(e, "Не удалось создать платёж"));
    }
    setPaying(false);
  };

  const applyPromo = async () => {
    const c = promo.trim().toUpperCase().replace(/\s+/g, "");
    if (!c || promoBusy) return;
    setPromoBusy(true);
    setPromoMsg(null);
    try {
      const r = await redeemPromo(c);
      if (r.type === "days" && r.gift_id) {
        const g = await claimDayGift(r.gift_id);
        const n = Number(g.days || r.days || 0);
        setPromoMsg({ kind: "ok", text: `Начислено ${n} ${daysWord(n)} к подписке` });
      } else if (r.type === "gift") {
        setPromoMsg({ kind: "ok", text: r.expires_at ? `Подарок активирован — подписка до ${formatDateRu(r.expires_at)}` : "Подарок активирован" });
      } else {
        setPromoMsg({ kind: "ok", text: `Скидка ${Number(r.discount_percent ?? r.value ?? 0)}% применена` });
        setTick((t) => t + 1);
      }
      setPromo("");
    } catch (e) {
      if (isAuthErr(e)) return nav.expired();
      setPromoMsg({ kind: "err", text: errText(e, "Промокод не подошёл") });
    } finally {
      setPromoBusy(false);
    }
  };

  const back = () => nav.go(purpose === "gift" ? "/gifts/buy" : purpose === "devices" ? "/cabinet/devices/buy" : "/tariffs");

  return (
    <div className="fs-pay fs-cab-in">
      <CabTop title="Способ оплаты" onBack={back} sub={subtitle} />

      <div className="fs-cab-card fs-pay-sum">
        <div className="fs-cab-lines">
          <div><span>Сумма</span><b>{quoteReady && quote ? rub(full) : "…"}</b></div>
          {discount > 0 && full > price ? <div><span>Скидка</span><b style={{ color: C.green }}>−{Math.round(discount)}% · −{rub(full - price)}</b></div> : null}
          {refApplied > 0 ? <div><span>С реферального баланса</span><b style={{ color: C.green }}>−{rub(refApplied)}</b></div> : null}
        </div>
        <div className="tot">
          <span>Итого</span>
          <b>{quoteReady && quote ? rub(Math.max(0, total)) : "…"}</b>
        </div>
      </div>

      <div className="fs-cab-label">Способ оплаты</div>
      <div className="fs-pay-m">
        {methods.map((m) => (
          <button key={m.id} type="button" className={`fs-pay-row${m.id === method ? " on" : ""}`} disabled={!m.enabled} onClick={() => setMethod(m.id)}>
            <span className="ic">{methodIcon(m.id)}</span>
            <span className="tx">
              <b>{m.title}</b>
              <small>{m.enabled ? METHOD_NOTE[m.id] || "Онлайн-оплата" : "Временно недоступно"}</small>
            </span>
            <span className="fs-radio" />
          </button>
        ))}
        {balance > 0 ? (
          <button type="button" className="fs-pay-row" onClick={() => setUseBal((v) => !v)}>
            <span className="ic">{Ic.wallet()}</span>
            <span className="tx">
              <b>Списать с реферального баланса</b>
              <small>Доступно {rub(Math.floor(balance))}</small>
            </span>
            <span className={`fs-toggle${useBal ? " on" : ""}`} />
          </button>
        ) : null}
      </div>

      <div className="fs-pay-promo">
        <button type="button" className="fs-pay-row" onClick={() => setPromoOpen((v) => !v)}>
          <span className="ic">{Ic.gift()}</span>
          <span className="tx"><b>У меня есть промокод</b></span>
          <span style={{ transform: promoOpen ? "rotate(90deg)" : undefined, transition: "transform .2s", display: "flex" }}><IcChevron /></span>
        </button>
        {promoOpen ? (
          <div className="fs-cab-row">
            <input className="fs-cinput" placeholder="Промокод" value={promo} maxLength={40} autoFocus
              onChange={(e) => setPromo(e.target.value.toUpperCase().replace(/\s+/g, ""))} onKeyDown={(e) => e.key === "Enter" && applyPromo()} />
            <button type="button" className="fs-cbtn" disabled={!promo.trim() || promoBusy} onClick={applyPromo}>
              {promoBusy ? "Проверяем…" : "Применить"}
            </button>
          </div>
        ) : null}
        {promoMsg ? <Note kind={promoMsg.kind}>{promoMsg.text}</Note> : null}
      </div>

      {err ? <Note kind="err">{err}</Note> : null}
      <button type="button" className="fs-cbtn block fs-pay-go" disabled={!quoteReady || paying || !quote || (methodOff && !fromBalance) || belowMin} onClick={pay}>
        {label}
      </button>
      <div className="fs-pay-fine">
        Нажимая «Оплатить», вы принимаете{" "}
        <a href="/rules" onClick={(e) => { e.preventDefault(); nav.go("/rules"); }}>правила использования</a>. Оплата проходит на защищённой странице ЮKassa.
      </div>
    </div>
  );
}

// ───────────────────────── итог оплаты ─────────────────────────
function PaymentResult({ nav }: { nav: CabNav }) {
  const q = useQuery();
  const id = q.get("payment_id") || "";
  const [st, setSt] = useState<PaymentStatusResponse | null>(null);
  const [err, setErr] = useState("");
  const [gaveUp, setGaveUp] = useState(false);
  const [copied, copy] = useCopied();

  useEffect(() => {
    if (!id) return;
    let alive = true;
    let timer = 0;
    const started = Date.now();
    const tick = async () => {
      try {
        const r = await fetchPaymentStatus(id);
        if (!alive) return;
        setSt(r);
        setErr("");
        if (r.status === "paid" || r.status === "failed") {
          void markPaymentSeen(id);
          return;
        }
      } catch (e) {
        if (!alive) return;
        if (isAuthErr(e)) return nav.expired();
        setErr(errText(e, "Не удалось проверить оплату"));
      }
      if (Date.now() - started > 5 * 60_000) {
        setGaveUp(true);
        return;
      }
      timer = window.setTimeout(tick, 2500);
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const btns = (
    <div className="fs-done-btns">
      <button type="button" className="fs-cbtn block" onClick={() => nav.go("/cabinet")}>На главную</button>
      <button type="button" className="fs-cbtn dark block" onClick={() => nav.go(st?.purpose === "gift" ? "/cabinet/gifts" : "/cabinet/subscription")}>
        {st?.purpose === "gift" ? "Мои подарки" : "К подписке"}
      </button>
    </div>
  );

  if (!id) {
    return (
      <div className="fs-done fs-cab-in">
        <h1>Платёж не найден</h1>
        {btns}
      </div>
    );
  }

  if (!st || st.status === "pending") {
    return (
      <div className="fs-done fs-cab-in">
        <div className="fs-done-ic wait"><div className="fs-cab-loader" style={{ padding: 0 }}><i /></div></div>
        <h1>{gaveUp ? "Оплата ещё не подтверждена" : "Проверяем оплату…"}</h1>
        <div className="per">
          {gaveUp
            ? "Если деньги списались, подписка продлится автоматически в течение нескольких минут."
            : "Обычно это занимает несколько секунд. Не закрывайте страницу."}
        </div>
        {err ? <Note kind="err">{err}</Note> : null}
        {st?.pay_url ? (
          <div className="fs-done-btns">
            <a className="fs-cbtn block" href={st.pay_url}>Вернуться к оплате</a>
            <button type="button" className="fs-cbtn dark block" onClick={() => nav.go("/cabinet")}>На главную</button>
          </div>
        ) : gaveUp ? btns : null}
      </div>
    );
  }

  if (st.status === "failed") {
    return (
      <div className="fs-done fs-cab-in">
        <div className="fs-done-ic bad">{Ic.x(34)}</div>
        <h1>Оплата не прошла</h1>
        <div className="per">Деньги не списаны. Попробуйте ещё раз или выберите другой способ оплаты.</div>
        <div className="fs-done-btns">
          <button type="button" className="fs-cbtn block" onClick={() => nav.go("/tariffs")}>Попробовать снова</button>
          <button type="button" className="fs-cbtn dark block" onClick={() => nav.go("/support")}>Написать в поддержку</button>
        </div>
      </div>
    );
  }

  const months = Number(st.months || 0);
  const days = Number(st.days || PERIOD_DAYS[months] || 0);
  const amount = Number(st.amount || 0);
  const ref = Math.round(Number(st.referral_applied || 0));
  const extra = Number(st.extra_devices || 0);
  return (
    <div className="fs-done fs-cab-in">
      <div className="fs-done-ic">{Ic.check(38)}</div>
      <h1>Оплачено</h1>
      <div className="per">
        {st.purpose === "gift" ? `Подарок · ${periodTitle(months || 1)}` : st.purpose === "devices" ? `+${extra} ${deviceWord(extra)}` : months ? periodTitle(months) : "Подписка"}
      </div>
      <div className="amt">{rub(amount + ref)}</div>

      {st.purpose === "gift" && st.gift_code ? (
        <div className="fs-cab-card fs-done-code">
          <div className="fs-cab-k">Код подарка</div>
          <div className="c">{st.gift_code}</div>
          <div className="fs-cab-muted" style={{ marginTop: 8 }}>Отправьте код другу — он активирует его в разделе «Подарки».</div>
          <button type="button" className="fs-cbtn block" style={{ marginTop: 16 }} onClick={() => copy(st.gift_code || "")}>
            {copied ? Ic.check(18) : Ic.copy()}
            {copied ? "Скопировано" : "Скопировать код"}
          </button>
        </div>
      ) : (
        <div className="fs-cab-card">
          <div className="fs-cab-lines">
            {st.purpose === "devices" ? (
              <div><span>Устройства</span><b>+{extra}</b></div>
            ) : days ? (
              <div><span>Подписка</span><b>+{days} {daysWord(days)}</b></div>
            ) : null}
            {st.purpose !== "devices" ? <div><span>Белые списки</span><b>включены</b></div> : null}
            {ref > 0 ? <div><span>С баланса</span><b>{rub(ref)}</b></div> : null}
            <div><span>К оплате</span><b>{rub(amount)}</b></div>
          </div>
        </div>
      )}
      {btns}
    </div>
  );
}

export default function SiteCheckout({ path, nav }: { path: string; nav: CabNav }) {
  return (
    <main className="fs-cab">
      <div className="fs-wrap" key={path + window.location.search}>
        {path === "/payment/return" ? <PaymentResult nav={nav} /> : <Checkout nav={nav} />}
      </div>
    </main>
  );
}
