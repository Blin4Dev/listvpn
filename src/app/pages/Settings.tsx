import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MSIcon, btnReset } from "../components/ui";
import { N, NoirBack, NoirScreen, NoirSection } from "../components/noir";
import { useSmartBack } from "../utils/navigation";
import { fetchMe, isTelegram, openTgLink, type AppUser } from "../utils/api";
import { tgUser } from "../utils/telegram";
import { APP_VERSION, BRAND_NAME, CHANNEL_URL } from "../utils/brand";

type Row = { icon?: string; title: string; subtitle?: string; onClick: () => void };

/** карточка со строками через разделитель */
function Group({ rows, style }: { rows: Row[]; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: N.card,
        border: `1px solid ${N.cardBorder}`,
        borderRadius: 30,
        overflow: "hidden",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        ...style,
      }}
    >
      {rows.map((r, i) => (
        <button
          key={r.title}
          type="button"
          onClick={r.onClick}
          className="blin-press"
          style={{
            ...btnReset,
            fontFamily: N.font,
            width: "100%",
            minHeight: r.subtitle ? 70 : 53,
            padding: "12px 12px 12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            textAlign: "left",
            background: "transparent",
            border: "none",
            borderTop: i ? `1px solid ${N.divider}` : "none",
            color: N.text,
            cursor: "pointer",
          }}
        >
          {r.icon ? (
            <MSIcon name={r.icon} style={{ fontSize: 23, color: "rgba(255,255,255,0.82)", fontVariationSettings: "'wght' 300" }} />
          ) : null}
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 16.5, letterSpacing: "-0.015em" }}>{r.title}</span>
            {r.subtitle ? <span style={{ display: "block", marginTop: 3, fontSize: 14.5, color: N.muted }}>{r.subtitle}</span> : null}
          </span>
          <MSIcon name="chevron_right" style={{ fontSize: 20, color: N.dim, fontVariationSettings: "'wght' 300" }} />
        </button>
      ))}
    </div>
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
  const inTg = isTelegram();
  const avatarUrl = tg?.photo_url || "";
  const tgName = [tg?.first_name, tg?.last_name].filter(Boolean).join(" ").trim();
  const primaryName = inTg
    ? (tgName || (user?.username ? `@${user.username}` : "Пользователь"))
    : (user?.email || (user?.username ? `@${user.username}` : "Пользователь"));
  const initial = (tgName || user?.username || user?.email || "S").trim().charAt(0).toUpperCase();
  // внутренний id аккаунта (для поддержки), не telegram id
  const secondary = user?.id != null ? `ID ${user.id}` : "";

  const rise = (i: number): React.CSSProperties => ({ animation: `blinvpnRise 0.55s var(--ease-out) ${0.05 * i}s both` });

  return (
    <NoirScreen>
      <div style={{ paddingTop: 20, marginBottom: 18 }}>
        <NoirBack onClick={goBack} />
      </div>

      <div style={{ ...rise(0), display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 58,
            height: 58,
            flex: "none",
            borderRadius: "50%",
            overflow: "hidden",
            background: "rgba(16, 16, 22, 0.92)",
            border: `1px solid ${N.cardBorder}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 500,
            color: N.text,
          }}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
          ) : (
            initial
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 500, color: N.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {primaryName}
          </div>
          {secondary ? <div style={{ marginTop: 3, fontSize: 15, color: N.muted }}>{secondary}</div> : null}
        </div>
      </div>

      <div style={rise(1)}>
        <NoirSection>Аккаунт</NoirSection>
        <Group
          rows={[
            { icon: "history", title: "История платежей", subtitle: "Платежи и операции", onClick: () => navigate("/history") },
            { icon: "key", title: "Безопасность", subtitle: "Способы входа и привязки", onClick: () => navigate("/security") },
          ]}
        />
      </div>

      <div style={rise(2)}>
        <NoirSection>Поддержка</NoirSection>
        <Group
          rows={[
            { icon: "headset_mic", title: "Поддержка", subtitle: "Написать в бот", onClick: () => navigate("/support") },
            { icon: "description", title: "Договор оферты", onClick: () => navigate("/legal/offer") },
            { icon: "shield", title: "Политика конфиденциальности", onClick: () => navigate("/legal/privacy") },
            { title: "Наш канал", onClick: () => openTgLink(CHANNEL_URL) },
          ]}
        />
      </div>

      <div style={{ ...rise(3), marginTop: 36, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <div style={{ fontSize: 14, color: N.dim }}>
          {BRAND_NAME}, версия {APP_VERSION}
        </div>
      </div>

    </NoirScreen>
  );
}
