import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { btnReset } from "./ui";
import { N, NoirButton, VideoBackdrop } from "./noir";
import { O, OBack, OCard, OIcon } from "./ovpn";

// O-VPN: 09 «Ожидаем оплату», 11 «Спасибо за покупку», 12 «Спасибо · код подарка»
import { appFetch, fetchPaymentStatus, markPaymentSeen, openPayUrl, openStarsInvoice, openTgLink } from "../utils/api";
import { copyText } from "./SubLinkBox";
import { BRAND_NAME } from "../utils/brand";

type Phase = "pending" | "paid" | "failed" | "error";

export type PendingPayment = {
  paymentId: string;
  provider: string;
  payUrl?: string;
  invoiceLink?: string;
  // тип: subscription | devices | traffic_reset
  purpose?: string;
  // способ оплаты: sbp | card | international | tg_stars | crypto
  method?: string;
};

const PAID_TEXT: Record<string, string> = {
  devices: "Устройства добавлены в подписку.",
  traffic_reset: "Трафик сброшен.",
};

// «в открывшемся окне …»
const WINDOW_NAME: Record<string, string> = {
  sbp: "СБП",
  card: "оплаты картой",
  sberpay: "SberPay",
  tg_stars: "Telegram",
};

const POLL_MS = 2000;

/** полноэкранное «Ожидаем оплату»; опрашивает статус до оплаты/отказа */
export default function PaymentSheet({
  payment,
  returnTo,
  onClose,
  autoAdvance = true,
  onDone,
  failedHint = false,
  onRetry,
}: {
  payment: PendingPayment;
  returnTo?: string;
  onClose: () => void;
  // уйти дальше после оплаты (false = ждать кнопку)
  autoAdvance?: boolean;
  // вызывается после перехода дальше
  onDone?: () => void;
  // пришли по url неуспешной оплаты
  failedHint?: boolean;
  // «попробовать снова» (default: just close)
  onRetry?: () => void;
}) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("pending");
  const [payUrl, setPayUrl] = useState(payment.payUrl || "");
  const [invoiceLink, setInvoiceLink] = useState(payment.invoiceLink || "");
  const [purpose, setPurpose] = useState(payment.purpose || "subscription");
  // подарок: код приходит после оплаты
  const [giftCode, setGiftCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [method, setMethod] = useState(payment.method || (payment.provider === "tg_stars" ? "tg_stars" : ""));
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

  // пометить просмотренным, чтобы при следующем запуске не показывать тот же итог
  useEffect(() => {
    if (phase === "paid" || (phase === "failed" && stopped.current)) void markPaymentSeen(payment.paymentId);
  }, [phase, payment.paymentId]);

  const setupNext = !!returnTo && returnTo.includes("setup=1");

  // после оплаты уходим сами
  useEffect(() => {
    // подарок: остаёмся на экране, чтобы отправить код
    if (phase !== "paid" || !autoAdvance || purpose === "gift") return;
    const t = window.setTimeout(finish, 1800);
    return () => window.clearTimeout(t);
  }, [phase, finish, autoAdvance, purpose]);

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

  const canClose = phase !== "paid";
  const windowName = WINDOW_NAME[method] || "оплаты";

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: N.bg,
        fontFamily: N.font,
        color: N.text,
        animation: "blinvpnFadeIn 0.25s ease both",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <VideoBackdrop dim={0.55} />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 520,
          display: "flex",
          flexDirection: "column",
          padding: "0 16px",
          paddingTop: "calc(16px + var(--blin-tg-pad-top, 0px) / var(--blin-scale))",
          overflowY: "auto",
          paddingBottom: "calc(24px + var(--blin-tg-pad-bottom, 0px) / var(--blin-scale))",
          boxSizing: "border-box",
        }}
      >
        <div style={{ height: 20 }}>{canClose || purpose === "gift" ? <OBack onClick={purpose === "gift" && phase === "paid" ? finish : onClose} /> : null}</div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", paddingTop: 12 }}>
          {phase === "pending" ? (
            <>
              <PulseDot />
              <Title>Ожидаем оплату</Title>
              <Text>
                {method === "tg_stars" ? "Подтвердите платёж в открывшемся окне Telegram." : "Подтвердите платёж в открывшемся окне."}
              </Text>
            </>
          ) : phase === "paid" ? (
            <>
              <Mark icon="check" color={O.green} />
              <div style={{ paddingTop: 20, maxWidth: 300, fontSize: 36, fontWeight: 800, lineHeight: "40px", color: O.text }}>Спасибо за покупку</div>
              {PAID_TEXT[purpose] ? <Text>{PAID_TEXT[purpose]}</Text> : null}
              {purpose === "gift" ? (
                <OCard style={{ marginTop: 20, width: "100%", textAlign: "center" }}>
                  <div style={{ fontSize: 14, lineHeight: "20px", color: O.muted }}>Код подарка</div>
                  <div style={{ paddingTop: 4, fontSize: 24, fontWeight: 800, lineHeight: "32px", letterSpacing: "1.2px", userSelect: "all", WebkitUserSelect: "all" }}>{giftCode || "…"}</div>
                  <div style={{ paddingTop: 16 }}>
                    <NoirButton primary icon={copied ? "check" : "content_copy"} disabled={!giftCode} onClick={() => { if (giftCode) void copyText(giftCode).then((ok) => ok && setCopied(true)); }}>
                      {copied ? "Скопировано" : "Скопировать код"}
                    </NoirButton>
                  </div>
                </OCard>
              ) : null}
            </>
          ) : (
            <>
              <><Mark icon="close" color={O.red} /><div style={{ height: 20 }} /></>
              <Title>{phase === "failed" ? "Платёж отклонён" : "Платёж не найден"}</Title>
              <Text>
                {phase === "failed"
                  ? "Если деньги списались, они вернутся автоматически в течение 3 дней."
                  : "Не удалось найти платёж. Попробуйте оплатить ещё раз."}
              </Text>
            </>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: phase === "pending" ? 32 : 24 }}>
          {phase === "pending" ? (
            <NoirButton primary disabled={!payUrl && !invoiceLink} onClick={() => void reopen()}>
              Перейти к оплате
            </NoirButton>
          ) : phase === "paid" && purpose === "gift" ? (
            <NoirButton onClick={() => { navigate("/"); onClose(); }}>На главную</NoirButton>
          ) : phase === "paid" ? (
            setupNext
              ? <NoirButton primary onClick={finish}>Продолжить настройку</NoirButton>
              : <NoirButton onClick={() => { navigate("/"); onClose(); }}>На главную</NoirButton>
          ) : (
            <NoirButton primary onClick={onRetry || onClose}>Попробовать снова</NoirButton>
          )}
          {phase !== "paid" ? (
            <button
              type="button"
              onClick={toSupport}
              style={{ ...btnReset, fontFamily: O.font, background: "transparent", border: "none", padding: "16px 20px 0", fontSize: 14, fontWeight: 600, lineHeight: "20px", color: O.muted, cursor: "pointer" }}
            >
              Поддержка
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PulseDot() {
  return (
    <div style={{ position: "relative", width: 16, height: 16, marginBottom: 24 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: O.red, animation: "blinvpnPayPing 1.6s cubic-bezier(0.22, 1, 0.36, 1) infinite" }} />
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: O.red, boxShadow: "0 0 16px rgba(227,27,35,0.7)" }} />
    </div>
  );
}

function Mark({ icon, color }: { icon: string; color: string }) {
  return (
    <div style={{ width: 80, height: 80, borderRadius: "50%", background: color === O.green ? "rgba(47,190,74,0.14)" : "rgba(227,27,35,0.14)", border: `1px solid ${color}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", color, animation: "blinvpnRise 0.5s var(--ease-out) both" }}>
      <OIcon name={icon === "close" ? "x" : icon} size={40} />
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 304, fontSize: 36, fontWeight: 800, lineHeight: "40px", color: O.text }}>{children}</div>;
}

function Text({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 12, fontSize: 16, color: O.muted, lineHeight: "24px", maxWidth: 323 }}>{children}</div>;
}
