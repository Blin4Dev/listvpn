// FGN: «Реферальная программа» (переопределение src/app/pages/Referral.tsx), макеты 53 и 54 («Мои заявки»).
// Заголовок 31/700 по центру в две строки, три карточки (радиус 16, отступы 16): баланс + «Вывести деньги»,
// активные друзья + чипы + «Пригласить друга», «Заработано всего» зелёным; ниже три тёмные кнопки 54.
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch, fetchWithdrawals, openTgLink, requestWithdraw, type Withdrawal } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { copyText } from "../components/SubLinkBox";
import { BRAND_NAME } from "../utils/brand";
import { loadReferral, patchReferral, peekReferral, type ReferralData } from "../utils/referral";
import { C, FgnHeader, FgnIcon, FgnPage, FgnSheet, fgnButton, fgnInput } from "../components/fgn";

const MUTED = "#9B9BA4";
const LABEL = "#6E6E78";
const CARD_BG = "#141416";
const CARD_BORDER = "#2A2A30";
const TEXT = "#F4F4F5";
const GREEN = "#3EE08A";
const RED = "#FF6B6B";
const BTN = "#F3F3F4";

type Sheet = null | "withdraw" | "requests" | "free" | "gift";

/** «1 120 ₽»: группы по 3 цифры неразрывным пробелом (ru-RU не группирует 4 знака) */
const rub = (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
const pct = (n: number) => `${n % 1 ? n.toFixed(1).replace(".", ",") : Math.round(n)}%`;

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

const card: React.CSSProperties = {
  borderRadius: 16,
  border: `1px solid ${CARD_BORDER}`,
  background: CARD_BG,
  boxSizing: "border-box",
  flexShrink: 0,
};
const label: React.CSSProperties = { fontSize: 12, lineHeight: "16px", color: MUTED };
const big: React.CSSProperties = {
  marginTop: 3.5,
  fontSize: 38,
  fontWeight: 700,
  lineHeight: "40px",
  letterSpacing: "-0.01em",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
};
const lightBtn: React.CSSProperties = { ...fgnButton, height: 52, background: BTN, fontSize: 16, fontWeight: 500, letterSpacing: 0 };
const darkBtn: React.CSSProperties = {
  ...fgnButton,
  height: 54,
  borderRadius: 16,
  background: CARD_BG,
  border: `1px solid ${CARD_BORDER}`,
  color: TEXT,
  fontSize: 16,
  fontWeight: 500,
  letterSpacing: 0,
  boxSizing: "border-box",
};

/** заглушка на месте цифры, пока грузятся данные */
function Sk({ w, h }: { w: number; h: number }) {
  return (
    <span
      aria-hidden
      className="blin-skeleton"
      style={{ display: "inline-block", width: w, maxWidth: "100%", height: Math.round(h * 0.72), borderRadius: 8, verticalAlign: "middle" }}
    />
  );
}

/** строка «Заработано всего … 6 340 ₽»: 32 по высоте, 14.5 */
function Row({ name, value }: { name: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, height: 32, fontSize: 14.5, whiteSpace: "nowrap" }}>
      <span style={{ color: MUTED }}>{name}</span>
      <span style={{ color: TEXT, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

/** иконка «копировать» 15×15, как в макете */
function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block", flexShrink: 0 }}>
      <path d="M3.25 10.25h-.5a2 2 0 0 1-2-2v-5.5a2 2 0 0 1 2-2h5.5a2 2 0 0 1 2 2v.5" />
      <rect x="4.75" y="4.75" width="9.5" height="9.5" rx="2" />
    </svg>
  );
}

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
  const friends = Array.isArray(data?.friends) ? data!.friends! : [];
  const link = data?.link || "";
  const level = data?.level;

  // кнопка с иконкой «копировать»: копируем реф. ссылку; если буфер недоступен — открываем «поделиться»
  const invite = async () => {
    if (!link) return;
    if (await copyText(link)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      return;
    }
    const text = `Пользуюсь ${BRAND_NAME} — подключайся по моей ссылке`;
    openTgLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  };

  const fade = (i: number): React.CSSProperties => ({ animation: `fgnFade 0.35s ease ${0.04 * i}s both` });
  const v = (node: React.ReactNode, w: number, h = 20) => (data ? node : <Sk w={w} h={h} />);

  return (
    <FgnPage>
      <FgnHeader title="" onBack={goBack} btnStyle={{ background: CARD_BG, borderColor: CARD_BORDER }} />

      <div style={{ marginTop: 24, flexShrink: 0, textAlign: "center", fontSize: 31, fontWeight: 700, lineHeight: "36px", letterSpacing: "-0.015em", color: TEXT }}>
        Реферальная
        <br />
        программа
      </div>
      <div style={{ marginTop: 8, flexShrink: 0, minHeight: 20, textAlign: "center", fontSize: 14, lineHeight: "20px", color: MUTED }}>
        {level ? `Ваш уровень ${level.name}, ${pct(level.rate)}` : data ? " " : <Sk w={170} h={16} />}
      </div>

      {/* баланс */}
      <div style={{ ...card, ...fade(0), marginTop: 16, padding: "16px 16px 0" }}>
        <div style={label}>Доступно к выводу</div>
        <div style={{ ...big, color: TEXT }}>{v(rub(balance), 150, 40)}</div>
        <Row name="Заработано всего" value={v(rub(earnedTotal), 60, 18)} />
        <Row name="За этот месяц" value={v(`${earnedMonth >= 0 ? "+" : "−"}${rub(Math.abs(earnedMonth))}`, 60, 18)} />
        <button type="button" className="blin-press" onClick={() => setSheet("withdraw")} style={{ ...lightBtn, marginTop: 12.5 }}>
          Вывести деньги
        </button>
        <button
          type="button"
          onClick={() => setSheet("requests")}
          style={{
            appearance: "none",
            display: "block",
            width: "100%",
            margin: 0,
            padding: "11.5px 0 17.5px",
            background: "transparent",
            border: "none",
            fontFamily: C.font,
            fontSize: 14,
            lineHeight: "20px",
            color: MUTED,
            textAlign: "center",
            cursor: "pointer",
          }}
        >
          Мои заявки
        </button>
      </div>

      {/* друзья */}
      <div style={{ ...card, ...fade(1), marginTop: 12, padding: "16px 16px 15px" }}>
        <div style={label}>Активных друзей</div>
        <div style={{ ...big, color: TEXT }}>{v(active, 60, 40)}</div>
        <div style={{ fontSize: 14.5, lineHeight: "20px", color: MUTED }}>
          {v(<>из {invited} {plural(invited, "приглашённого", "приглашённых", "приглашённых")}</>, 130, 16)}
        </div>
        {friends.length ? (
          <div style={{ marginTop: 12.5, display: "flex", flexWrap: "wrap", rowGap: 8, columnGap: 7 }}>
            {friends.map((f, i) => (
              <span
                key={i}
                style={{
                  height: 26,
                  padding: "0 13px",
                  borderRadius: 13,
                  border: `1px solid ${CARD_BORDER}`,
                  boxSizing: "border-box",
                  display: "inline-flex",
                  alignItems: "center",
                  fontSize: 12,
                  lineHeight: "16px",
                  color: MUTED,
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                  overflow: "hidden",
                }}
              >
                {f.name}&nbsp;·&nbsp;<span style={{ color: f.active ? TEXT : MUTED }}>{f.active ? "активен" : "ждёт"}</span>
              </span>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className="blin-press"
          onClick={() => void invite()}
          disabled={!link}
          style={{ ...lightBtn, marginTop: 16, borderRadius: 16, gap: 10, opacity: link ? 1 : 0.4 }}
        >
          {copied ? <FgnIcon name="check" size={15} stroke={2} /> : <CopyIcon />}
          {copied ? "Ссылка скопирована" : "Пригласить друга"}
        </button>
      </div>

      {/* заработано */}
      <div style={{ ...card, ...fade(2), marginTop: 12, padding: "16px 16px 16.5px" }}>
        <div style={label}>Заработано всего</div>
        <div style={{ ...big, color: GREEN }}>{v(rub(earnedTotal), 150, 40)}</div>
        <div style={{ fontSize: 14.5, lineHeight: "20px", color: MUTED }}>за всё время</div>
      </div>

      <div style={{ ...fade(3), display: "flex", flexDirection: "column", gap: 8, marginTop: 12, flexShrink: 0 }}>
        <button type="button" className="blin-press" onClick={() => navigate("/referral/levels")} style={darkBtn}>Уровни и награды</button>
        <button type="button" className="blin-press" onClick={() => setSheet("free")} style={darkBtn}>Получить подписку бесплатно</button>
        <button type="button" className="blin-press" onClick={() => setSheet("gift")} style={darkBtn}>Подарить подписку другу</button>
      </div>

      {sheet === "withdraw" && (
        <WithdrawSheet
          balance={balance}
          min={Number(data?.min_withdraw || 100)}
          onClose={() => setSheet(null)}
          onDone={(b) => { setData((d) => (d ? { ...d, partner_balance: b } : d)); patchReferral({ partner_balance: b }); void load(); }}
        />
      )}
      {sheet === "requests" && <RequestsSheet onClose={() => setSheet(null)} />}
      {sheet === "free" && data && (
        <FreeSheet data={data} onClose={() => setSheet(null)} onClaimed={() => void load()} onOpenSub={() => navigate("/subscription")} />
      )}
      {sheet === "gift" && data && <GiftSheet data={data} onClose={() => setSheet(null)} onCreated={() => void load()} onBuy={() => navigate("/gift/buy")} />}
    </FgnPage>
  );
}

// ── общее для листов ──
const SHEET_DIM = "rgba(0, 0, 0, 0.65)"; // макет 54
const sheetText: React.CSSProperties = { marginTop: 16, fontSize: 14.5, lineHeight: "21px", color: MUTED };
const sheetErr: React.CSSProperties = { marginTop: 10, fontSize: 13.5, lineHeight: "18px", color: RED };
// листы «Подписка бесплатно» / «Подарить подписку» (макеты 62/63): текст 14.5/22 на 17 ниже шапки,
// кнопка-пилюля на 18 ниже текста (светлая 52, тёмная 54)
const rewardText: React.CSSProperties = { ...sheetText, marginTop: 17, lineHeight: "22px" };
const rewardBtns: React.CSSProperties = { marginTop: 18, display: "flex", flexDirection: "column", gap: 8 };
const fieldLabel: React.CSSProperties = { fontSize: 12, lineHeight: "16px", color: MUTED, margin: "16px 0 8px" };

function SheetBtn({ children, onClick, disabled, dark, pill }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; dark?: boolean; pill?: boolean }) {
  return (
    <button
      type="button"
      className="blin-press"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...(dark ? darkBtn : { ...lightBtn, borderRadius: 16 }),
        ...(pill ? { borderRadius: 999 } : null),
        gap: 8,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

// ── вывод ──
function WithdrawSheet({ balance, min, onClose, onDone }: { balance: number; min: number; onClose: () => void; onDone: (b: number) => void }) {
  const [amount, setAmount] = useState(balance >= min ? String(Math.floor(balance)) : "");
  const [address, setAddress] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  const submit = async () => {
    setErr("");
    const amt = Number(amount);
    if (!amt || amt < min) { setErr(`Минимум ${min} ₽`); return; }
    if (amt > balance) { setErr("Недостаточно средств"); return; }
    const a = address.trim();
    const okAddr = /^(UQ|EQ|0Q|kQ)[A-Za-z0-9_-]{46}$/.test(a) || /\.ton$/i.test(a) || /\.t\.me$/i.test(a);
    if (!okAddr) { setErr("Неверный адрес. Нужен UQ…/EQ… или .ton / .t.me"); return; }
    setBusy(true);
    try {
      const res = await requestWithdraw(amt, a);
      setOk(true);
      onDone(res.partner_balance);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось создать заявку");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FgnSheet title="Вывод средств" onClose={onClose} dim={SHEET_DIM}>
      {ok ? (
        <>
          <div style={sheetText}>Заявка создана. Деньги заморожены до решения администратора — статус можно посмотреть в «Моих заявках».</div>
          <div style={{ marginTop: 20 }}>
            <SheetBtn onClick={onClose}>Готово</SheetBtn>
          </div>
        </>
      ) : (
        <>
          <div style={sheetText}>Выплата в USDT в сети TON. Минимум {rub(min)}, доступно {rub(Math.floor(balance))}.</div>
          <div style={fieldLabel}>Сумма, ₽</div>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={String(min)}
            inputMode="numeric"
            style={{ ...fgnInput, borderRadius: 16, border: `1px solid ${CARD_BORDER}`, fontSize: 16 }}
          />
          <div style={fieldLabel}>Адрес кошелька (UQ… / EQ… / .ton)</div>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="UQ… или name.ton"
            style={{ ...fgnInput, borderRadius: 16, border: `1px solid ${CARD_BORDER}`, fontSize: 16 }}
          />
          {err ? <div style={sheetErr}>{err}</div> : null}
          <div style={{ marginTop: 20 }}>
            <SheetBtn disabled={busy || balance < min} onClick={() => void submit()}>
              {busy ? "Отправляем…" : balance < min ? `Нужно от ${rub(min)}` : "Запросить вывод"}
            </SheetBtn>
          </div>
        </>
      )}
    </FgnSheet>
  );
}

// ── мои заявки (макет 54): дата 14.5 + адрес 12 слева, сумма 16/600 справа ──
const W_STATUS: Record<string, [string, string]> = {
  pending: ["на рассмотрении", "#FFB23F"],
  approved: ["одобрена", "#7FB2FF"],
  rejected: ["отклонена", RED],
};

function shortAddr(a: string) {
  const s = (a || "").trim();
  return s.length > 22 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function RequestsSheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Withdrawal[] | null>(null);
  useEffect(() => { void fetchWithdrawals().then((r) => setItems(r.items || [])).catch(() => setItems([])); }, []);
  return (
    <FgnSheet title="Мои заявки" onClose={onClose} dim={SHEET_DIM}>
      {items === null ? (
        <div style={{ ...sheetText, marginTop: 18 }}>Загрузка…</div>
      ) : items.length === 0 ? (
        <div style={{ ...sheetText, marginTop: 18 }}>Заявок на вывод пока не было.</div>
      ) : (
        <div style={{ marginTop: 6.5 }}>
          {items.map((w, i) => {
            const st = W_STATUS[w.status];
            return (
              <div
                key={w.id}
                style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0", borderTop: i ? `1px solid ${CARD_BORDER}` : "none" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, lineHeight: "20px", color: MUTED }}>{w.created_at ? `${formatDateRu(w.created_at)} г.` : "—"}</div>
                  <div style={{ marginTop: 7, fontSize: 12, lineHeight: "16px", color: LABEL, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {shortAddr(w.address)}
                    {st ? <span style={{ color: st[1] }}> · {st[0]}</span> : null}
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, lineHeight: "20px", color: TEXT, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {rub(Number(w.amount))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </FgnSheet>
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
  if (done !== null) text = `Готово! Подписка с белыми списками продлена${done ? ` до ${formatDateRu(done)}` : ""}.`;
  else if (!st?.eligible) text = `Нужно ${st?.need_active || 5} активных друзей — сейчас ${active}. Пригласите ещё ${Math.max(0, (st?.need_active || 5) - active)}, и месяц подписки (ВПН + обход) будет бесплатным.`;
  else if (!st.available) text = `В этом месяце бесплатную подписку уже получали. Следующая — ${st.next_at ? formatDateRu(st.next_at) : "через месяц"}.`;
  else text = `У вас ${active} ${plural(active, "активный друг", "активных друга", "активных друзей")}. Месяц подписки (ВПН + обход) можно забрать бесплатно.`;

  return (
    <FgnSheet title="Подписка бесплатно" onClose={onClose} dim={SHEET_DIM}>
      <div style={rewardText}>{text}</div>
      {err ? <div style={sheetErr}>{err}</div> : null}
      <div style={rewardBtns}>
        {done !== null ? (
          <SheetBtn pill onClick={() => { onClose(); onOpenSub(); }}>К подписке</SheetBtn>
        ) : st?.eligible && st.available ? (
          <SheetBtn pill dark disabled={busy} onClick={() => void claim()}>{busy ? "Забираем…" : "Забрать"}</SheetBtn>
        ) : (
          <SheetBtn pill dark onClick={onClose}>Понятно</SheetBtn>
        )}
      </div>
    </FgnSheet>
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
  const giftText = (c: string) => `Дарю тебе месяц ${BRAND_NAME} (ВПН + обход)! Открой ${bot || "бота"} → «Подарки» и введи код ${c}`;
  const send = (c: string) => openTgLink(`https://t.me/share/url?url=${encodeURIComponent(bot)}&text=${encodeURIComponent(giftText(c))}`);

  if (code) {
    return (
      <FgnSheet title="Подарок готов" onClose={onClose} dim={SHEET_DIM}>
        <div style={sheetText}>Отправьте код другу — он введёт его в разделе «Подарки» и получит месяц подписки с белыми списками.</div>
        <div
          style={{
            ...card,
            marginTop: 16,
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: TEXT,
            background: "#0B0B0C",
            userSelect: "all",
            WebkitUserSelect: "all",
          }}
        >
          {code}
        </div>
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <SheetBtn onClick={() => send(code)}>Отправить другу</SheetBtn>
          <SheetBtn dark onClick={() => { void copyText(code).then((ok) => ok && setCopied(true)); }}>
            {copied ? <FgnIcon name="check" size={16} stroke={2} /> : <CopyIcon />}
            {copied ? "Скопировано" : "Скопировать код"}
          </SheetBtn>
        </div>
      </FgnSheet>
    );
  }

  const items = g?.items || [];
  const canCreate = !!g && g.per_month > 0 && g.left > 0;
  return (
    <FgnSheet title="Подарить подписку" onClose={onClose} dim={SHEET_DIM}>
      <div style={rewardText}>
        {!g || g.per_month <= 0
          ? `Подарки открываются с уровня Spreader — нужно 30 активных друзей, у вас ${Number(data.active_count || 0)}.`
          : g.left > 0
            ? `Можно подарить другу месяц подписки (ВПН + обход). Осталось в этом месяце: ${g.left} из ${g.per_month}.`
            : `Подарки на этот месяц закончились. Новые — ${g.next_at ? formatDateRu(g.next_at) : "через месяц"}.`}
      </div>
      {err ? <div style={sheetErr}>{err}</div> : null}
      <div style={rewardBtns}>
        {canCreate ? (
          <>
            <SheetBtn pill disabled={busy} onClick={() => void create()}>{busy ? "Создаём…" : "Создать подарок"}</SheetBtn>
            <SheetBtn pill dark onClick={onBuy}>Купить ещё подарок</SheetBtn>
          </>
        ) : (
          <SheetBtn pill onClick={onBuy}>
            <FgnIcon name="gift" size={15} stroke={2.4} />
            Купить подарок
          </SheetBtn>
        )}
      </div>
      {items.length ? (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, lineHeight: "16px", letterSpacing: "0.1em", textTransform: "uppercase", color: LABEL, marginBottom: 4 }}>Ваши подарки</div>
          {items.map((it, i) => (
            <div key={it.code} style={{ display: "flex", alignItems: "center", gap: 10, height: 48, borderTop: i ? `1px solid ${CARD_BORDER}` : "none" }}>
              <span style={{ flex: 1, fontSize: 15, color: TEXT, letterSpacing: "0.04em" }}>{it.code}</span>
              {it.status === "redeemed" ? (
                <span style={{ fontSize: 14, color: GREEN }}>активирован</span>
              ) : (
                <button
                  type="button"
                  onClick={() => send(it.code)}
                  style={{ appearance: "none", margin: 0, padding: "10px 0 10px 12px", background: "transparent", border: "none", fontFamily: C.font, color: MUTED, fontSize: 14, cursor: "pointer" }}
                >
                  отправить
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </FgnSheet>
  );
}
