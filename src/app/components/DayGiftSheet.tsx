import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { N, NoirButton, NoirSheet } from "./noir";
import { claimDayGift, fetchDayGifts, type DayGift } from "../utils/api";
import { hasFeature } from "../utils/brand";
import { formatDateRu } from "../utils/date";

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
    <NoirSheet title={done ? "Подарок получен" : "Подарок 🎁"} onClose={onClose}>
      <div style={{ fontSize: 16, lineHeight: 1.5, color: N.text }}>
        {done ? done.message : gift.text}
      </div>
      {done?.until ? (
        <div style={{ marginTop: 6, fontSize: 14.5, color: N.muted }}>Подписка действует до {formatDateRu(done.until)}</div>
      ) : null}
      {err ? <div style={{ marginTop: 10, fontSize: 14, color: "#FF6B6B" }}>{err}</div> : null}
      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        {done ? (
          <>
            <NoirButton primary onClick={() => { onClose(); navigate("/subscription"); }}>Моя подписка</NoirButton>
            <NoirButton onClick={onClose}>Закрыть</NoirButton>
          </>
        ) : (
          <NoirButton green disabled={busy} onClick={() => void claim()}>{busy ? "Начисляем…" : "Забрать"}</NoirButton>
        )}
      </div>
    </NoirSheet>
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
