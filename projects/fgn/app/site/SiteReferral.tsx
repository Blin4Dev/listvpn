// FGN сайт: /cabinet/referral — реферальная программа (как экран мини-аппа): баланс и вывод (USDT TON),
// друзья и приглашение, прогресс уровня, уровни, награды уровня (бесплатная подписка, подарки друзьям).
import React, { useEffect, useState } from "react";
import { appFetch, fetchWithdrawals, requestWithdraw, type Withdrawal } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { loadReferral, patchReferral, peekReferral, type ReferralData } from "../utils/referral";
import { C } from "../components/fgn";
import { CabTop, Ic, Loader, Modal, Note, errText, isAuthErr, plural, rub, useCopied, type CabNav } from "./siteKit";

export const REFERRAL_CSS = `
.fs-ref-lv { display: flex; flex-direction: column; align-items: flex-end; padding: 10px 16px; border-radius: 14px; background: #18191B;
  border: 1px solid rgba(255,255,255,.07); }
.fs-ref-lv span { font-size: 12.5px; color: rgba(196,196,206,.7); }
.fs-ref-lv b { margin-top: 3px; font-size: 14.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.fs-ref-top { margin-top: 24px; }
.fs-ref-top .fs-cab-card { display: flex; flex-direction: column; min-height: 330px; }
.fs-ref-h { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 15px; color: rgba(196,196,206,.75); }
.fs-ref-h button { width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.1); background: transparent; color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.fs-ref-h button:hover { border-color: rgba(255,255,255,.3); }
.fs-ref-num { margin-top: 22px; font-size: 48px; line-height: 1.05; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.fs-ref-num.g { color: ${C.green}; }
.fs-ref-pair { margin-top: 18px; display: flex; justify-content: space-between; gap: 12px; }
.fs-ref-pair span { display: block; font-size: 14px; color: rgba(196,196,206,.62); }
.fs-ref-pair b { display: block; margin-top: 6px; font-size: 17px; font-weight: 700; }
.fs-ref-pair > div:last-child { text-align: right; }
.fs-ref-pair b.g { color: ${C.green}; }
.fs-ref-top .fs-cbtn { margin-top: auto; }
.fs-ref-sub { margin-top: 8px; font-size: 15px; color: rgba(196,196,206,.68); }
.fs-ref-mini { margin-top: 12px; align-self: center; }
.fs-ref-prog .row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.fs-ref-prog b { font-size: 17px; font-weight: 700; }
.fs-ref-bar { margin-top: 18px; height: 8px; border-radius: 4px; background: #2A2B2E; overflow: hidden; }
.fs-ref-bar i { display: block; height: 100%; border-radius: 4px; background: ${C.green}; transition: width .4s ease; }
.fs-ref-levels { margin-top: 22px; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.fs-ref-levels > div { padding: 18px; border-radius: 14px; border: 1px solid rgba(255,255,255,.06); background: #111214; min-height: 140px; box-sizing: border-box; }
.fs-ref-levels > div.on { border: 2px solid rgba(255,255,255,.85); padding: 17px; }
.fs-ref-levels strong { display: block; font-size: 30px; font-weight: 800; }
.fs-ref-levels b { display: block; margin-top: 4px; font-size: 13px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.fs-ref-levels span { display: block; margin-top: 12px; font-size: 14px; color: rgba(196,196,206,.62); }
.fs-ref-levels em { display: block; margin-top: 10px; font-style: normal; font-size: 13.5px; color: rgba(196,196,206,.62); }
.fs-ref-foot { margin-top: 12px; padding: 14px 16px; border-radius: 12px; background: #111214; font-size: 15px; line-height: 1.5; color: rgba(220,220,228,.8); }
.fs-ref-rw { margin-top: 16px; }
.fs-ref-rw .fs-cab-card { display: flex; align-items: center; gap: 18px; }
.fs-ref-rw .fs-cab-card > div { flex: 1; min-width: 0; }
.fs-ref-rw p { margin: 6px 0 0; font-size: 14px; line-height: 1.5; color: rgba(196,196,206,.68); }
.fs-wd { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
.fs-wd .fs-cbtn { margin-top: 6px; }
.fs-wd-list { margin-top: 14px; display: flex; flex-direction: column; }
.fs-wd-list > div { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.fs-wd-list > div + div { border-top: 1px solid #2A2A30; }
.fs-wd-list > div > div { flex: 1; min-width: 0; }
.fs-wd-list small { display: block; font-size: 12.5px; color: #9B9BA4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-wd-list b { font-size: 16px; font-weight: 600; }
.fs-wd-list em { font-style: normal; font-size: 12.5px; }
@media (max-width: 1000px) { .fs-ref-levels { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 860px) {
  .fs-ref-top .fs-cab-card { min-height: 0; }
  .fs-ref-top .fs-cbtn { margin-top: 20px; }
  .fs-ref-num { font-size: 40px; }
  .fs-ref-levels { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .fs-ref-levels > div { min-height: 0; }
  .fs-ref-rw .fs-cab-card { flex-direction: column; align-items: stretch; }
}
`;

const WD_STATUS: Record<Withdrawal["status"], { t: string; c: string }> = {
  pending: { t: "На проверке", c: C.warn },
  approved: { t: "Выплачено", c: C.green },
  rejected: { t: "Отклонено", c: C.danger },
};

function WithdrawModal({ balance, min, onClose, onDone }: { balance: number; min: number; onClose: () => void; onDone: (b: number) => void }) {
  const [amount, setAmount] = useState(balance >= min ? String(Math.floor(balance)) : "");
  const [address, setAddress] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const submit = async () => {
    setErr("");
    const amt = Number(amount);
    if (!amt || amt < min) return setErr(`Минимум ${rub(min)}`);
    if (amt > balance) return setErr("Недостаточно средств");
    const a = address.trim();
    if (!(/^(UQ|EQ|0Q|kQ)[A-Za-z0-9_-]{46}$/.test(a) || /\.ton$/i.test(a) || /\.t\.me$/i.test(a))) return setErr("Неверный адрес. Нужен UQ…/EQ… или .ton / .t.me");
    setBusy(true);
    try {
      const r = await requestWithdraw(amt, a);
      setOk(true);
      onDone(Number(r.partner_balance));
    } catch (e) {
      setErr(errText(e, "Не удалось создать заявку"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Вывод средств" onClose={onClose} busy={busy}>
      {ok ? (
        <>
          <div className="fs-sheet-hint">Заявка создана. Обычно выплата приходит в течение 1–3 дней — статус в разделе «Мои заявки».</div>
          <button type="button" className="fs-cbtn block" style={{ marginTop: 18 }} onClick={onClose}>Готово</button>
        </>
      ) : (
        <>
          <div className="fs-sheet-hint">Выплата в USDT в сети TON. Минимум {rub(min)}, доступно {rub(Math.floor(balance))}.</div>
          <div className="fs-wd">
            <input className="fs-cinput" inputMode="numeric" placeholder={`Сумма, от ${min} ₽`} value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
            <input className="fs-cinput" placeholder="Адрес кошелька: UQ… или name.ton" value={address} onChange={(e) => setAddress(e.target.value)} />
            {err ? <div className="fs-sheet-err">{err}</div> : null}
            <button type="button" className="fs-cbtn block" disabled={busy || balance < min} onClick={submit}>
              {busy ? "Отправляем…" : balance < min ? `Нужно от ${rub(min)}` : "Вывести"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function RequestsModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Withdrawal[] | null>(null);
  useEffect(() => {
    void fetchWithdrawals().then((r) => setItems(r.items || []));
  }, []);
  return (
    <Modal title="Мои заявки" onClose={onClose}>
      {!items ? (
        <div className="fs-sheet-hint">Загружаем…</div>
      ) : items.length === 0 ? (
        <div className="fs-sheet-hint">Заявок на вывод пока не было.</div>
      ) : (
        <div className="fs-wd-list">
          {items.map((w) => (
            <div key={w.id}>
              <div>
                <small>{w.created_at ? formatDateRu(w.created_at) : `#${w.id}`}</small>
                <small title={w.address}>{w.address}</small>
              </div>
              <div style={{ textAlign: "right" }}>
                <b>{rub(w.amount)}</b>
                <br />
                {w.tx_link && w.status === "approved" ? (
                  <a href={w.tx_link} target="_blank" rel="noopener noreferrer"><em style={{ color: WD_STATUS.approved.c }}>Выплачено ↗</em></a>
                ) : (
                  <em style={{ color: WD_STATUS[w.status]?.c }}>{WD_STATUS[w.status]?.t || w.status}</em>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function InviteModal({ link, onClose }: { link: string; onClose: () => void }) {
  const [copied, copy] = useCopied();
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Быстрый VPN с обходом белых списков — FGN")}`;
  return (
    <Modal title="Пригласить друга" onClose={onClose}>
      <div className="fs-sheet-hint">Отправьте ссылку другу. Когда он оплатит подписку, вы получите процент с каждой его оплаты.</div>
      <div className="fs-linkbox">{link || "—"}</div>
      <button type="button" className="fs-cbtn block" style={{ marginTop: 14 }} disabled={!link} onClick={() => copy(link)}>
        {copied ? Ic.check(18) : Ic.copy()}
        {copied ? "Скопировано" : "Скопировать ссылку"}
      </button>
      <a className="fs-cbtn dark block" style={{ marginTop: 8 }} href={share} target="_blank" rel="noopener noreferrer">
        Отправить в Telegram
      </a>
    </Modal>
  );
}

function GiftModal({ data, onClose, onCreated }: { data: ReferralData; onClose: () => void; onCreated: () => void }) {
  const g = data.rewards?.gifts;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [code, setCode] = useState("");
  const [copied, copy] = useCopied();
  const create = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await appFetch<{ code: string }>("/referral/gift", { method: "POST" });
      setCode(r.code);
      onCreated();
    } catch (e) {
      setErr(errText(e, "Не удалось создать подарок"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={code ? "Подарок готов" : "Подарок другу"} onClose={onClose} busy={busy}>
      {code ? (
        <>
          <div className="fs-sheet-hint">Отправьте код другу — он активирует его в разделе «Подарки» и получит месяц подписки с белыми списками.</div>
          <div className="fs-linkbox" style={{ fontSize: 22, fontWeight: 800, letterSpacing: ".04em", textAlign: "center" }}>{code}</div>
          <button type="button" className="fs-cbtn block" style={{ marginTop: 14 }} onClick={() => copy(code)}>
            {copied ? Ic.check(18) : Ic.copy()}
            {copied ? "Скопировано" : "Скопировать код"}
          </button>
        </>
      ) : (
        <>
          <div className="fs-sheet-hint">
            {g && g.left > 0
              ? `На вашем уровне можно дарить ${g.per_month} ${plural(g.per_month, "месяц", "месяца", "месяцев")} подписки в месяц. Осталось: ${g.left}.`
              : `Подарки этого месяца закончились${g?.next_at ? `. Следующий — ${formatDateRu(g.next_at)}` : ""}.`}
          </div>
          {err ? <div className="fs-sheet-err">{err}</div> : null}
          <button type="button" className="fs-cbtn block" style={{ marginTop: 18 }} disabled={busy || !g || g.left <= 0} onClick={create}>
            {busy ? "Создаём…" : "Создать подарок"}
          </button>
        </>
      )}
    </Modal>
  );
}

export default function SiteReferral({ nav }: { nav: CabNav }) {
  const [data, setData] = useState<ReferralData | null>(() => peekReferral());
  const [err, setErr] = useState("");
  const [modal, setModal] = useState<"" | "withdraw" | "requests" | "invite" | "gift">("");
  const [claim, setClaim] = useState<{ busy: boolean; msg?: { kind: "ok" | "err"; text: string } }>({ busy: false });

  const reload = (force = true) =>
    loadReferral(force)
      .then((d) => {
        setData(d);
        setErr("");
      })
      .catch((e) => {
        if (isAuthErr(e)) nav.expired();
        else setErr(errText(e, "Не удалось загрузить данные. Обновите страницу."));
      });
  useEffect(() => {
    void reload(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const claimSelf = async () => {
    setClaim({ busy: true });
    try {
      const r = await appFetch<{ expires_at?: string }>("/referral/claim", { method: "POST" });
      setClaim({ busy: false, msg: { kind: "ok", text: `Готово! Подписка продлена${r.expires_at ? ` до ${formatDateRu(r.expires_at)}` : ""}.` } });
      void reload();
    } catch (e) {
      if (isAuthErr(e)) return nav.expired();
      setClaim({ busy: false, msg: { kind: "err", text: errText(e, "Не удалось получить подписку") } });
    }
  };

  const back = () => nav.go("/cabinet");
  if (!data) {
    return (
      <main className="fs-cab">
        <div className="fs-wrap">
          <CabTop title="Реферальная программа" onBack={back} />
          {err ? <Note kind="err">{err}</Note> : <Loader />}
        </div>
      </main>
    );
  }

  const balance = Number(data.partner_balance || 0);
  const min = Number(data.min_withdraw || 100);
  const active = Number(data.active_count || 0);
  const invited = Number(data.referrals_count || 0);
  const lv = data.level;
  const nx = data.next_level;
  const levels = data.levels || [];
  const curIdx = levels.findIndex((l) => l.key === lv?.key);
  const cur = curIdx >= 0 ? levels[curIdx] : null;
  const pct = nx ? Math.min(100, Math.round((active / Math.max(1, nx.need)) * 100)) : 100;
  const self = data.rewards?.self;
  const gifts = data.rewards?.gifts;
  const freeFrom = Number(cur?.self_free_from || self?.need_active || 0);

  return (
    <main className="fs-cab">
      <div className="fs-wrap">
        <div className="fs-cab-in">
          <CabTop
            title="Реферальная программа"
            onBack={back}
            right={lv ? (
              <div className="fs-ref-lv">
                <span>Ваш уровень</span>
                <b>{lv.name} · {Math.round(lv.rate)}%</b>
              </div>
            ) : undefined}
          />
          {err ? <Note kind="err">{err}</Note> : null}

          <div className="fs-cab-grid c3 fs-ref-top">
            <div className="fs-cab-card">
              <div className="fs-ref-h">
                Доступно к выводу
                <button type="button" aria-label="Вывести" onClick={() => setModal("withdraw")}>{Ic.download(17)}</button>
              </div>
              <div className="fs-ref-num">{rub(Math.floor(balance))}</div>
              <div className="fs-ref-pair">
                <div><span>Заработано всего</span><b>{rub(Number(data.earned_total || 0))}</b></div>
                <div><span>За этот месяц</span><b className="g">+{rub(Number(data.earned_month || 0))}</b></div>
              </div>
              <button type="button" className="fs-cbtn block" style={{ marginTop: 22 }} onClick={() => setModal("withdraw")}>
                Вывести деньги
              </button>
              <button type="button" className="fs-cab-link fs-ref-mini" onClick={() => setModal("requests")}>Мои заявки</button>
            </div>

            <div className="fs-cab-card">
              <div className="fs-ref-h">
                Активных друзей
                <button type="button" aria-label="Ссылка" onClick={() => setModal("invite")}>{Ic.copy(16)}</button>
              </div>
              <div className="fs-ref-num">{active}</div>
              <div className="fs-ref-sub">из {invited} {plural(invited, "приглашённого", "приглашённых", "приглашённых")}</div>
              {data.friends?.length ? (
                <div className="fs-locs">
                  {data.friends.slice(0, 6).map((f, i) => (
                    <span key={i} style={{ height: 32, fontSize: 13.5, color: f.active ? "#fff" : "rgba(196,196,206,.6)" }}>
                      {f.active ? "● " : ""}{f.name}
                    </span>
                  ))}
                </div>
              ) : null}
              <button type="button" className="fs-cbtn block" style={{ marginTop: "auto" }} onClick={() => setModal("invite")}>
                {Ic.userPlus(18)}
                Пригласить друга
              </button>
            </div>

            <div className="fs-cab-card">
              <div className="fs-ref-h">Заработано всего</div>
              <div className="fs-ref-num g">{rub(Number(data.earned_total || 0))}</div>
              <div className="fs-ref-sub">за всё время</div>
            </div>
          </div>

          <div className="fs-cab-card fs-ref-prog" style={{ marginTop: 16 }}>
            <div className="row">
              <b>{nx ? "До следующего уровня" : "Максимальный уровень"}</b>
              <b>{nx ? `${active} / ${nx.need}` : active}</b>
            </div>
            <div className="fs-cab-muted" style={{ marginTop: 8 }}>
              {nx
                ? `Ещё ${Math.max(0, nx.need - active)} ${plural(Math.max(0, nx.need - active), "активный друг", "активных друга", "активных друзей")} — комиссия станет ${Math.round(nx.rate)}%`
                : "Вы получаете максимальный процент с оплат друзей"}
            </div>
            <div className="fs-ref-bar"><i style={{ width: `${pct}%` }} /></div>
          </div>

          {self?.eligible || (gifts && gifts.per_month > 0) ? (
            <div className="fs-cab-grid c2 fs-ref-rw">
              {self?.eligible ? (
                <div className="fs-cab-card">
                  <div>
                    <h3>Подписка бесплатно</h3>
                    <p>
                      {self.available
                        ? "Месяц подписки (ВПН + обход) за активных друзей можно забрать сейчас."
                        : `Уже получали в этом месяце. Следующая — ${self.next_at ? formatDateRu(self.next_at) : "через месяц"}.`}
                    </p>
                    {claim.msg ? <Note kind={claim.msg.kind}>{claim.msg.text}</Note> : null}
                  </div>
                  <button type="button" className="fs-cbtn sm" disabled={!self.available || claim.busy} onClick={claimSelf}>
                    {claim.busy ? "Забираем…" : "Забрать"}
                  </button>
                </div>
              ) : null}
              {gifts && gifts.per_month > 0 ? (
                <div className="fs-cab-card">
                  <div>
                    <h3>Подарки друзьям</h3>
                    <p>Осталось {gifts.left} из {gifts.per_month} в этом месяце — месяц подписки для друга.</p>
                  </div>
                  <button type="button" className="fs-cbtn sm" onClick={() => setModal("gift")}>Подарить</button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="fs-cab-card" style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 24 }}>Уровни рефовода и награды</h3>
            <div className="fs-cab-muted" style={{ marginTop: 8 }}>Процент начисляется с каждой оплаты приглашённых друзей</div>
            <div className="fs-ref-levels">
              {levels.map((l, i) => {
                const nextMin = levels[i + 1]?.min;
                const range = nextMin ? (i === 0 ? `${Math.max(1, l.min)}–${nextMin - 1} активных` : `${l.min} активных`) : `${l.min} активных`;
                return (
                  <div key={l.key} className={l.key === lv?.key ? "on" : undefined}>
                    <strong>{Math.round(l.rate)}%</strong>
                    <b>{l.name}</b>
                    <span>{range}</span>
                    {l.key === lv?.key ? <em>Текущий уровень</em> : null}
                  </div>
                );
              })}
            </div>
            <div className="fs-ref-foot">
              {Math.round(lv?.rate || cur?.rate || 20)}% с платежей.
              {freeFrom > 0 ? ` При ${freeFrom} ${plural(freeFrom, "активном реферале", "активных рефералах", "активных рефералах")} для вас личная подписка бесплатно (ВПН + Обход).` : ""}
            </div>
          </div>
        </div>

        {modal === "withdraw" ? (
          <WithdrawModal balance={balance} min={min} onClose={() => setModal("")}
            onDone={(b) => { patchReferral({ partner_balance: b }); setData((d) => (d ? { ...d, partner_balance: b } : d)); }} />
        ) : modal === "requests" ? (
          <RequestsModal onClose={() => setModal("")} />
        ) : modal === "invite" ? (
          <InviteModal link={data.link || ""} onClose={() => setModal("")} />
        ) : modal === "gift" ? (
          <GiftModal data={data} onClose={() => setModal("")} onCreated={() => void reload()} />
        ) : null}
      </div>
    </main>
  );
}
