import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { copyText } from "../components/SubLinkBox";
import { btnReset } from "../components/ui";
import { N, NoirBack, NoirButton, NoirScreen } from "../components/noir";

// ЛЯМ200: 22–23 «Мои подарки» — общий экран в стиле ЛЯМ200 (компоненты noir → дизайн ЛЯМ200)

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
      <NoirBack onClick={goBack} />
      <div style={{ fontSize: 24, fontWeight: 600, lineHeight: "32px", paddingTop: 6, color: N.text, marginBottom: 16 }}>
        Мои подарки
      </div>

      {items === null ? (
        <div style={{ fontSize: 14, color: N.muted }}>Загрузка…</div>
      ) : items.length === 0 ? (
        <div style={{ animation: "blinvpnRise 0.5s var(--ease-out) both" }}>
          <div style={{ fontSize: 14, lineHeight: "20px", color: N.muted, marginBottom: 16 }}>Подарков пока нет.</div>
          <NoirButton primary onClick={() => navigate("/gift/buy")}>Купить подарок</NoirButton>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((g, i) => {
              const used = g.status === "redeemed";
              const meta = [periodTitle(Number(g.months || 1)), used ? "использован" : "", formatDateRu((used ? g.redeemed_at : g.created_at) || "")]
                .filter(Boolean).join(" · ");
              return (
                <div
                  key={g.code}
                  style={{
                    padding: 16, borderRadius: 16, background: N.card, display: "flex", alignItems: "center", gap: 12,
                    animation: `blinvpnRise 0.5s var(--ease-out) ${0.04 * i}s both`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "Consolas, 'SFMono-Regular', Menlo, monospace", fontSize: 14, lineHeight: "20px", color: N.text, userSelect: "all", WebkitUserSelect: "all" }}>{g.code}</div>
                    <div style={{ paddingTop: 4, fontSize: 14, lineHeight: "20px", color: N.muted }}>{meta}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copy(g.code)}
                    style={{ ...btnReset, fontFamily: N.font, flex: "none", padding: 0, background: "transparent", border: "none", fontSize: 14, lineHeight: "20px", color: N.text, textDecoration: "underline", cursor: "pointer" }}
                  >
                    {copied === g.code ? "Скопировано" : "Копировать"}
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ paddingTop: 16 }}>
            <NoirButton primary onClick={() => navigate("/gift/buy")}>Купить подарок</NoirButton>
          </div>
        </div>
      )}
    </NoirScreen>
  );
}
