import React, { useEffect, useState } from "react";
import { useSmartBack } from "../utils/navigation";
import { appFetch } from "../utils/api";
import { N, NoirBack, NoirScreen } from "../components/noir";

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
      <div style={{ paddingTop: 20, marginBottom: 22 }}>
        <NoirBack onClick={goBack} />
      </div>
      <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.15, color: N.text, marginBottom: 26 }}>
        История
      </div>

      {items === null ? (
        <div style={{ fontSize: 15.5, color: N.muted }}>Загрузка…</div>
      ) : items.length === 0 ? (
        <div style={{ animation: "blinvpnRise 0.5s var(--ease-out) both" }}>
          <div style={{ fontSize: 18, fontWeight: 500, color: N.text }}>Операций пока нет</div>
          <div style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5, color: N.muted, maxWidth: 290 }}>
            Здесь появятся оплаты, пополнения баланса и бонусы за друзей.
          </div>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          {items.map((item, i) => {
            const last = i === items.length - 1;
            const out = item.direction ? item.direction === "out" : Number(item.amount) < 0;
            const refunded = item.status === "refunded";
            const value = Math.abs(Number(item.amount || 0));
            const hasAmount = item.stars ? true : value !== 0;
            const dot = refunded ? N.dim : out ? N.red : GREEN;
            return (
              <div
                key={item.id}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  paddingLeft: 28,
                  paddingBottom: last ? 0 : 26,
                  animation: `blinvpnRise 0.5s var(--ease-out) ${Math.min(i, 12) * 0.04}s both`,
                }}
              >
                {/* точка и линия к следующей операции */}
                <span
                  style={{
                    position: "absolute",
                    left: 4,
                    top: 7,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: dot,
                    boxShadow: refunded ? "none" : `0 0 10px ${dot}88`,
                  }}
                />
                {!last ? (
                  <span
                    style={{
                      position: "absolute",
                      left: 7.5,
                      top: 22,
                      bottom: 6,
                      width: 1,
                      background: "rgba(255,255,255,0.16)",
                    }}
                  />
                ) : null}

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 500,
                      lineHeight: 1.3,
                      color: refunded ? N.muted : N.text,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {titleFor(item)}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 14.5, color: N.muted, fontVariantNumeric: "tabular-nums" }}>
                    {subFor(item)}
                  </div>
                </div>
                {hasAmount ? (
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 500,
                      lineHeight: 1.3,
                      color: refunded ? N.dim : out ? N.text : GREEN,
                      textDecoration: refunded ? "line-through" : "none",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {item.stars ? `${out ? "−" : "+"}${item.stars} ⭐` : `${out ? "−" : "+"}${fmtAmount(value)} ₽`}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </NoirScreen>
  );
}
