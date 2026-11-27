import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MSIcon, btnReset } from "./ui";
import { N, NoirBack, NoirButton, VideoBackdrop } from "./noir";
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
      <VideoBackdrop dim={0.42} />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 520,
          display: "flex",
          flexDirection: "column",
          padding: "0 20px",
          paddingTop: "calc(20px + var(--blin-tg-pad-top, 0px) / var(--blin-scale))",
          paddingBottom: "calc(24px + var(--blin-tg-pad-bottom, 0px) / var(--blin-scale))",
          boxSizing: "border-box",
        }}
      >
        <div style={{ height: 44 }}>{canClose || purpose === "gift" ? <NoirBack onClick={purpose === "gift" && phase === "paid" ? finish : onClose} /> : null}</div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", paddingBottom: 40 }}>
          {phase === "pending" ? (
            <>
              <PulseDot />
              <Title>Ожидаем оплату</Title>
              <Text>
                {method === "tg_stars"
                  ? "Подтвердите платёж в открывшемся окне Telegram"
                  : `Завершите оплату в открывшемся окне ${windowName}`}
              </Text>
            </>
          ) : phase === "paid" ? (
            <>
              <Mark icon={purpose === "gift" ? "redeem" : "check"} color="#3DD68C" />
              <Title>{purpose === "gift" ? "Подарок готов" : "Оплата прошла"}</Title>
              <Text>
                {purpose === "gift"
                  ? "Отправьте код другу — он введёт его в разделе «Подарки» и получит подписку."
                  : PAID_TEXT[purpose] || (setupNext ? "Подписка активирована. Осталось добавить её в приложение." : "Подписка активирована.")}
              </Text>
              {purpose === "gift" ? (
                <div style={{ marginTop: 22, padding: "14px 26px", borderRadius: 18, background: "rgba(16,16,22,0.85)", border: `1px solid ${N.cardBorder}`, fontSize: 24, fontWeight: 600, letterSpacing: "0.08em", userSelect: "all", WebkitUserSelect: "all" }}>
                  {giftCode || "…"}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <Mark icon="close" color={N.redText} />
              <Title>{phase === "failed" ? "Платёж отклонён" : "Платёж не найден"}</Title>
              <Text>
                {phase === "failed"
                  ? "Если деньги списались, они вернутся автоматически в течение 3 дней."
                  : "Не удалось найти платёж. Попробуйте оплатить ещё раз."}
              </Text>
            </>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          {phase === "pending" ? (
            <NoirButton primary disabled={!payUrl && !invoiceLink} onClick={() => void reopen()}>
              Перейти к оплате
            </NoirButton>
          ) : phase === "paid" && purpose === "gift" ? (
            <>
              <NoirButton primary icon="send" disabled={!giftCode} onClick={sendGift}>Отправить другу</NoirButton>
              <div style={{ height: 4 }} />
              <NoirButton icon={copied ? "check" : "content_copy"} disabled={!giftCode} onClick={() => { if (giftCode) void copyText(giftCode).then((ok) => ok && setCopied(true)); }}>
                {copied ? "Скопировано" : "Скопировать код"}
              </NoirButton>
            </>
          ) : phase === "paid" ? (
            <NoirButton primary onClick={finish}>{setupNext ? "Продолжить настройку" : "Перейти к подписке"}</NoirButton>
          ) : (
            <NoirButton primary onClick={onRetry || onClose}>Попробовать снова</NoirButton>
          )}
          {phase !== "paid" ? (
            <button
              type="button"
              onClick={toSupport}
              style={{ ...btnReset, fontFamily: N.font, background: "transparent", border: "none", padding: "16px 20px 6px", fontSize: 15.5, color: N.muted, cursor: "pointer" }}
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
    <div style={{ position: "relative", width: 18, height: 18, marginBottom: 54 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: N.red, animation: "blinvpnPayPing 1.6s cubic-bezier(0.22, 1, 0.36, 1) infinite" }} />
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: N.red, boxShadow: "0 0 18px rgba(224,0,0,0.75)" }} />
    </div>
  );
}

function Mark({ icon, color }: { icon: string; color: string }) {
  return (
    <div
      style={{
        width: 72,
        height: 72,
        borderRadius: "50%",
        border: `1.5px solid ${color}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 26,
        animation: "blinvpnRise 0.5s var(--ease-out) both",
      }}
    >
      <MSIcon name={icon} style={{ fontSize: 38, color, fontVariationSettings: "'wght' 300" }} />
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.15, color: N.text }}>{children}</div>
  );
}

function Text({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 12, fontSize: 15.5, color: N.muted, lineHeight: 1.5, maxWidth: 300 }}>{children}</div>;
}
