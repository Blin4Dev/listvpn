// FGN: итог оплаты (переопределение src/app/components/PaymentSheet.tsx) — «Оплачено» / «Платёж отменён» /
// «Ожидаем оплату» / «Подарок готов». Логика опроса — как в оригинале.
// Макет: круг 64 со значком, заголовок 30/600, подпись (срок), сумма 36/600, карточка с деталями (строки 28px),
// светлая кнопка 52 и тёмная 54 с рамкой.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appFetch, fetchPaymentStatus, markPaymentSeen, openPayUrl, openStarsInvoice, openTgLink } from "../utils/api";
import { copyText } from "./SubLinkBox";
import { BRAND_NAME } from "../utils/brand";
import { useTgBack } from "./noir";
import { deviceWord } from "../utils/devices";
import { C, FgnPage, fgnButton } from "./fgn";

type Phase = "pending" | "paid" | "failed" | "error";

export type PendingPayment = {
  paymentId: string;
  provider: string;
  payUrl?: string;
  invoiceLink?: string;
  // тип: subscription | devices | traffic_reset | gift
  purpose?: string;
  // способ оплаты: sbp | card | international | tg_stars | crypto
  method?: string;
};

// «в открывшемся окне …»
const WINDOW_NAME: Record<string, string> = {
  sbp: "СБП",
  card: "оплаты картой",
  sberpay: "SberPay",
  tg_stars: "Telegram",
};

const POLL_MS = 2000;
const CARD_BORDER = "rgba(42, 42, 48, 1)";

type Details = {
  months: number;
  days: number | null;
  whitelist: boolean;
  amount: number | null;
  currency: string;
  stars: number | null;
  refApplied: number;
  extraDevices: number;
};

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

function periodLabel(m: number) {
  if (m === 12) return "1 год";
  return `${m} ${plural(m, "месяц", "месяца", "месяцев")}`;
}

/** 1 290 ₽ — разделитель разрядов NBSP */
function fmt(n: number) {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
}

export default function PaymentSheet({
  payment,
  returnTo,
  onClose,
  onDone,
  failedHint = false,
  onRetry,
}: {
  payment: PendingPayment;
  returnTo?: string;
  onClose: () => void;
  // в FGN после оплаты не уходим сами: экран «Оплачено» ждёт кнопку
  autoAdvance?: boolean;
  onDone?: () => void;
  failedHint?: boolean;
  onRetry?: () => void;
}) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("pending");
  const [payUrl, setPayUrl] = useState(payment.payUrl || "");
  const [invoiceLink, setInvoiceLink] = useState(payment.invoiceLink || "");
  const [purpose, setPurpose] = useState(payment.purpose || "subscription");
  const [giftCode, setGiftCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [method, setMethod] = useState(payment.method || (payment.provider === "tg_stars" ? "tg_stars" : ""));
  const [info, setInfo] = useState<Details | null>(null);
  const stopped = useRef(false);
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (stopped.current || inFlight.current) return;
    inFlight.current = true;
    try {
      const s = await fetchPaymentStatus(payment.paymentId);
      if (s.pay_url) setPayUrl(s.pay_url);
      if (s.invoice_link) setInvoiceLink(s.invoice_link);
      if (s.purpose) setPurpose(s.purpose);
      if (s.gift_code) setGiftCode(s.gift_code);
      if (s.method) setMethod(s.method);
      setInfo({
        months: Number(s.months || 0),
        days: s.days != null ? Number(s.days) : null,
        whitelist: !!s.whitelist,
        amount: s.amount != null ? Number(s.amount) : null,
        currency: String(s.currency || "RUB"),
        stars: s.stars != null ? Number(s.stars) : null,
        refApplied: Number(s.referral_applied || 0),
        extraDevices: Number(s.extra_devices || 0),
      });
      if (s.status === "paid") {
        stopped.current = true;
        setPhase("paid");
      } else if (s.status === "failed") {
        stopped.current = true;
        setPhase("failed");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/не найден/i.test(msg)) {
        stopped.current = true;
        setPhase("error");
      }
      /* сеть моргнула — опросим снова */
    } finally {
      inFlight.current = false;
    }
  }, [payment.paymentId]);

  // url отказа, но провайдер ещё не отказал: показать отказ, продолжить опрос
  useEffect(() => {
    if (!failedHint) return;
    const t = window.setTimeout(() => setPhase((ph) => (ph === "pending" ? "failed" : ph)), 6000);
    return () => window.clearTimeout(t);
  }, [failedHint]);

  // опрос + мгновенная проверка, когда вернулись из банка/окна оплаты
  useEffect(() => {
    stopped.current = false;
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    const onBack = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [poll]);

  const finish = useCallback(() => {
    if (returnTo && returnTo.startsWith("/")) navigate(returnTo, { replace: true });
    else navigate("/subscription", { replace: true });
    onDone?.();
  }, [navigate, returnTo, onDone]);

  const toHome = useCallback(() => {
    navigate("/", { replace: true });
    onDone?.();
  }, [navigate, onDone]);

  // пометить просмотренным, чтобы при следующем запуске не показывать тот же итог
  useEffect(() => {
    if (phase === "paid" || (phase === "failed" && stopped.current)) void markPaymentSeen(payment.paymentId);
  }, [phase, payment.paymentId]);

  const setupNext = !!returnTo && returnTo.includes("setup=1");

  // ссылка на бота для сообщения с подарком
  const [botLink, setBotLink] = useState("");
  useEffect(() => {
    if (purpose !== "gift" || phase !== "paid") return;
    appFetch<{ bot_link?: string }>("/gifts").then((r) => setBotLink(r.bot_link || "")).catch(() => { /* без ссылки */ });
  }, [purpose, phase]);
  const sendGift = () => {
    if (!giftCode) return;
    const text = `Дарю тебе подписку ${BRAND_NAME}! Открой бота → «Подарки» и введи код ${giftCode}`;
    openTgLink(`https://t.me/share/url?url=${encodeURIComponent(botLink || giftCode)}&text=${encodeURIComponent(text)}`);
  };

  const reopen = async () => {
    if (invoiceLink) {
      const status = await openStarsInvoice(invoiceLink);
      if (status === "paid") void poll();
    } else if (payUrl) {
      openPayUrl(payUrl);
    }
  };

  const toSupport = () => {
    onClose();
    navigate("/support");
  };

  // системная «назад» Telegram: до оплаты — закрыть, после — на главную
  useTgBack(phase === "paid" ? (purpose === "gift" ? finish : toHome) : onClose);

  // ── тексты ──
  const isStars = method === "tg_stars" || info?.currency === "XTR";
  const months = info?.months || 0;
  const subtitle =
    purpose === "devices"
      ? `Доп. устройства${months ? ` · ${periodLabel(months)}` : ""}`
      : purpose === "traffic_reset"
        ? "Сброс трафика"
        : months
          ? periodLabel(months)
          : "";
  // сумма: стоимость покупки (вместе со списанным с баланса)
  const paidRub = info?.amount != null ? info.amount : null;
  const amountText = !info
    ? "…"
    : isStars
      ? `${Math.round(info.stars ?? info.amount ?? 0)} ⭐`
      : paidRub != null
        ? fmt(paidRub + info.refApplied)
        : "…";

  const details: string[] = [];
  if (phase === "paid") {
    if (purpose === "gift") {
      details.push("Отправьте код другу — он введёт его");
      details.push("в разделе «Подарки» и получит подписку");
    } else if (purpose === "devices") {
      if (info?.extraDevices) details.push(`+${info.extraDevices} ${deviceWord(info.extraDevices)}`);
      details.push("Устройства добавлены в подписку");
    } else if (purpose === "traffic_reset") {
      details.push("Трафик сброшен");
    } else {
      if (info?.days) details.push(`+${info.days} ${plural(info.days, "день", "дня", "дней")}`);
      if (info?.whitelist) details.push("Белые списки включены");
      if (setupNext) details.push("Осталось добавить подписку в приложение");
    }
    if (info && !isStars && info.refApplied > 0 && paidRub != null) {
      details.push(`С баланса ${fmt(info.refApplied)}`);
      details.push(`К оплате ${fmt(paidRub)}`);
    }
  } else if (phase === "pending") {
    details.push(method === "tg_stars" ? "Подтвердите платёж в окне Telegram" : `Завершите оплату в окне ${WINDOW_NAME[method] || "оплаты"}`);
    details.push("Статус обновится автоматически");
  } else if (phase === "failed") {
    details.push("Оплата не прошла");
    details.push("Если деньги списались — вернутся за 3 дня");
  } else {
    details.push("Не удалось найти платёж");
    details.push("Попробуйте оплатить ещё раз");
  }

  const title =
    phase === "paid"
      ? purpose === "gift" ? "Подарок готов" : "Оплачено"
      : phase === "pending"
        ? "Ожидаем оплату"
        : phase === "failed"
          ? "Платёж отменён"
          : "Платёж не найден";

  let primary: { label: string; onClick: () => void; disabled?: boolean };
  let secondary: { label: string; onClick: () => void; disabled?: boolean };
  if (phase === "paid" && purpose === "gift") {
    primary = { label: "Отправить другу", onClick: sendGift, disabled: !giftCode };
    secondary = {
      label: copied ? "Скопировано" : "Скопировать код",
      onClick: () => { if (giftCode) void copyText(giftCode).then((ok) => ok && setCopied(true)); },
      disabled: !giftCode,
    };
  } else if (phase === "paid") {
    primary = { label: "На главную", onClick: toHome };
    secondary = { label: setupNext ? "Продолжить настройку" : "К подписке", onClick: finish };
  } else if (phase === "pending") {
    primary = { label: "Перейти к оплате", onClick: () => void reopen(), disabled: !payUrl && !invoiceLink };
    secondary = { label: "Поддержка", onClick: toSupport };
  } else {
    primary = { label: "Попробовать снова", onClick: onRetry || onClose };
    secondary = { label: "Поддержка", onClick: toSupport };
  }

  const mark = phase === "paid" ? (purpose === "gift" ? "gift" : "check") : phase === "pending" ? "wait" : "cross";

  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 60, animation: "fgnFade 0.25s ease both" }}>
      <style>{"@keyframes fgnSpin { to { transform: rotate(360deg); } }"}</style>
      <FgnPage top={56}>
        <div key={phase} className="fgn-anim" style={{ display: "flex", flexDirection: "column", animation: "fgnFade 0.3s ease both" }}>
          <Mark kind={mark} />
          <div style={{ marginTop: 19, fontSize: 30, fontWeight: 600, lineHeight: "36px", letterSpacing: "-0.02em" }}>{title}</div>
          {subtitle ? <div style={{ marginTop: 7, fontSize: 16, lineHeight: "20px", color: C.muted }}>{subtitle}</div> : null}
          <div style={{ marginTop: subtitle ? 16 : 18, fontSize: 36, fontWeight: 600, lineHeight: "44px", letterSpacing: "-0.01em" }}>{amountText}</div>

          <div
            style={{
              marginTop: 18,
              padding: "16px 17px 12px",
              borderRadius: 16,
              border: `1px solid ${CARD_BORDER}`,
              background: C.cardBg,
              boxSizing: "border-box",
            }}
          >
            {phase === "paid" && purpose === "gift" ? (
              <div style={{ fontSize: 24, fontWeight: 600, lineHeight: "36px", letterSpacing: "0.06em", marginBottom: 4, userSelect: "all", WebkitUserSelect: "all" }}>
                {giftCode || "…"}
              </div>
            ) : null}
            {details.map((t) => (
              <div key={t} style={{ fontSize: 14, lineHeight: "28px", color: C.muted }}>{t}</div>
            ))}
          </div>

          <button
            type="button"
            className="blin-press"
            disabled={primary.disabled}
            onClick={primary.onClick}
            style={{ ...fgnButton, marginTop: 24, borderRadius: 16, fontSize: 16, color: "#101012", opacity: primary.disabled ? 0.5 : 1 }}
          >
            {primary.label}
          </button>
          <button
            type="button"
            className="blin-press"
            disabled={secondary.disabled}
            onClick={secondary.onClick}
            style={{
              ...fgnButton,
              marginTop: 8,
              height: 54,
              borderRadius: 16,
              fontSize: 16,
              background: C.cardBg,
              border: `1px solid ${CARD_BORDER}`,
              color: C.text,
              boxSizing: "border-box",
              opacity: secondary.disabled ? 0.5 : 1,
            }}
          >
            {secondary.label}
          </button>
        </div>
      </FgnPage>
    </div>
  );
}

/** круг 64 со значком: галочка / крестик / подарок / ожидание */
function Mark({ kind }: { kind: "check" | "cross" | "gift" | "wait" }) {
  const ink = "#161617";
  return (
    <div
      style={{
        width: 64,
        height: 64,
        borderRadius: "50%",
        background: "#F3F3F4",
        color: ink,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {kind === "check" ? (
        <svg width="24" height="18" viewBox="0 0 24 18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block", marginTop: 2 }}>
          <path d="M1.6 9.8 10.6 16.4 22.4 1.6" />
        </svg>
      ) : kind === "cross" ? (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden style={{ display: "block" }}>
          <path d="M2 2 18 18M18 2 2 18" />
        </svg>
      ) : kind === "gift" ? (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block" }}>
          <rect x="3" y="8" width="18" height="4" rx="1" />
          <path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
          <path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
        </svg>
      ) : (
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden className="fgn-anim" style={{ display: "block", animation: "fgnSpin 0.9s linear infinite" }}>
          <path d="M13 2.5A10.5 10.5 0 1 1 2.5 13" />
        </svg>
      )}
    </div>
  );
}
