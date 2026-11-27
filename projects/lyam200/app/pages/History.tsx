import React, { useEffect, useState } from "react";
import { useSmartBack } from "../utils/navigation";
import { appFetch } from "../utils/api";
import { N, NoirBack, NoirCard, NoirScreen } from "../components/noir";

// ЛЯМ200: 25–26 «История» — общий экран в стиле ЛЯМ200 (компоненты noir → дизайн ЛЯМ200)

type HistoryItem = {
  id: number | string;
  title?: string;
  method?: string;
  amount?: number;
  stars?: number | null;
  direction?: "in" | "out";
  status?: string;
  payment_method?: string;
  description?: string | null;
  created_at?: string;
  purpose?: string | null;
  months?: number | null;
};

const GREEN = "#2FD39A";

function fmtAmount(v: number): string {
  return v.toLocaleString("ru-RU", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}

function periodTitle(m: number) {
  if (m === 12) return "1 год";
  return `${m} ${m === 1 ? "месяц" : m < 5 ? "месяца" : "месяцев"}`;
}

function formatWhen(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      ...(sameYear ? {} : { year: "numeric" }),
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function titleFor(item: HistoryItem): string {
  const m = Number(item.months || 0);
  if ((item.purpose === "subscription" || item.purpose === "extend") && m > 0) {
    return periodTitle(m);
  }
  if (item.purpose === "gift" && m > 0) return `Подарок, ${periodTitle(m)}`;
  if (item.title) return item.title;
  if (item.payment_method === "referral") return "Бонус за друга";
  if (item.description) return String(item.description);
  return `Операция №${item.id}`;
}

/** подпись под названием: дата и (если важно) пояснение */
function subFor(item: HistoryItem): string {
  const parts = [formatWhen(item.created_at)];
  if (item.status === "refunded") parts.push("деньги возвращены");
  else if (item.payment_method === "withdrawal" || item.payment_method === "referral_reversal") {
    if (item.method) parts.push(item.method);
  }
  return parts.join(" · ");
}

export default function History() {
  const goBack = useSmartBack("/");
  const [items, setItems] = useState<HistoryItem[] | null>(null);

  useEffect(() => {
    appFetch<{ items?: HistoryItem[] }>("/history")
      .then((d) => setItems(Array.isArray(d?.items) ? d.items : []))
      .catch(() => setItems([]));
  }, []);

  return (
    <NoirScreen dim={0.3}>
      <NoirBack onClick={goBack} />
      <div style={{ fontSize: 24, fontWeight: 600, lineHeight: "32px", paddingTop: 6, color: N.text }}>
        История платежей
      </div>

      {items === null ? (
        <div style={{ paddingTop: 32, fontSize: 16, color: N.muted, textAlign: "center" }}>Загрузка…</div>
      ) : items.length === 0 ? (
        <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: N.muted, animation: "blinvpnRise 0.5s var(--ease-out) both" }}>
          Платежей пока нет.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 16 }}>
          {items.map((item, i) => {
            const out = item.direction ? item.direction === "out" : Number(item.amount) < 0;
            const refunded = item.status === "refunded";
            const value = Math.abs(Number(item.amount || 0));
            const hasAmount = item.stars ? true : value !== 0;
            return (
              <NoirCard key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, animation: `blinvpnRise 0.5s var(--ease-out) ${Math.min(i, 12) * 0.04}s both` }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, lineHeight: "20px", color: refunded ? N.muted : N.text }}>{titleFor(item)}</div>
                  <div style={{ paddingTop: 4, fontSize: 14, lineHeight: "20px", color: N.muted, fontVariantNumeric: "tabular-nums" }}>{subFor(item)}</div>
                </div>
                {hasAmount ? (
                  <div style={{ fontSize: 14, lineHeight: "20px", color: refunded ? N.dim : out ? N.text : GREEN, textDecoration: refunded ? "line-through" : "none", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                    {item.stars ? `${out ? "" : "+"}${item.stars} ⭐` : `${out ? "" : "+"}${fmtAmount(value)} ₽`}
                  </div>
                ) : null}
              </NoirCard>
            );
          })}
        </div>
      )}
    </NoirScreen>
  );
}
