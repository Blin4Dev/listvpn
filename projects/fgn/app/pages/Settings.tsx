// FGN: «Настройки» (макет 71; переопределение src/app/pages/Settings.tsx).
// Кнопка «назад» без заголовка, профиль (белый круг 56 со щитом, имя 18.5/600, «ID N» 15 серым),
// «Аккаунт» — две отдельные карточки 74 (строка 72 + рамка) (радиус 24, зазор 8), «Поддержка» — одна карточка без разделителей
// (строки 74 / 62 / 78 / 50), внизу «FGN, версия 1.0».
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { fetchMe, isTelegram, openTgLink, type AppUser } from "../utils/api";
import { tgUser } from "../utils/telegram";
import { APP_VERSION, BRAND_NAME, CHANNEL_URL } from "../utils/brand";
import { C, FgnHeader, FgnIcon, FgnPage } from "../components/fgn";

const MUTED = "#ABAAB2";
const LABEL = "#757482";
const CHEVRON = "#7A7981";
const CARD_BG = "#141416";
const CARD_BORDER = "#2A2A30";
const TEXT = "#F4F4F5";

type Row = { icon?: string; iconSize?: number; title: string; subtitle?: string; height?: number; onClick: () => void };

/** подпись секции: 12/600, капс, широкая разрядка */
function Section({ children, top }: { children: React.ReactNode; top: number }) {
  return (
    <div style={{ marginTop: top, flexShrink: 0, fontSize: 12, fontWeight: 600, lineHeight: "16px", letterSpacing: "0.2em", textTransform: "uppercase", color: LABEL }}>
      {children}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  flexShrink: 0,
  borderRadius: 24,
  border: `1px solid ${CARD_BORDER}`,
  background: CARD_BG,
  overflow: "hidden",
  boxSizing: "border-box",
};

function RowButton({ r }: { r: Row }) {
  return (
    <button
      type="button"
      className="blin-press"
      onClick={r.onClick}
      style={{
        appearance: "none",
        margin: 0,
        width: "100%",
        minHeight: r.height || (r.subtitle ? 74 : r.icon ? 62 : 50),
        padding: "15px 15px 15px 16px",
        display: "flex",
        alignItems: "center",
        textAlign: "left",
        background: "transparent",
        border: "none",
        fontFamily: C.font,
        color: TEXT,
        cursor: "pointer",
        boxSizing: "border-box",
      }}
    >
      {r.icon ? (
        <span style={{ width: 48, flexShrink: 0, display: "flex", justifyContent: "center", paddingRight: 12.5, boxSizing: "border-box" }}>
          <FgnIcon name={r.icon} size={r.iconSize || 22} stroke={2} />
        </span>
      ) : null}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 16.5, fontWeight: 500, lineHeight: "24px", whiteSpace: "pre-line" }}>{r.title}</span>
        {r.subtitle ? <span style={{ display: "block", fontSize: 14.5, lineHeight: "20px", color: MUTED }}>{r.subtitle}</span> : null}
      </span>
      <FgnIcon name="chevron" size={18} stroke={2} style={{ marginLeft: 12, color: CHEVRON }} />
    </button>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const goBack = useSmartBack("/");
  const [user, setUser] = useState<AppUser | null>(null);

  useEffect(() => {
    void fetchMe().then(setUser);
  }, []);

  const tg = tgUser();
  const tgName = [tg?.first_name, tg?.last_name].filter(Boolean).join(" ").trim();
  const name = isTelegram()
    ? (tgName || (user?.username ? `@${user.username}` : "Пользователь"))
    : (user?.email || (user?.username ? `@${user.username}` : "Пользователь"));
  // внутренний id аккаунта (для поддержки), не telegram id
  const idText = user?.id != null ? `ID ${user.id}` : "";

  const fade = (i: number): React.CSSProperties => ({ flexShrink: 0, animation: `fgnFade 0.35s ease ${0.05 * i}s both` });

  return (
    <FgnPage>
      <FgnHeader title="" onBack={goBack} btnStyle={{ background: CARD_BG, borderColor: CARD_BORDER }} />

      <div style={{ ...fade(0), marginTop: 24, display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 56,
            height: 56,
            flexShrink: 0,
            borderRadius: "50%",
            background: C.btnSoft,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="28" height="32.5" viewBox="0 0 28 32.5" aria-hidden style={{ display: "block", marginTop: 0.5 }}>
            <path d="M14 0C10.4 2.9 5.6 5.1 0.4 6V13.4C0.4 22.2 5.9 29.2 14 32.5C22.1 29.2 27.6 22.2 27.6 13.4V6C22.4 5.1 17.6 2.9 14 0Z" fill="#0A0A0A" />
          </svg>
        </div>
        <div style={{ minWidth: 0, marginTop: 8 }}>
          <div style={{ fontSize: 18.5, fontWeight: 600, lineHeight: "24px", color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </div>
          {idText ? <div style={{ marginTop: 1.5, fontSize: 15, lineHeight: "19px", color: MUTED }}>{idText}</div> : null}
        </div>
      </div>

      <div style={fade(1)}>
        <Section top={32.5}>Аккаунт</Section>
        <div style={{ ...cardStyle, marginTop: 7.5 }}>
          <RowButton r={{ icon: "history", title: "История платежей", subtitle: "Платежи и операции", height: 72, onClick: () => navigate("/history") }} />
        </div>
        <div style={{ ...cardStyle, marginTop: 8 }}>
          <RowButton r={{ icon: "key", title: "Безопасность", subtitle: "Способы входа и привязки", height: 72, onClick: () => navigate("/security") }} />
        </div>
      </div>

      <div style={fade(2)}>
        <Section top={24.5}>Поддержка</Section>
        <div style={{ ...cardStyle, marginTop: 7.5 }}>
          <RowButton r={{ icon: "headphones", title: "Поддержка", subtitle: "Написать в бот", onClick: () => navigate("/support") }} />
          <RowButton r={{ icon: "doc", iconSize: 21, title: "Договор оферты", onClick: () => navigate("/legal/offer") }} />
          <RowButton r={{ icon: "shield", title: "Политика\nконфиденциальности", onClick: () => navigate("/legal/privacy") }} />
          {CHANNEL_URL ? <RowButton r={{ title: "Наш канал", onClick: () => openTgLink(CHANNEL_URL) }} /> : null}
        </div>
      </div>

      <div style={{ ...fade(3), marginTop: 40.5, textAlign: "center", fontSize: 14.5, lineHeight: "20px", color: "#7B7B85" }}>
        {BRAND_NAME}, версия {APP_VERSION}
      </div>
    </FgnPage>
  );
}
