// FGN сайт: «/tariffs» — выбор тарифа (как в мини-аппе: устройства + период).
// Цены — /api/app/plans (без входа); вошедшему — /payment/quote: минимум устройств с учётом текущей подписки.
// Оплата на сайте пока не подключена — кнопка «Оформить» выключена.
import React, { useEffect, useState } from "react";
import { applyDiscount, appFetch, fetchDiscount, fetchQuote, type TariffPeriod } from "../utils/api";
import { C } from "../components/fgn";

const FALLBACK: TariffPeriod[] = [
  { months: 1, days: 30, price: 200 },
  { months: 3, days: 90, price: 580 },
  { months: 6, days: 180, price: 1100 },
  { months: 12, days: 365, price: 2200 },
];

type PlansInfo = { devices?: number; periods?: TariffPeriod[]; device_prices?: number[]; extra_device_price?: number; max_devices?: number };

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

const periodTitle = (m: number) => (m === 12 ? "1 год" : `${m} ${plural(m, "месяц", "месяца", "месяцев")}`);
const rub = (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;

export const TARIFFS_CSS = `
.fs-tar .fs-wrap { max-width: 760px; padding-top: 64px; padding-bottom: 72px; position: relative; z-index: 1; }
.fs-tar-eyebrow { text-align: center; font-size: 12px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: rgba(196,196,206,.62); }
.fs-tar h1 { margin: 22px 0 0; text-align: center; font-size: 46px; line-height: 1.12; font-weight: 800; letter-spacing: -.015em; }
.fs-tar-lead { margin: 18px auto 0; max-width: 520px; text-align: center; font-size: 16px; line-height: 1.6; color: rgba(196,196,206,.8); }
.fs-tar-card { border-radius: 26px; border: 1px solid rgba(42,42,48,1); background: #18181B; box-sizing: border-box; }
.fs-tar-dev { margin-top: 52px; display: flex; align-items: center; gap: 16px; padding: 22px 22px 22px 24px; animation: fsFade .35s ease both; }
.fs-tar-dev b, .fs-tar-per b { display: block; font-size: 18px; font-weight: 600; line-height: 22px; letter-spacing: -.005em; }
.fs-tar-dev span, .fs-tar-per span { display: block; margin-top: 8px; font-size: 14px; line-height: 18px; color: rgba(196,196,206,.62); }
.fs-tar-step { display: flex; align-items: center; flex-shrink: 0; }
.fs-tar-step button { width: 42px; height: 42px; border-radius: 13px; background: #0E0E10; border: 1px solid rgba(255,255,255,.16);
  color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; transition: border-color .15s, color .15s; }
.fs-tar-step button:hover:not(:disabled) { border-color: rgba(255,255,255,.32); }
.fs-tar-step button:disabled { color: rgba(255,255,255,.28); border-color: rgba(255,255,255,.06); cursor: default; }
.fs-tar-step i { width: 50px; text-align: center; font-style: normal; font-size: 21px; font-weight: 700; font-variant-numeric: tabular-nums; }
.fs-tar-label { margin: 34px 0 0 4px; font-size: 14.5px; line-height: 18px; color: rgba(196,196,206,.7); }
.fs-tar-list { margin-top: 18px; display: flex; flex-direction: column; gap: 12px; }
.fs-tar-per { width: 100%; display: flex; align-items: center; gap: 16px; padding: 24px 24px; text-align: left; color: #fff; font: inherit;
  cursor: pointer; transition: border-color .15s, background .15s; }
.fs-tar-per:hover { border-color: rgba(255,255,255,.18); }
.fs-tar-per.on { border: 2px solid ${C.green}; padding: 23px; background: #121614; }
.fs-tar-per > div { flex: 1; min-width: 0; }
.fs-tar-price { flex-shrink: 0; display: flex; align-items: baseline; gap: 10px; }
.fs-tar-price s { font-size: 15px; color: rgba(196,196,206,.55); }
.fs-tar-price strong { font-size: 26px; font-weight: 800; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.fs-tar-per.on .fs-tar-price strong { color: ${C.green}; }
.fs-tar-buy { margin-top: 26px; display: flex; align-items: center; gap: 20px; padding: 14px 22px 14px 14px; }
.fs-tar-buy button { flex: 1; min-width: 0; height: 52px; border: 0; border-radius: 15px; background: ${C.btn}; color: ${C.btnText};
  font: 600 16px ${C.font}; cursor: pointer; }
.fs-tar-buy button:disabled { background: #8A8A8C; color: #262628; cursor: default; }
.fs-tar-save { flex-shrink: 0; font-size: 14.5px; font-weight: 600; color: ${C.green}; }
.fs-tar-foot { margin-top: 26px; text-align: center; font-size: 13.5px; line-height: 1.6; color: rgba(196,196,206,.62); }
@media (max-width: 860px) {
  .fs-tar .fs-wrap { padding-top: 40px; padding-bottom: 56px; }
  .fs-tar h1 { font-size: 34px; }
  .fs-tar-lead { font-size: 15px; }
  .fs-tar-dev { margin-top: 36px; padding: 18px 18px 18px 20px; }
  .fs-tar-dev b, .fs-tar-per b { font-size: 17px; }
  .fs-tar-step button { width: 40px; height: 40px; border-radius: 12px; }
  .fs-tar-step i { width: 44px; }
  .fs-tar-label { margin-top: 26px; }
  .fs-tar-list { margin-top: 14px; gap: 10px; }
  .fs-tar-per { padding: 20px; }
  .fs-tar-per.on { padding: 19px; }
  .fs-tar-price strong { font-size: 21px; }
  .fs-tar-buy { flex-direction: column; gap: 14px; padding: 14px 14px 16px; }
  .fs-tar-buy button { width: 100%; flex: none; }
}
@media (max-width: 420px) { .fs-tar h1 { font-size: 30px; } }
`;

function StepIcon({ plus }: { plus?: boolean }) {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d="M5 12h14" />
      {plus ? <path d="M12 5v14" /> : null}
    </svg>
  );
}

export default function SiteTariffs({ authed }: { authed: boolean | null }) {
  const [periods, setPeriods] = useState<TariffPeriod[]>(FALLBACK);
  const [included, setIncluded] = useState(2); // устройств в тарифе
  const [table, setTable] = useState<number[]>([]); // цена n-го устройства ₽/мес
  const [devPrice, setDevPrice] = useState(0);
  const [devMax, setDevMax] = useState(20);
  const [devMin, setDevMin] = useState(2);
  const [dev, setDev] = useState<number | null>(null);
  const [discount, setDiscount] = useState(0);
  const [sel, setSel] = useState(12);

  useEffect(() => {
    void (async () => {
      try {
        const d = await appFetch<PlansInfo>("/plans");
        const ps = Array.isArray(d?.periods) && d.periods.length ? d.periods : FALLBACK;
        setPeriods(ps);
        setSel((s) => (ps.some((p) => p.months === s) ? s : ps[ps.length - 1].months));
        const inc = Number(d?.devices || 2);
        setIncluded(inc);
        setDevMin(inc);
        if (Array.isArray(d?.device_prices)) setTable(d.device_prices.map(Number));
        setDevPrice(Number(d?.extra_device_price || 0));
        if (d?.max_devices) setDevMax(Number(d.max_devices));
        setDev((v) => v ?? inc);
      } catch { /* запасные цены */ }
    })();
  }, []);

  // вошёл: скидка и минимум устройств (уже есть в подписке — при продлении сохраняются)
  useEffect(() => {
    if (!authed) {
      setDiscount(0);
      return;
    }
    void (async () => {
      const d = await fetchDiscount();
      setDiscount(d.active && d.percent > 0 ? d.percent : 0);
      const q = await fetchQuote({ plan_devices: 1, months: 1, method: "sbp", extra_devices: 0, purpose: "subscription",
        subscription_id: null, use_referral_balance: false });
      if (!q) return;
      const min = Number(q.min_devices || q.plan_devices || 2);
      setDevMin(min);
      if (q.max_devices) setDevMax(Number(q.max_devices));
      if (Array.isArray(q.device_prices)) setTable(q.device_prices.map(Number));
      setDev((v) => Math.max(v ?? min, min));
    })();
  }, [authed]);

  const devNow = dev ?? included;
  const priceOf = (n: number) => (table.length ? Number(table[Math.min(n, table.length) - 1] ?? devPrice) : devPrice);
  let devMonthly = 0;
  for (let n = included + 1; n <= devNow; n++) devMonthly += priceOf(n);
  const nextPrice = Math.round(devNow >= devMax ? priceOf(devNow) : priceOf(devNow + 1));
  const showDevices = devPrice > 0 || table.some((x) => x > 0);
  const step = (n: number) => setDev(Math.min(devMax, Math.max(devMin, n)));

  const full = (p: TariffPeriod) => Math.round(p.price + devMonthly * p.months);
  const final = (p: TariffPeriod) => (discount > 0 ? applyDiscount(full(p), discount) : full(p));
  const cur = periods.find((p) => p.months === sel) || periods[periods.length - 1];
  const monthly = periods.find((p) => p.months === 1);
  // экономия против помесячной оплаты
  const save = cur && monthly && cur.months > 1 ? full(monthly) * cur.months - full(cur) : 0;
  const devWord = (n: number) => `${n} ${plural(n, "устройство", "устройства", "устройств")}`;

  return (
    <section className="fs-tar">
      <div className="fs-wrap">
        <div className="fs-tar-eyebrow">FGN · Подписка</div>
        <h1>Выбор тарифа</h1>
        <p className="fs-tar-lead">
          VPN и обход белых списков входят в одну подписку. В цену уже включены {devWord(included)}.
        </p>

        {showDevices ? (
          <div className="fs-tar-card fs-tar-dev">
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>Устройства</b>
              <span>
                {included} в тарифе · следующее +{nextPrice}&nbsp;₽/мес
                {devMin > included ? ` · сейчас в подписке ${devWord(devMin)}, при продлении они сохраняются` : ""}
              </span>
            </div>
            <div className="fs-tar-step">
              <button type="button" aria-label="Меньше устройств" disabled={devNow <= devMin} onClick={() => step(devNow - 1)}>
                <StepIcon />
              </button>
              <i>{devNow}</i>
              <button type="button" aria-label="Больше устройств" disabled={devNow >= devMax} onClick={() => step(devNow + 1)}>
                <StepIcon plus />
              </button>
            </div>
          </div>
        ) : null}

        <div className="fs-tar-label">Выберите период · VPN + белые списки</div>
        <div className="fs-tar-list" role="radiogroup">
          {periods.map((p, i) => {
            const f = full(p), v = final(p);
            return (
              <button
                key={p.months}
                type="button"
                role="radio"
                aria-checked={p.months === sel}
                className={`fs-tar-card fs-tar-per${p.months === sel ? " on" : ""}`}
                style={{ animation: `fsFade .35s ease ${0.04 * i}s both` }}
                onClick={() => setSel(p.months)}
              >
                <div>
                  <b>{periodTitle(p.months)}</b>
                  <span>
                    {p.days} {plural(p.days, "день", "дня", "дней")}, {devWord(devNow)}
                  </span>
                </div>
                <div className="fs-tar-price">
                  {v < f ? <s>{rub(f)}</s> : null}
                  <strong>{rub(v)}</strong>
                </div>
              </button>
            );
          })}
        </div>

        {cur ? (
          <div className="fs-tar-card fs-tar-buy">
            <button type="button" disabled title="Оплата на сайте скоро будет доступна">
              Оформить «{periodTitle(cur.months)}» · {rub(final(cur))}
            </button>
            {save > 0 ? <div className="fs-tar-save">Вы экономите {rub(save)}</div> : null}
          </div>
        ) : null}

        <div className="fs-tar-foot">
          Оплата на сайте подключается в ближайшее время. После оформления подписка привяжется к вашему аккаунту.
        </div>
      </div>
    </section>
  );
}
