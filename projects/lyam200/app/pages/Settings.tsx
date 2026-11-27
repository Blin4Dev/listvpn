import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTgBack } from "../components/noir";
import { O, OBack, OMenuRow, OScreen, OTitle } from "../components/lyam";
import { useSmartBack } from "../utils/navigation";
import { fetchMe, isTelegram, openTgLink, type AppUser } from "../utils/api";
import { tgUser } from "../utils/telegram";
import { APP_VERSION, BRAND_NAME, CHANNEL_URL } from "../utils/brand";

// ЛЯМ200: 33 «Настройки»

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
  const list: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 };

  const label: React.CSSProperties = { paddingTop: 24, fontSize: 14, lineHeight: "20px", color: O.muted };
  return (
    <OScreen>
      <OBack onClick={goBack} />
      <OTitle>Настройки</OTitle>

      <div style={{ ...rise(0), paddingTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <img
          src={avatarUrl || "/assets/home-logo.png"}
          alt=""
          style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", flex: "none" }}
          onError={(e) => { e.currentTarget.src = "/assets/home-logo.png"; }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, lineHeight: "24px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{primaryName}</div>
          {secondary ? <div style={{ fontSize: 14, lineHeight: "20px", color: O.muted }}>{secondary}</div> : null}
        </div>
      </div>

      <div style={rise(1)}>
        <div style={label}>Аккаунт</div>
        <div style={list}>
          <OMenuRow icon="history" title="История платежей" subtitle="Платежи и операции" onClick={() => navigate("/history")} />
          <OMenuRow icon="shield" title="Безопасность" subtitle="Способы входа и привязки" onClick={() => navigate("/security")} />
        </div>
      </div>

      <div style={rise(2)}>
        <div style={{ ...label, paddingTop: 20 }}>Поддержка</div>
        <div style={list}>
          <OMenuRow icon="headphones" title="Поддержка" subtitle="Написать в бот" onClick={() => navigate("/support")} />
          <OMenuRow icon="file-text" title="Договор оферты" onClick={() => navigate("/legal/offer")} />
          <OMenuRow icon="lock" title="Политика конфиденциальности" onClick={() => navigate("/legal/privacy")} />
          {CHANNEL_URL ? <OMenuRow icon="megaphone" title="Наш канал" onClick={() => openTgLink(CHANNEL_URL)} /> : null}
        </div>
      </div>
    </OScreen>
  );
}
