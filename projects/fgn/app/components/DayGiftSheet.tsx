// FGN: лист «Подарок дня» (переопределение src/app/components/DayGiftSheet.tsx).
// Логика та же (claimDayGift, очередь подарков на старте), дизайн — FgnSheet: текст 15/21,
// светлая кнопка 52, тёмная с рамкой 54.
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FgnSheet, fgnButton } from "./fgn";
import { claimDayGift, fetchDayGifts, type DayGift } from "../utils/api";
import { hasFeature } from "../utils/brand";
import { formatDateRu } from "../utils/date";

const TEXT = "#F4F4F5";
const MUTED = "#9B9BA4";
const DANGER = "#FF5D62";
const CARD_BORDER = "#2A2A30";

// подарочные дни: «Вы получили 3 дня к подписке, чтобы получить нажмите кнопку «Забрать»»
// (промокод на дни, подарок вернувшимся) — фишки проекта promo_days / winback_gift
export const dayGiftsEnabled = (): boolean => hasFeature("promo_days") || hasFeature("winback_gift");

export function DayGiftSheet({ gift, onClose, onClaimed }: { gift: DayGift; onClose: () => void; onClaimed?: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ message: string; until?: string | null } | null>(null);

  const claim = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await claimDayGift(gift.id);
      try {
        (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: { notificationOccurred?: (s: string) => void } } } })
          .Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
      } catch { /* ignore */ }
      setDone({ message: r.message, until: r.expires_at });
      onClaimed?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось получить подарок");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FgnSheet title={done ? "Подарок получен" : "Подарок"} onClose={onClose}>
      <div style={{ marginTop: 19, fontSize: 15, lineHeight: "21px", color: TEXT }}>
        {done ? done.message : gift.text}
      </div>
      {done?.until ? (
        <div style={{ marginTop: 6, fontSize: 14.5, lineHeight: "20px", color: MUTED }}>
          Подписка действует до {formatDateRu(done.until)}
        </div>
      ) : null}
      {err ? <div style={{ marginTop: 10, fontSize: 14, lineHeight: "20px", color: DANGER }}>{err}</div> : null}
      {done ? (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            type="button"
            className="blin-press"
            onClick={() => { onClose(); navigate("/subscription"); }}
            style={{ ...fgnButton, height: 52, borderRadius: 16, fontSize: 16 }}
          >
            Моя подписка
          </button>
          <button
            type="button"
            className="blin-press"
            onClick={onClose}
            style={{
              ...fgnButton,
              height: 54,
              borderRadius: 16,
              background: "transparent",
              border: `1px solid ${CARD_BORDER}`,
              color: TEXT,
              fontSize: 16,
              boxSizing: "border-box",
            }}
          >
            Закрыть
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="blin-press"
          disabled={busy}
          onClick={() => void claim()}
          style={{ ...fgnButton, marginTop: 18, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Начисляем…" : "Забрать"}
        </button>
      )}
    </FgnSheet>
  );
}

/** на старте: если есть подарочные дни, ждущие «Забрать», — показать по одному */
export default function DayGiftPrompt() {
  const [queue, setQueue] = useState<DayGift[]>([]);
  useEffect(() => {
    if (!dayGiftsEnabled()) return;
    let alive = true;
    void fetchDayGifts().then((items) => { if (alive) setQueue(items); });
    return () => { alive = false; };
  }, []);
  const gift = queue[0];
  if (!gift) return null;
  return <DayGiftSheet key={gift.id} gift={gift} onClose={() => setQueue((q) => q.slice(1))} />;
}