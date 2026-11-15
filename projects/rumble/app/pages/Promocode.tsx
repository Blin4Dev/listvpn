import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { redeemPromo, type DayGift } from "../utils/api";
import { DayGiftSheet } from "../components/DayGiftSheet";
import { formatDateRu } from "../utils/date";
import { N, NoirBack, NoirButton, NoirScreen } from "../components/noir";

// RUMBLE: 21 «Активировать подарок» — общий экран в стиле RUMBLE (компоненты noir → дизайн RUMBLE)

type Result = { kind: "gift"; until?: string } | { kind: "discount"; percent: number };

/** «Активировать подарок»: код подарка от друга (GIFT-…) или промокод на скидку */
export default function Promocode() {
  const goBack = useSmartBack("/");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState(() => (params.get("code") || "").toUpperCase());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  // промокод на дни: подарок ждёт кнопку «Забрать»
  const [dayGift, setDayGift] = useState<DayGift | null>(null);

  useEffect(() => { setErr(""); }, [code]);

  // двойное нажатие: state busy обновляется не сразу — второй запрос успевал уйти
  const inflight = useRef(false);
  const activate = async () => {
    const c = code.trim();
    if (!c || busy || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setErr("");
    try {
      const res = await redeemPromo(c);
      try {
        (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: { notificationOccurred?: (s: string) => void } } } })
          .Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
      } catch { /* ignore */ }
      if (res.type === "days" && res.gift_id) {
        setDayGift({ id: res.gift_id, days: Number(res.days || 0), source: "promo", text: res.message || "" });
        setCode("");
        return;
      }
      if (res.type === "gift") setResult({ kind: "gift", until: res.expires_at });
      else setResult({ kind: "discount", percent: Number(res.discount_percent ?? res.value ?? 0) });
      setCode("");
    } catch (e) {
      {
        const m = e instanceof Error ? e.message : "";
        setErr(!m || /не найден|not found|использ|invalid|неверн/i.test(m) ? "Такого кода нет или он уже использован" : m);
      }
    } finally {
      setBusy(false);
      inflight.current = false;
    }
  };

  const ready = !!code.trim() && !busy;

  return (
    <NoirScreen>
      <NoirBack onClick={goBack} />
      <div style={{ fontSize: 36, fontWeight: 800, lineHeight: "36px", letterSpacing: "-0.025em", paddingTop: 16, color: N.text, marginBottom: 20 }}>
        Активировать подарок
      </div>

      {result ? (
        <div style={{ animation: "blinvpnRise 0.5s var(--ease-out) both" }}>
          <div
            style={{
              background: N.card,
              border: `1px solid ${N.cardBorder}`,
              borderRadius: 24,
              padding: "20px 18px",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 600, color: N.text }}>
              {result.kind === "gift" ? "Подарок активирован" : `Скидка ${result.percent}% активирована`}
            </div>
            <div style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5, color: N.muted }}>
              {result.kind === "gift"
                ? `Подписка уже ваша${result.until ? ` — действует до ${formatDateRu(result.until)}` : ""}. Осталось добавить её в приложение.`
                : "Она применится к следующей оплате и действует 90 дней."}
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {result.kind === "gift" ? (
              <NoirButton primary onClick={() => navigate("/subscription?setup=1")}>Добавить в приложение</NoirButton>
            ) : (
              <NoirButton primary onClick={() => navigate("/tariffs")}>Выбрать тариф</NoirButton>
            )}
            <NoirButton onClick={() => setResult(null)}>Ввести другой код</NoirButton>
          </div>
        </div>
      ) : (
        <>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") void activate(); }}
            placeholder="Код подарка"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            style={{
              width: "100%",
              height: 56,
              boxSizing: "border-box",
              padding: "0 16px",
              borderRadius: 21.6,
              border: "none",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.1)",
              background: "rgba(0,0,0,0.5)",
              color: N.text,
              fontFamily: N.font,
              fontSize: 18,
              textAlign: "left",
              outline: "none",
            }}
          />
          {err ? <div style={{ marginTop: 8, fontSize: 14, lineHeight: "20px", color: "#E10600" }}>{err}</div> : null}
          <div style={{ marginTop: 12 }}>
            <NoirButton primary disabled={!ready} onClick={() => void activate()}>
              {busy ? "Проверяем…" : "Активировать"}
            </NoirButton>
          </div>
        </>
      )}
      {dayGift ? <DayGiftSheet gift={dayGift} onClose={() => setDayGift(null)} /> : null}
    </NoirScreen>
  );
}
