import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTgBack } from "../components/noir";
import { O, OBack, OIcon, OScreen } from "../components/rumble";
import { useSmartBack } from "../utils/navigation";
import { fetchMe, isTelegram, openTgLink, type AppUser } from "../utils/api";
import { tgUser } from "../utils/telegram";
import { APP_VERSION, BRAND_NAME, CHANNEL_URL } from "../utils/brand";

// RUMBLE: 24 «Настройки»

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

  const label: React.CSSProperties = { paddingTop: 24, paddingLeft: 4, fontSize: 14, lineHeight: "20px", color: O.muted };
  return (
    <OScreen>
      <OBack onClick={goBack} />

      <div style={{ ...rise(0), paddingTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", flex: "none" }} onError={(e) => { e.currentTarget.src = "/assets/home-logo.png"; e.currentTarget.style.borderRadius = "0"; }} />
        ) : (
          <img src="/assets/home-logo.png" alt="" style={{ width: 56, height: 64, objectFit: "contain", flex: "none" }} />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, lineHeight: "28px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{primaryName}</div>
          {secondary ? <div style={{ fontSize: 14, lineHeight: "20px", color: O.muted }}>{secondary}</div> : null}
        </div>
      </div>

      <div style={rise(1)}>
        <div style={label}>Аккаунт</div>
        <div style={list}>
          <SetRow icon="clock" title="История платежей" sub="Платежи и операции" onClick={() => navigate("/history")} />
          <SetRow icon="shield" title="Безопасность" sub="Способы входа и привязки" onClick={() => navigate("/security")} />
        </div>
      </div>

      <div style={rise(2)}>
        <div style={label}>Поддержка</div>
        <div style={list}>
          <SetRow icon="headphones" title="Поддержка" sub="Написать в бот" onClick={() => navigate("/support")} />
          <SetRow icon="file-text" title="Договор оферты" onClick={() => navigate("/legal/offer")} />
          <SetRow icon="shield" title="Политика конфиденциальности" onClick={() => navigate("/legal/privacy")} />
          {CHANNEL_URL ? <SetRow icon="send" title="Наш канал" onClick={() => openTgLink(CHANNEL_URL)} /> : null}
        </div>
      </div>
    </OScreen>
  );
}

// строка настроек RUMBLE: иконка 24, Bold 18 (+ подпись 14)
function SetRow({ icon, title, sub, onClick }: { icon: string; title: string; sub?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="blin-press"
      style={{
        appearance: "none", WebkitAppearance: "none", WebkitTapHighlightColor: "transparent", outline: "none", margin: 0, boxSizing: "border-box",
        width: "100%", minHeight: sub ? 79 : 56, padding: "16px", display: "flex", alignItems: "center", gap: 12, border: "none",
        borderRadius: 21.6, background: O.card, boxShadow: O.ring, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        color: O.text, fontFamily: O.font, textAlign: "left", cursor: "pointer",
      }}
    >
      <OIcon name={icon} size={24} />
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 18, fontWeight: 700, lineHeight: "22.5px" }}>{title}</span>
        {sub ? <span style={{ paddingTop: 4, fontSize: 14, lineHeight: "20px", color: O.muted }}>{sub}</span> : null}
      </span>
    </button>
  );
}
