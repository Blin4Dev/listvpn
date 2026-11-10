import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTgBack } from "../components/noir";
import { O, OBack, OLabel, OMenuRow, OScreen } from "../components/ovpn";
import { useSmartBack } from "../utils/navigation";
import { fetchMe, isTelegram, openTgLink, type AppUser } from "../utils/api";
import { tgUser } from "../utils/telegram";
import { APP_VERSION, BRAND_NAME, CHANNEL_URL } from "../utils/brand";

// O-VPN: 24 «Настройки»

export default function Settings() {
  const navigate = useNavigate();
  const goBack = useSmartBack("/");
  useTgBack(goBack);
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
  const initial = (tgName || user?.username || user?.email || "O").trim().charAt(0).toUpperCase();
  const secondary = user?.id != null ? `ID ${user.id}` : "";
  const rise = (i: number): React.CSSProperties => ({ animation: `blinvpnRise 0.55s var(--ease-out) ${0.05 * i}s both` });
  const list: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 };

  return (
    <OScreen>
      <OBack onClick={goBack} />

      <div style={{ ...rise(0), paddingTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 64,
            height: 64,
            flex: "none",
            borderRadius: "50%",
            overflow: "hidden",
            background: O.card,
            border: `1px solid ${O.border}`,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            fontWeight: 800,
            color: O.text,
          }}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
          ) : (
            initial
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, lineHeight: "28px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{primaryName}</div>
          {secondary ? <div style={{ fontSize: 14, lineHeight: "20px", color: O.muted }}>{secondary}</div> : null}
        </div>
      </div>

      <div style={rise(1)}>
        <OLabel style={{ paddingTop: 20 }}>Аккаунт</OLabel>
        <div style={list}>
          <OMenuRow icon="history" title="История платежей" subtitle="Платежи и операции" onClick={() => navigate("/history")} />
          <OMenuRow icon="key-round" title="Безопасность" subtitle="Способы входа и привязки" onClick={() => navigate("/security")} />
        </div>
      </div>

      <div style={rise(2)}>
        <OLabel style={{ paddingTop: 20 }}>Поддержка</OLabel>
        <div style={list}>
          <OMenuRow icon="headphones" title="Поддержка" subtitle="Написать в бот" onClick={() => navigate("/support")} />
          <OMenuRow icon="file-text" title="Договор оферты" onClick={() => navigate("/legal/offer")} />
          <OMenuRow icon="shield" title="Политика конфиденциальности" onClick={() => navigate("/legal/privacy")} />
          {CHANNEL_URL ? <OMenuRow icon="send" title="Наш канал" onClick={() => openTgLink(CHANNEL_URL)} /> : null}
        </div>
      </div>

      <div style={{ ...rise(3), paddingTop: 36, textAlign: "center", fontSize: 14, lineHeight: "20px", color: O.muted }}>
        {BRAND_NAME}, версия {APP_VERSION}
      </div>
    </OScreen>
  );
}
