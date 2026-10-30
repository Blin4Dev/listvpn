// FGN сайт: подарки. /cabinet/gifts — мои подарки + купить/активировать; /gifts/buy — купить подарок другу
// (→ /checkout?type=gift&months=); /gifts/activate — активировать код подарка или промокод.
import React, { useEffect, useState } from "react";
import { applyDiscount, appFetch, claimDayGift, fetchDiscount, fetchTariffs, redeemPromo, type TariffPeriod } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { C } from "../components/fgn";
import { CabTop, Ic, Loader, Note, PERIOD_DAYS, Tile, daysWord, errText, isAuthErr, periodTitle, rub, useCopied, useLoad, type CabNav } from "./siteKit";

type Gift = { code: string; kind: "bought" | "gift"; status: "issued" | "redeemed"; months?: number | null; created_at?: string; redeemed_at?: string | null };

const FALLBACK: TariffPeriod[] = [
  { months: 1, days: 30, price: 200 },
  { months: 3, days: 90, price: 580 },
  { months: 6, days: 180, price: 1100 },
  { months: 12, days: 365, price: 2200 },
];

export const GIFTS_CSS = `
.fs-gift { width: 100%; text-align: left; padding: 22px; border-radius: 16px; border: 1px solid rgba(255,255,255,.07); background: #18191B; color: #fff;
  font: inherit; cursor: pointer; transition: border-color .15s; display: flex; flex-direction: column; min-height: 150px; box-sizing: border-box; }
.fs-gift:hover:not(:disabled) { border-color: rgba(255,255,255,.2); }
.fs-gift:disabled { cursor: default; }
.fs-gift .hd { display: flex; align-items: center; gap: 10px; }
.fs-gift .hd b { flex: 1; font-size: 20px; font-weight: 700; }
.fs-gift .d { margin-top: 6px; font-size: 14.5px; color: rgba(196,196,206,.68); }
.fs-gift .code { margin-top: auto; padding-top: 22px; display: flex; align-items: center; gap: 10px; font-size: 19px; font-weight: 700;
  letter-spacing: .04em; font-variant-numeric: tabular-nums; }
.fs-gift .code span { color: rgba(196,196,206,.6); display: flex; }
.fs-gift.used { opacity: .6; }
.fs-gift .price { margin-top: auto; padding-top: 22px; display: flex; align-items: baseline; gap: 10px; }
.fs-gift .price strong { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; }
.fs-gift .price s { font-size: 15px; color: rgba(196,196,206,.5); }
.fs-gift:hover:not(:disabled) .price strong { color: ${C.green}; }
.fs-gift-foot { margin-top: 22px; font-size: 14px; line-height: 1.6; color: rgba(196,196,206,.62); }
.fs-act { margin-top: 28px; }
.fs-act .fs-cinput { text-transform: uppercase; letter-spacing: .04em; }
.fs-act .fs-cbtn { margin-top: 12px; }
@media (max-width: 860px) { .fs-gift { min-height: 0; padding: 20px; } .fs-gift .price strong { font-size: 22px; } }
`;

function GiftsList({ nav }: { nav: CabNav }) {
  const gifts = useLoad(() => appFetch<{ items: Gift[]; bot_link?: string }>("/gifts"), nav);
  const [copied, copy] = useCopied();
  const items = gifts.data?.items || [];
  return (
    <div className="fs-cab-in">
      <CabTop title="Подарки" onBack={() => nav.go("/cabinet")} sub="Подарите подписку другу или активируйте код, который подарили вам." />
      <div className="fs-cab-grid c2" style={{ marginTop: 24 }}>
        <Tile tone="green" icon={Ic.gift()} title="Купить подарок" sub="1, 3, 6 месяцев или год" onClick={() => nav.go("/gifts/buy")} />
        <Tile tone="yellow" icon={Ic.key()} title="Активировать подарок" sub="Код подарка или промокод" onClick={() => nav.go("/gifts/activate")} />
      </div>

      <div className="fs-cab-label">Мои подарки</div>
      {gifts.err ? <Note kind="err">{gifts.err}</Note> : null}
      {!gifts.data && !gifts.err ? (
        <Loader />
      ) : items.length === 0 ? (
        <div className="fs-cab-card fs-cab-empty">Подарков пока нет. Купленные коды появятся здесь.</div>
      ) : (
        <>
          <div className="fs-cab-grid c2">
            {items.map((g) => {
              const m = Number(g.months || 1);
              const days = PERIOD_DAYS[m] || m * 30;
              const used = g.status === "redeemed";
              return (
                <button key={g.code} type="button" className={`fs-gift${used ? " used" : ""}`} disabled={used} onClick={() => copy(g.code, g.code)}
                  title={used ? undefined : "Скопировать код"}>
                  <div className="hd">
                    <b>{periodTitle(m)}</b>
                    <span className={`fs-badge sm${used ? " grey" : ""}`}>
                      {used ? "Активирован" : copied === g.code ? "Скопировано" : g.kind === "gift" ? "За друзей" : "Не активирован"}
                    </span>
                  </div>
                  <div className="d">
                    {days} {daysWord(days)}
                    {used && g.redeemed_at ? ` · активирован ${formatDateRu(g.redeemed_at)}` : g.created_at ? ` · от ${formatDateRu(g.created_at)}` : ""}
                  </div>
                  <div className="code">
                    {g.code}
                    {!used ? <span>{copied === g.code ? Ic.check(17) : Ic.copy(17)}</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="fs-gift-foot">Нажмите на подарок, чтобы скопировать код. Друг активирует его в кабинете на сайте («Подарки» → «Активировать») или в приложении.</div>
        </>
      )}
    </div>
  );
}

function GiftBuy({ nav }: { nav: CabNav }) {
  const [periods, setPeriods] = useState<TariffPeriod[]>(FALLBACK);
  const [discount, setDiscount] = useState(0);
  useEffect(() => {
    fetchTariffs().then((t) => t.periods.length && setPeriods(t.periods)).catch(() => { /* запасные цены */ });
    fetchDiscount().then((d) => d.active && d.percent > 0 && setDiscount(d.percent)).catch(() => { /* без скидки */ });
  }, []);
  return (
    <div className="fs-cab-in">
      <CabTop title="Купить подарок" onBack={() => nav.go("/cabinet/gifts")} sub="Выберите срок — после оплаты вы получите код, который можно отправить другу." />
      <div className="fs-cab-grid c2" style={{ marginTop: 24 }}>
        {periods.map((p) => {
          const full = Math.round(p.price);
          const fin = discount > 0 ? applyDiscount(full, discount) : full;
          const days = p.days || PERIOD_DAYS[p.months] || p.months * 30;
          return (
            <button key={p.months} type="button" className="fs-gift" onClick={() => nav.go(`/checkout?type=gift&months=${p.months}`)}>
              <div className="hd"><b>{periodTitle(p.months)}</b></div>
              <div className="d">{days} {daysWord(days)} + белые списки</div>
              <div className="price">
                <strong>{rub(fin)}</strong>
                {fin < full ? <s>{rub(full)}</s> : null}
              </div>
            </button>
          );
        })}
      </div>
      <div className="fs-gift-foot">
        Код подарка действует, пока его не активируют. Друг получит подписку на выбранный срок — VPN и обход белых списков.
        Все купленные коды — в разделе «Мои подарки».
      </div>
    </div>
  );
}

function GiftActivate({ nav }: { nav: CabNav }) {
  const [code, setCode] = useState(() => {
    try {
      return (new URLSearchParams(window.location.search).get("code") || "").toUpperCase().replace(/\s+/g, "");
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  const submit = async () => {
    const c = code.trim().toUpperCase().replace(/\s+/g, "");
    if (!c || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await redeemPromo(c);
      if (r.type === "days" && r.gift_id) {
        const g = await claimDayGift(r.gift_id);
        const n = Number(g.days || r.days || 0);
        setMsg({ kind: "ok", text: `Начислено ${n} ${daysWord(n)}${g.expires_at ? ` — подписка до ${formatDateRu(g.expires_at)}` : ""}` });
      } else if (r.type === "gift") {
        setMsg({ kind: "ok", text: r.expires_at ? `Подписка активирована до ${formatDateRu(r.expires_at)}` : "Подарок активирован" });
      } else {
        const pct = Number(r.discount_percent ?? r.value ?? 0);
        setMsg({ kind: "info", text: `Скидка ${pct}% применится к следующей оплате${r.expires_at ? ` (до ${formatDateRu(r.expires_at)})` : ""}` });
      }
      setCode("");
    } catch (e) {
      if (isAuthErr(e)) nav.expired();
      else setMsg({ kind: "err", text: errText(e, "Код не подошёл") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fs-cab-in fs-cab-center">
      <CabTop title="Активировать подарок" onBack={() => nav.go("/cabinet/gifts")} />
      <p className="fs-cab-sub">Введите код подарка от друга или промокод.</p>
      <div className="fs-act">
        <input className="fs-cinput" placeholder="Код подарка" value={code} maxLength={40} autoFocus
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <button type="button" className="fs-cbtn block" disabled={!code.trim() || busy} onClick={submit}>
          {busy ? "Проверяем…" : "Активировать"}
        </button>
        {msg ? <Note kind={msg.kind}>{msg.text}</Note> : null}
        {msg?.kind === "ok" ? (
          <button type="button" className="fs-cbtn dark block" onClick={() => nav.go("/cabinet/subscription")}>
            К подписке
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function SiteGifts({ path, nav }: { path: string; nav: CabNav }) {
  const page = path === "/gifts/buy" ? <GiftBuy nav={nav} /> : path === "/gifts/activate" ? <GiftActivate nav={nav} /> : <GiftsList nav={nav} />;
  return (
    <main className="fs-cab">
      <div className="fs-wrap" key={path}>
        {page}
      </div>
    </main>
  );
}
