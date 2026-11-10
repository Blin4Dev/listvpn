import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { SBP_PHONE_RE, appFetch, fetchWithdrawals, formatSbpPhone, openTgLink, requestWithdraw, type WithdrawMethod, type Withdrawal } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { copyText } from "../components/SubLinkBox";
import { MSIcon, btnReset } from "../components/ui";
import { N, NoirButton, NoirCard, NoirSheet, useTgBack } from "../components/noir";
import { O, OBack, OButton, OScreen } from "../components/ovpn";

// O-VPN: 16–17 «Рефералы», 19 «Бесплатная подписка», 20 «Подарить», 39–42 листы
import { BRAND_NAME, levelName } from "../utils/brand";
import { loadReferral, patchReferral, peekReferral, type ReferralData } from "../utils/referral";

type Sheet = null | "withdraw" | "requests" | "free" | "gift";

const rub = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
const pct = (n: number) => `${n % 1 ? n.toFixed(1).replace(".", ",") : Math.round(n)}%`;

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

/** белая кнопка-пилюля как на макете */
function WhiteButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <OButton tone="cream" disabled={disabled} onClick={onClick}>{children}</OButton>;
}

function TextLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...btnReset, fontFamily: O.font, display: "block", margin: "0 auto", background: "transparent", border: "none", padding: "12px 16px 0", fontSize: 14, fontWeight: 600, lineHeight: "20px", color: O.muted, cursor: "pointer" }}
    >
      {children}
    </button>
  );
}

/** тёмная кнопка 56 с текстом по центру */
function OutlineButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <OButton tone="dark" onClick={onClick}>{children}</OButton>;
}

function Input({ value, onChange, placeholder, inputMode }: { value: string; onChange: (v: string) => void; placeholder?: string; inputMode?: "numeric" | "text" | "tel" }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      style={{
        width: "100%",
        height: 56,
        boxSizing: "border-box",
        padding: "0 16px",
        borderRadius: 16,
        border: `1px solid ${O.border}`,
        background: O.bg,
        color: O.text,
        fontFamily: O.font,
        fontSize: 16,
        fontWeight: 500,
        outline: "none",
      }}
    />
  );
}

/** заглушка на месте цифры, пока грузятся данные */
function Sk({ w, h }: { w: number; h: number }) {
  return (
    <span
      aria-hidden
      className="blin-skeleton"
      style={{ display: "inline-block", width: w, maxWidth: "100%", height: Math.round(h * 0.72), borderRadius: 10, verticalAlign: "middle" }}
    />
  );
}

const W_STATUS: Record<string, [string, string]> = {
  pending: ["На рассмотрении", N.warn],
  approved: ["Одобрена", "#7FB2FF"],
  completed: ["Выплачено", "#3DD68C"],
  rejected: ["Отклонена", N.redText],
};

export default function Referral() {
  const goBack = useSmartBack("/");
  const navigate = useNavigate();
  // сразу последние известные данные (кэш), свежие — фоном
  const [data, setData] = useState<ReferralData | null>(() => peekReferral());
  const [sheet, setSheet] = useState<Sheet>(null);
  const [copied, setCopied] = useState(false);

  const load = async (force = true) => {
    try {
      setData(await loadReferral(force));
    } catch {
      setData((d) => d || { partner_balance: 0, referrals_count: 0, active_count: 0, earned_total: 0, earned_month: 0 });
    }
  };
  useEffect(() => { void load(); }, []);

  const balance = Number(data?.partner_balance || 0);
  const earnedTotal = Number(data?.earned_total || 0);
  const earnedMonth = Number(data?.earned_month || 0);
  const active = Number(data?.active_count || 0);
  const invited = Number(data?.referrals_count || 0);
  const link = data?.link || "";
  const level = data?.level;

  const invite = () => {
    if (!link) return;
    const text = `Пользуюсь ${BRAND_NAME} — подключайся по моей ссылке`;
    openTgLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  };
  const copyLink = async () => {
    if (await copyText(link)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  // карточки видны сразу; пока нет данных — заглушки вместо цифр
  const rise = (i: number): React.CSSProperties => ({ animation: `blinvpnRise 0.45s var(--ease-out) ${0.04 * i}s both` });
  const v = (node: React.ReactNode, w: number, h = 22) => (data ? node : <Sk w={w} h={h} />);

  const label: React.CSSProperties = { fontSize: 14, lineHeight: "20px", color: O.muted };
  const big: React.CSSProperties = { fontSize: 40, fontWeight: 800, lineHeight: "48px", fontVariantNumeric: "tabular-nums" };

  useTgBack(goBack);
  return (
    <OScreen>
      <OBack onClick={goBack} />

      <div style={{ textAlign: "center", paddingTop: 12 }}>
        <div style={{ fontSize: 30, fontWeight: 800, lineHeight: "30px", color: O.text }}>Реферальная программа</div>
        <div style={{ paddingTop: 8, fontSize: 14, lineHeight: "20px", color: O.muted, minHeight: 20 }}>
          {level ? `Ваш уровень ${level.name}, ${pct(level.rate)}` : data ? " " : <Sk w={170} h={16} />}
        </div>
      </div>

      <NoirCard style={{ ...rise(0), marginTop: 16, padding: 16 }}>
        <div style={label}>Доступно к выводу</div>
        <div style={{ ...big, color: O.text }}>{v(rub(balance), 150, 48)}</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, lineHeight: "20px", padding: "20px 0 4px" }}>
          <span style={{ color: N.muted }}>Заработано всего</span>
          <span style={{ color: N.text }}>{v(rub(earnedTotal), 60, 18)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, lineHeight: "20px", padding: "8px 0 16px" }}>
          <span style={{ color: N.muted }}>За этот месяц</span>
          <span style={{ color: O.green, fontWeight: 600 }}>{v(`${earnedMonth >= 0 ? "+" : "−"}${rub(Math.abs(earnedMonth))}`, 60, 18)}</span>
        </div>
        <WhiteButton onClick={() => setSheet("withdraw")}>Вывести деньги</WhiteButton>
        <TextLink onClick={() => setSheet("requests")}>Мои заявки</TextLink>
      </NoirCard>

      <NoirCard style={{ ...rise(1), marginTop: 12, padding: 16 }}>
        <div style={label}>Активных друзей</div>
        <div style={{ ...big, color: O.text }}>{v(active, 60, 48)}</div>
        <div style={{ ...label, paddingTop: 4, marginBottom: 16 }}>
          {v(<>из {invited} {plural(invited, "приглашённого", "приглашённых", "приглашённых")}</>, 130, 16)}
        </div>
        <WhiteButton onClick={invite} disabled={!link}>Пригласить друга</WhiteButton>
        <TextLink onClick={() => void copyLink()}>{copied ? "Ссылка скопирована" : "Скопировать ссылку"}</TextLink>
      </NoirCard>

      <NoirCard style={{ ...rise(2), marginTop: 12, padding: 16 }}>
        <div style={label}>Заработано всего</div>
        <div style={{ ...big, color: O.red }}>{v(rub(earnedTotal), 150, 48)}</div>
        <div style={{ ...label, paddingTop: 4 }}>за всё время</div>
      </NoirCard>

      <div style={{ ...rise(3), display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
        <OutlineButton onClick={() => navigate("/referral/levels")}>Уровни и награды</OutlineButton>
        <OutlineButton onClick={() => setSheet("free")}>Получить подписку бесплатно</OutlineButton>
        <OutlineButton onClick={() => setSheet("gift")}>Подарить подписку другу</OutlineButton>
      </div>

      {sheet === "withdraw" && (
        <WithdrawSheet
          balance={balance}
          min={Number(data?.min_withdraw || 2000)}
          onClose={() => setSheet(null)}
          onDone={(b) => { setData((d) => (d ? { ...d, partner_balance: b } : d)); patchReferral({ partner_balance: b }); void load(); }}
        />
      )}
      {sheet === "requests" && <RequestsSheet onClose={() => setSheet(null)} />}
      {sheet === "free" && data && (
        <FreeSheet data={data} onClose={() => setSheet(null)} onClaimed={() => void load()} onOpenSub={() => navigate("/subscription")} />
      )}
      {sheet === "gift" && data && <GiftSheet data={data} onClose={() => setSheet(null)} onCreated={() => void load()} onBuy={() => navigate("/gift/buy")} />}
    </OScreen>
  );
}

// ── вывод ──
function WithdrawSheet({ balance, min, onClose, onDone }: { balance: number; min: number; onClose: () => void; onDone: (b: number) => void }) {
  const [amount, setAmount] = useState(balance >= min ? String(Math.floor(balance)) : "");
  const [method, setMethod] = useState<WithdrawMethod>("usdt_ton");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [bank, setBank] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  const submit = async () => {
    setErr("");
    const amt = Number(amount);
    if (!amt || amt < min) { setErr(`Минимум ${min} ₽`); return; }
    if (amt > balance) { setErr("Недостаточно средств"); return; }
    let dest = "";
    if (method === "sbp") {
      if (!SBP_PHONE_RE.test(phone)) { setErr("Номер телефона — в формате +7 9xx xxx xx xx"); return; }
      if (bank.trim().length < 2) { setErr("Укажите название банка"); return; }
      dest = phone;
    } else {
      dest = address.trim();
      const okAddr = /^(UQ|EQ|0Q|kQ)[A-Za-z0-9_-]{46}$/.test(dest) || /\.ton$/i.test(dest) || /\.t\.me$/i.test(dest);
      if (!okAddr) { setErr("Неверный адрес. Нужен UQ…/EQ… или .ton / .t.me"); return; }
    }
    setBusy(true);
    try {
      const res = await requestWithdraw(amt, dest, method, bank.trim());
      setOk(true);
      onDone(res.partner_balance);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось создать заявку");
    } finally {
      setBusy(false);
    }
  };

  return (
    <NoirSheet title="Вывод средств" onClose={onClose}>
      {ok ? (
        <>
          <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted, marginBottom: 16 }}>
            Заявка создана. Деньги заморожены до решения администратора — статус можно посмотреть в «Моих заявках».
          </div>
          <NoirButton onClick={onClose}>Готово</NoirButton>
        </>
      ) : (
        <>
          <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted, marginBottom: 16 }}>
            {method === "sbp" ? "Выплата по СБП на номер телефона." : "Выплата в USDT в сети TON."} Минимум {min} ₽, доступно {Math.floor(balance)} ₽.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            {([["usdt_ton", "USDT (TON)"], ["sbp", "СБП"]] as const).map(([m, t]) => (
              <button
                key={m}
                type="button"
                className="blin-press"
                onClick={() => { setMethod(m); setErr(""); }}
                style={{
                  ...btnReset, height: 44, borderRadius: 14, fontFamily: N.font, fontSize: 15, fontWeight: 500, cursor: "pointer",
                  border: `1px solid ${method === m ? N.redText : N.cardBorder}`,
                  background: method === m ? "rgba(224,0,0,0.14)" : "rgba(255,255,255,0.05)",
                  color: method === m ? N.text : N.muted,
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 14, color: N.muted, marginBottom: 6 }}>Сумма, ₽</div>
          <Input value={amount} onChange={(v) => setAmount(v.replace(/[^\d]/g, ""))} placeholder={String(min)} inputMode="numeric" />
          {method === "sbp" ? (
            <>
              <div style={{ fontSize: 14, color: N.muted, margin: "14px 0 6px" }}>Номер телефона</div>
              <Input value={phone} onChange={(v) => setPhone(formatSbpPhone(v))} placeholder="+7 9xx xxx xx xx" inputMode="tel" />
              <div style={{ fontSize: 14, color: N.muted, margin: "14px 0 6px" }}>Банк</div>
              <Input value={bank} onChange={(v) => setBank(v.slice(0, 60))} placeholder="Например: Сбербанк, Т-Банк" />
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, color: N.muted, margin: "14px 0 6px" }}>Адрес кошелька (UQ… / EQ… / .ton)</div>
              <Input value={address} onChange={setAddress} placeholder="UQ… или name.ton" />
            </>
          )}
          {err ? <div style={{ fontSize: 13.5, color: "#FF6B6B", marginTop: 10 }}>{err}</div> : null}
          <div style={{ marginTop: 18 }}>
            <NoirButton primary disabled={busy || balance < min} onClick={() => void submit()}>
              {busy ? "Отправляем…" : balance < min ? `Нужно от ${min} ₽` : "Запросить вывод"}
            </NoirButton>
          </div>
        </>
      )}
    </NoirSheet>
  );
}

function RequestsSheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Withdrawal[] | null>(null);
  useEffect(() => { void fetchWithdrawals().then((r) => setItems(r.items || [])).catch(() => setItems([])); }, []);
  return (
    <NoirSheet title="Мои заявки" onClose={onClose}>
      {items === null ? (
        <div style={{ fontSize: 15, color: N.muted }}>Загрузка…</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 15, color: N.muted, lineHeight: 1.5 }}>Заявок на вывод пока не было.</div>
      ) : (
        <div>
          {items.map((w, i) => {
            const [title, color] = W_STATUS[w.status] || [w.status, N.muted];
            return (
              <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i ? `1px solid ${N.divider}` : "none" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16.5, color: N.text }}>{rub(Number(w.amount))}</div>
                  <div style={{ fontSize: 13.5, color: N.muted, marginTop: 2 }}>
                    {w.created_at ? formatDateRu(w.created_at) : ""}{w.method === "sbp" ? ` · СБП${w.bank ? `, ${w.bank}` : ""}` : ""}
                  </div>
                </div>
                <div style={{ fontSize: 14, color }}>{title}</div>
              </div>
            );
          })}
        </div>
      )}
    </NoirSheet>
  );
}

// ── бесплатная подписка ──
function FreeSheet({ data, onClose, onClaimed, onOpenSub }: { data: ReferralData; onClose: () => void; onClaimed: () => void; onOpenSub: () => void }) {
  const st = data.rewards?.self;
  const active = Number(data.active_count || 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const claim = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await appFetch<{ expires_at?: string }>("/referral/claim", { method: "POST" });
      setDone(r.expires_at || "");
      onClaimed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось получить подписку");
    } finally {
      setBusy(false);
    }
  };

  let text: string;
  if (done !== null) text = `Готово! Подписка продлена${done ? ` до ${formatDateRu(done)}` : ""}.`;
  else if (!st?.eligible) text = `Нужно ${st?.need_active || 5} активных друзей — сейчас ${active}. Пригласите ещё ${Math.max(0, (st?.need_active || 5) - active)}, и месяц подписки будет бесплатным.`;
  else if (!st.available) text = `В этом месяце бесплатную подписку уже получали. Следующая — ${st.next_at ? formatDateRu(st.next_at) : "через месяц"}.`;
  else text = "У вас достаточно активных друзей. Получите месяц подписки бесплатно — она добавится к текущей.";

  return (
    <NoirSheet title="Подписка бесплатно" onClose={onClose}>
      <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted, marginBottom: 16 }}>{text}</div>
      {err ? <div style={{ fontSize: 13.5, color: "#FF6B6B", marginBottom: 12 }}>{err}</div> : null}
      {done !== null ? (
        <NoirButton primary onClick={() => { onClose(); onOpenSub(); }}>К подписке</NoirButton>
      ) : st?.eligible && st.available ? (
        <NoirButton primary disabled={busy} onClick={() => void claim()}>{busy ? "Выдаём…" : "Получить месяц бесплатно"}</NoirButton>
      ) : (
        <NoirButton onClick={onClose}>Понятно</NoirButton>
      )}
    </NoirSheet>
  );
}

// ── подарки ──
function GiftSheet({ data, onClose, onCreated, onBuy }: { data: ReferralData; onClose: () => void; onCreated: () => void; onBuy: () => void }) {
  const g = data.rewards?.gifts;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const bot = (data.link || "").split("?")[0];

  const create = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await appFetch<{ code: string }>("/referral/gift", { method: "POST" });
      setCode(r.code);
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось создать подарок");
    } finally {
      setBusy(false);
    }
  };
  const giftText = (c: string) => `Дарю тебе месяц ${BRAND_NAME}! Открой ${bot || "бота"} → «Подарки» и введи код ${c}`;
  const send = (c: string) => openTgLink(`https://t.me/share/url?url=${encodeURIComponent(bot)}&text=${encodeURIComponent(giftText(c))}`);

  if (code) {
    return (
      <NoirSheet title="Подарок готов" onClose={onClose}>
        <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted, marginBottom: 16 }}>
          Отправьте код другу — он введёт его в разделе «Подарки» и получит месяц подписки.
        </div>
        <div style={{ textAlign: "center", fontSize: 24, fontWeight: 800, lineHeight: "32px", letterSpacing: "1.2px", color: O.text, padding: "16px 0", borderRadius: 16, background: O.bg, border: `1px solid ${O.border}`, userSelect: "all", WebkitUserSelect: "all", marginBottom: 14 }}>
          {code}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <NoirButton primary icon="send" onClick={() => send(code)}>Отправить другу</NoirButton>
          <NoirButton icon={copied ? "check" : "content_copy"} onClick={() => { void copyText(code).then((ok) => ok && setCopied(true)); }}>
            {copied ? "Скопировано" : "Скопировать код"}
          </NoirButton>
        </div>
      </NoirSheet>
    );
  }

  const items = g?.items || [];
  return (
    <NoirSheet title="Подарить подписку" onClose={onClose}>
      <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted, marginBottom: 16 }}>
        {!g || g.per_month <= 0
          ? `Подарки открываются с уровня ${levelName("spreader", "Spreader")} — нужно 30 активных друзей, у вас ${Number(data.active_count || 0)}.`
          : g.left > 0
            ? `Можно подарить другу месяц подписки. Осталось в этом месяце: ${g.left} из ${g.per_month}.`
            : `Подарки на этот месяц закончились. Новые — ${g.next_at ? formatDateRu(g.next_at) : "через месяц"}.`}
      </div>
      {err ? <div style={{ fontSize: 13.5, color: "#FF6B6B", marginBottom: 12 }}>{err}</div> : null}
      {g && g.per_month > 0 && g.left > 0 ? (
        <NoirButton primary disabled={busy} onClick={() => void create()}>{busy ? "Создаём…" : "Создать подарок"}</NoirButton>
      ) : (
        <NoirButton primary icon="redeem" onClick={onBuy}>Купить подарок</NoirButton>
      )}
      {g && g.per_month > 0 && g.left > 0 ? <TextLink onClick={onBuy}>Купить ещё подарок</TextLink> : null}
      {items.length ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 13, letterSpacing: "0.12em", textTransform: "uppercase", color: N.dim, marginBottom: 6 }}>Ваши подарки</div>
          {items.map((it, i) => (
            <div key={it.code} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderTop: i ? `1px solid ${N.divider}` : "none" }}>
              <span style={{ flex: 1, fontSize: 15.5, color: N.text, letterSpacing: "0.04em" }}>{it.code}</span>
              {it.status === "redeemed" ? (
                <span style={{ fontSize: 14, color: "#3DD68C" }}>активирован</span>
              ) : (
                <button type="button" onClick={() => send(it.code)} style={{ ...btnReset, fontFamily: N.font, background: "transparent", border: "none", color: N.redText, fontSize: 14.5, cursor: "pointer", padding: 0 }}>
                  отправить
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </NoirSheet>
  );
}
