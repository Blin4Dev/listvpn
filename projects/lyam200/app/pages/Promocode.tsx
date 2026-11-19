import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { redeemPromo, type DayGift } from "../utils/api";
import { DayGiftSheet } from "../components/DayGiftSheet";
import { formatDateRu } from "../utils/date";
import { N, NoirBack, NoirButton, NoirScreen } from "../components/noir";
import { O, OButton } from "../components/lyam";

// ЛЯМ200: 21 «Активировать подарок» — общий экран в стиле ЛЯМ200 (компоненты noir → дизайн ЛЯМ200)

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
        setErr(/использ|used|redeemed|активирован/i.test(m) ? "Этот код уже использован." : !m || /не найден|not found|invalid|неверн/i.test(m) ? "Такого кода нет." : m);
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
      <div style={{ fontSize: 24, fontWeight: 600, lineHeight: "32px", paddingTop: 6, color: N.text, marginBottom: 16 }}>
        Активировать подарок
      </div>

      <input
        value={code}
        onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/\s+/g, "")); setErr(""); }}
        onKeyDown={(e) => { if (e.key === "Enter") void activate(); }}
        placeholder="Код подарка"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="lyam-input"
        style={{
          width: "100%", height: 48, boxSizing: "border-box", padding: "0 16px", borderRadius: 16, border: "none",
          background: O.card, color: N.text, fontFamily: N.font, fontSize: 16, textAlign: "center", outline: "none",
        }}
      />
      <div style={{ marginTop: 8 }}>
        <OButton tone="red" onClick={() => { if (ready) void activate(); }}>{busy ? "Проверяем…" : "Активировать"}</OButton>
      </div>
      {err ? <div style={{ marginTop: 12, fontSize: 14, lineHeight: "20px", color: O.muted }}>{err}</div> : null}
      {result ? (
        <div style={{ marginTop: 12, fontSize: 14, lineHeight: "20px", color: O.muted, animation: "blinvpnFadeIn 0.3s ease both" }}>
          {result.kind === "gift"
            ? `Подарок активирован.${result.until ? ` Подписка действует до ${formatDateRu(result.until)}.` : ""}`
            : `Скидка ${result.percent}% активирована — применится к следующей оплате.`}
          {result.kind === "gift" ? " Осталось добавить подписку в приложение." : ""}
          <div style={{ marginTop: 12 }}>
            {result.kind === "gift" ? (
              <OButton tone="red" icon="download" onClick={() => navigate("/subscription?setup=1")}>Добавить в приложение</OButton>
            ) : (
              <OButton tone="dark" onClick={() => navigate("/tariffs")}>Выбрать тариф</OButton>
            )}
          </div>
        </div>
      ) : null}
      {dayGift ? <DayGiftSheet gift={dayGift} onClose={() => setDayGift(null)} /> : null}
    </NoirScreen>
  );
}
