import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { copyText } from "../components/SubLinkBox";
import { btnReset } from "../components/ui";
import { N, NoirBack, NoirButton, NoirScreen } from "../components/noir";

type Gift = { code: string; kind: string; status: string; months: number; created_at: string; redeemed_at?: string | null };

function periodTitle(m: number) {
  if (m === 12) return "1 год";
  return `${m} ${m === 1 ? "месяц" : m < 5 ? "месяца" : "месяцев"}`;
}

export default function MyGifts() {
  const goBack = useSmartBack("/");
  const navigate = useNavigate();
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
    <NoirScreen dim={0.45}>
      <div style={{ paddingTop: 20, marginBottom: 22 }}>
        <NoirBack onClick={goBack} />
      </div>
      <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.15, color: N.text, marginBottom: 18 }}>
        Мои подарки
      </div>

      {items === null ? (
        <div style={{ fontSize: 15.5, color: N.muted }}>Загрузка…</div>
      ) : items.length === 0 ? (
        <div style={{ animation: "blinvpnRise 0.5s var(--ease-out) both" }}>
          <div style={{ fontSize: 15.5, lineHeight: 1.5, color: N.muted, marginBottom: 20 }}>
            Подарков пока нет. Купите подписку другу — код появится здесь, и его можно будет отправить в любой момент.
          </div>
          <NoirButton primary icon="redeem" onClick={() => navigate("/gift/buy")}>Купить подарок</NoirButton>
        </div>
      ) : (
        <div>
          {items.map((g, i) => {
            const used = g.status === "redeemed";
            return (
              <div
                key={g.code}
                style={{
                  padding: "16px 0 14px",
                  borderBottom: `1px solid ${N.divider}`,
                  animation: `blinvpnRise 0.5s var(--ease-out) ${0.04 * i}s both`,
                }}
              >
                <div style={{ fontSize: 17.5, color: used ? N.muted : N.text }}>
                  Подарок, {periodTitle(Number(g.months || 1))}
                </div>
                <div style={{ marginTop: 6, fontSize: 15, letterSpacing: "0.02em", color: N.dim, userSelect: "all", WebkitUserSelect: "all" }}>
                  {g.code}
                </div>
                {used ? (
                  <div style={{ marginTop: 8, fontSize: 15, color: N.dim }}>
                    Активирован{g.redeemed_at ? ` ${formatDateRu(g.redeemed_at)}` : ""}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void copy(g.code)}
                    style={{ ...btnReset, fontFamily: N.font, display: "block", marginTop: 8, padding: 0, background: "transparent", border: "none", fontSize: 15.5, color: N.text, cursor: "pointer" }}
                  >
                    {copied === g.code ? "Скопировано" : "Копировать"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </NoirScreen>
  );
}
