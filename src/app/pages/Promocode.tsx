import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { N, NoirBack, NoirButton, NoirScreen } from "../components/noir";

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

  useEffect(() => { setErr(""); }, [code]);

  const activate = async () => {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await appFetch<{ type?: string; value?: number; discount_percent?: number; expires_at?: string }>(
        "/promocode/redeem",
        { method: "POST", body: JSON.stringify({ code: c }) },
      );
      try {
        (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: { notificationOccurred?: (s: string) => void } } } })
          .Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
      } catch { /* ignore */ }
      if (res.type === "gift") setResult({ kind: "gift", until: res.expires_at });
      else setResult({ kind: "discount", percent: Number(res.discount_percent ?? res.value ?? 0) });
      setCode("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось активировать");
    } finally {
      setBusy(false);
    }
  };

  const ready = !!code.trim() && !busy;

  return (
    <NoirScreen>
      <div style={{ paddingTop: 20, marginBottom: 22 }}>
        <NoirBack onClick={goBack} />
      </div>
      <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.15, color: N.text, marginBottom: 20 }}>
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
            <div style={{ fontSize: 20, fontWeight: 500, color: N.text }}>
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
              height: 58,
              boxSizing: "border-box",
              padding: "0 18px",
              borderRadius: 22,
              border: `1px solid ${err ? "rgba(255,80,80,0.6)" : N.cardBorder}`,
              background: N.card,
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              color: N.text,
              fontFamily: N.font,
              fontSize: 17,
              letterSpacing: code ? "0.06em" : 0,
              textAlign: "center",
              outline: "none",
            }}
          />
          {err ? <div style={{ marginTop: 10, fontSize: 14, color: "#FF6B6B", textAlign: "center" }}>{err}</div> : null}
          <div style={{ marginTop: 12 }}>
            <NoirButton primary disabled={!ready} onClick={() => void activate()}>
              {busy ? "Проверяем…" : "Активировать"}
            </NoirButton>
          </div>
        </>
      )}
    </NoirScreen>
  );
}
