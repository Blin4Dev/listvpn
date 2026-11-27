// FGN: «Продлить» / «Продление недоступно» (переопределение src/app/pages/ExtendSubscription.tsx).
// Обычно уводим на «Тарифы»; экран показывается только для подписок без продления.
// Дизайн FGN: шапка с заголовком, карточка 24 с иконкой-кружком, светлая кнопка внизу.
import React, { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { C, FgnHeader, FgnIcon, FgnPage, fgnButton } from "../components/fgn";

type SubResponse = { key?: { expiry_date?: string | null; no_renew?: boolean | null } | null };

const TEXT = "#F4F4F5";
const MUTED = "#9B9BA4";
const CARD_BG = "#141416";
const CARD_BORDER = "#2A2A30";

export default function ExtendSubscription() {
  const navigate = useNavigate();
  const goBack = useSmartBack("/subscription");
  const [sub, setSub] = useState<SubResponse | null>(null);

  useEffect(() => {
    appFetch<SubResponse>("/subscription").then(setSub).catch(() => setSub({}));
  }, []);

  if (sub && !sub.key?.no_renew) return <Navigate to="/tariffs" replace />;

  return (
    <FgnPage>
      <FgnHeader title="Продлить" onBack={goBack} btnStyle={{ background: CARD_BG, borderColor: CARD_BORDER }} />

      {!sub ? (
        <div style={{ marginTop: 20, flexShrink: 0, fontSize: 15, lineHeight: "20px", color: MUTED }}>Загрузка…</div>
      ) : (
        <>
          <div
            style={{
              flexShrink: 0,
              marginTop: 24,
              padding: 20,
              borderRadius: 24,
              border: `1px solid ${CARD_BORDER}`,
              background: CARD_BG,
              boxSizing: "border-box",
              animation: "fgnRise 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: "#1C1C1F",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: TEXT,
                boxSizing: "border-box",
              }}
            >
              <FgnIcon name="calendar" size={20} stroke={1.9} />
            </div>
            <div style={{ marginTop: 16, fontSize: 18.5, fontWeight: 600, lineHeight: "24px", letterSpacing: "-0.015em", color: TEXT }}>
              Продление недоступно
            </div>
            <div style={{ marginTop: 8, fontSize: 14.5, fontWeight: 400, lineHeight: "20px", color: MUTED }}>
              Эту подписку нельзя продлить. Она работает до{" "}
              {sub.key?.expiry_date ? formatDateRu(sub.key.expiry_date) : "конца срока"}, после чего будет удалена — тогда можно
              будет оформить новую.
            </div>
          </div>

          <div style={{ flexShrink: 0, marginTop: "auto", paddingTop: 24 }}>
            <button type="button" className="blin-press" onClick={() => navigate("/subscription")} style={fgnButton}>
              К подписке
            </button>
          </div>
        </>
      )}
    </FgnPage>
  );
}