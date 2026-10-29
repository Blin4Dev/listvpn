// FGN: «История платежей» (макет 70; переопределение src/app/pages/History.tsx).
// Шапка FGN, под ней карточки операций 86 (радиус 16, зазор 10): слева период 14.5 серым, справа сумма белым,
// второй строкой дата «22 октября 2026 г.».
import React, { useEffect, useState } from "react";
import { useSmartBack } from "../utils/navigation";
import { appFetch } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { C, FgnHeader, FgnPage } from "../components/fgn";

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

const MUTED = "#A9A9B1";
const CARD_BG = "#141416";
const CARD_BORDER = "#2A2A30";
const TEXT = "#F4F4F5";

// 690 → «690», 1290 → «1 290» (неразрывный пробел)
function fmtAmount(v: number): string {
  const [int, frac] = (Number.isInteger(v) ? String(v) : v.toFixed(2)).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac ? `${grouped},${frac}` : grouped;
}

function periodTitle(m: number) {
  if (m === 12) return "1 год";
  return `${m} ${m === 1 ? "месяц" : m < 5 ? "месяца" : "месяцев"}`;
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

function dateFor(item: HistoryItem): string {
  const d = formatDateRu(item.created_at);
  const parts = [d ? `${d} г.` : "—"];
  if (item.status === "refunded") parts.push("деньги возвращены");
  else if ((item.payment_method === "withdrawal" || item.payment_method === "referral_reversal") && item.method) parts.push(item.method);
  return parts.join(" · ");
}

export default function History() {
  const goBack = useSmartBack("/settings");
  const [items, setItems] = useState<HistoryItem[] | null>(null);

  useEffect(() => {
    appFetch<{ items?: HistoryItem[] }>("/history")
      .then((d) => setItems(Array.isArray(d?.items) ? d.items : []))
      .catch(() => setItems([]));
  }, []);

  return (
    <FgnPage>
      <FgnHeader title="История платежей" onBack={goBack} btnStyle={{ background: CARD_BG, borderColor: CARD_BORDER }} />

      {items !== null && items.length === 0 ? (
        <div style={{ marginTop: 20, flexShrink: 0, fontSize: 14.5, lineHeight: "20px", color: MUTED, animation: "fgnFade 0.3s ease both" }}>
          Здесь появятся оплаты и бонусы за друзей.
        </div>
      ) : null}

      {(items || []).map((item, i) => {
        const out = item.direction ? item.direction === "out" : Number(item.amount) <= 0;
        const refunded = item.status === "refunded";
        const value = Math.abs(Number(item.amount || 0));
        const amount = item.stars ? `${item.stars} ⭐` : value ? `${fmtAmount(value)} ₽` : "";
        return (
          <div
            key={item.id}
            style={{
              marginTop: i === 0 ? 20 : 10,
              flexShrink: 0,
              minHeight: 86,
              padding: "22.5px 17px 16px 16px",
              borderRadius: 16,
              border: `1px solid ${CARD_BORDER}`,
              background: CARD_BG,
              boxSizing: "border-box",
              fontSize: 14.5,
              lineHeight: "20px",
              animation: `fgnFade 0.35s ease ${Math.min(i, 12) * 0.04}s both`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ minWidth: 0, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titleFor(item)}</span>
              {amount ? (
                <span
                  style={{
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    color: refunded ? MUTED : out ? TEXT : C.green,
                    textDecoration: refunded ? "line-through" : "none",
                  }}
                >
                  {out ? "" : "+"}{amount}
                </span>
              ) : null}
            </div>
            <div style={{ marginTop: 5.5, color: MUTED }}>{dateFor(item)}</div>
          </div>
        );
      })}
    </FgnPage>
  );
}
