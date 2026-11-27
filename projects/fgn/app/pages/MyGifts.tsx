// FGN: «Мои подарки» (переопределение src/app/pages/MyGifts.tsx).
// Макет: шапка + карточки подарков (срок, «N дней», код справа). Тап по карточке — копировать код.
import React, { useEffect, useState } from "react";
import { useSmartBack } from "../utils/navigation";
import { appFetch } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { copyText } from "../components/SubLinkBox";
import { C, FgnCard, FgnHeader, FgnPage } from "../components/fgn";

type Gift = { code: string; kind: string; status: string; months: number; days?: number; created_at: string; redeemed_at?: string | null };

function periodTitle(m: number) {
  if (m === 12) return "1 год";
  return `${m} ${m === 1 ? "месяц" : m < 5 ? "месяца" : "месяцев"}`;
}

function daysWord(n: number) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return "день";
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return "дня";
  return "дней";
}

const DAYS: Record<number, number> = { 1: 30, 3: 90, 6: 180, 12: 365 };

export default function MyGifts() {
  const goBack = useSmartBack("/");
  const [items, setItems] = useState<Gift[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    appFetch<{ items?: Gift[] }>("/gifts").then((r) => setItems(r.items || [])).catch(() => setItems([]));
  }, []);

  const copy = async (code: string) => {
    if (await copyText(code)) {
      setCopied(code);
      window.setTimeout(() => setCopied((c) => (c === code ? null : c)), 1600);
    }
  };

  return (
    <FgnPage>
      <FgnHeader title="Мои подарки" onBack={goBack} />
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        {items === null ? null : items.length === 0 ? (
          <div style={{ marginTop: 4, fontSize: 15, lineHeight: "20px", color: C.muted, animation: "fgnFade 0.3s ease both" }}>
            Подарков пока нет
          </div>
        ) : (
          items.map((g, i) => {
            const used = g.status === "redeemed";
            const m = Number(g.months || 1);
            const days = Number(g.days || DAYS[m] || m * 30);
            return (
              <FgnCard
                key={g.code}
                dim={used}
                onClick={used ? undefined : () => void copy(g.code)}
                style={{ animation: `fgnFade 0.35s ease ${0.04 * i}s both` }}
                title={periodTitle(m)}
                subtitle={used ? `Активирован${g.redeemed_at ? ` ${formatDateRu(g.redeemed_at)}` : ""}` : `${days} ${daysWord(days)}`}
                right={
                  <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 500, letterSpacing: "0.005em", userSelect: "all", WebkitUserSelect: "all" }}>
                    {copied === g.code ? "Скопировано" : g.code}
                  </span>
                }
              />
            );
          })
        )}
      </div>
    </FgnPage>
  );
}
