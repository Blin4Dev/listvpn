// FGN: «Промокод» / «Активировать подарок» (переопределение src/app/pages/Promocode.tsx; маршруты /promocode и /gift/activate).
// Макет: шапка «назад» + «Промокод», подпись, поле-пилюля, кнопка «Активировать» (тёмная, пока поле пустое),
// под кнопкой — строка результата («Начислено 30 дней»). Промокод на дни зачисляется сразу (без листа «Забрать»).
import React, { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { claimDayGift, redeemPromo } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { C, FgnHeader, FgnPage, fgnPillButton, fgnPillInput } from "../components/fgn";

function daysWord(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return "дней";
  if (b === 1) return "день";
  if (b >= 2 && b <= 4) return "дня";
  return "дней";
}

function haptic(kind: "success" | "error") {
  try {
    (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: { notificationOccurred?: (s: string) => void } } } })
      .Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(kind);
  } catch { /* ignore */ }
}

export default function Promocode() {
  const goBack = useSmartBack("/");
  const [params] = useSearchParams();
  // /gift/activate — «Активировать подарок»: другой заголовок и подсказка, без подписи
  const isGift = useLocation().pathname.startsWith("/gift");
  const [code, setCode] = useState(() => (params.get("code") || "").toUpperCase());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const activate = async () => {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await redeemPromo(c);
      let text: string;
      if (res.type === "days") {
        let days = Number(res.days || 0);
        if (res.gift_id) {
          const claimed = await claimDayGift(res.gift_id);
          days = Number(claimed.days || days);
        }
        text = `Начислено ${days} ${daysWord(days)}`;
      } else if (res.type === "gift") {
        text = res.expires_at ? `Подписка активирована до ${formatDateRu(res.expires_at)}` : "Подписка активирована";
      } else {
        const p = Number(res.discount_percent ?? res.value ?? 0);
        text = `Скидка ${p}% применится к следующей оплате`;
      }
      haptic("success");
      setMsg({ ok: true, text });
    } catch (e) {
      haptic("error");
      setMsg({ ok: false, text: e instanceof Error && e.message ? e.message : "Не удалось активировать" });
    } finally {
      setBusy(false);
    }
  };

  const ready = !!code.trim() && !busy;

  return (
    <FgnPage>
      <FgnHeader title={isGift ? "Активировать подарок" : "Промокод"} onBack={goBack} />

      {isGift ? null : (
        <div style={{ marginTop: 23.5, fontSize: 14, lineHeight: "17px", color: "rgba(196, 196, 206, 0.62)" }}>
          Промокод на дни к подписке
        </div>
      )}

      <input
        value={code}
        onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/\s+/g, "")); setMsg(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") void activate(); }}
        placeholder={isGift ? "Код подарка" : "Промокод"}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="fgn-promo-input"
        style={{
          ...fgnPillInput,
          marginTop: isGift ? 20 : 19,
          borderColor: msg && !msg.ok ? "rgba(255, 75, 75, 0.55)" : C.cardBorder,
        }}
      />
      <style>{`.fgn-promo-input::placeholder{color:rgba(196,196,206,0.55);opacity:1}`}</style>

      <button
        type="button"
        className={ready ? "blin-press" : undefined}
        disabled={!ready}
        onClick={() => void activate()}
        style={{ ...fgnPillButton(!!code.trim()), marginTop: 12.5 }}
      >
        {busy ? "Проверяем…" : "Активировать"}
      </button>

      {msg ? (
        <div
          style={{
            marginTop: 19.5,
            fontSize: 15,
            lineHeight: "18px",
            color: msg.ok ? C.text : C.danger,
            animation: "fgnFade 0.25s ease both",
          }}
        >
          {msg.text}
        </div>
      ) : null}
    </FgnPage>
  );
}
