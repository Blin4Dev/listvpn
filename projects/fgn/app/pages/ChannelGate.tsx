// FGN: оверлей «Подпишитесь на канал» (переопределение src/app/pages/ChannelGate.tsx).
// Логика та же (открыть канал, повторная проверка, пропуск если необязательно),
// дизайн — карточка-диалог FGN: иконка-кружок 44, заголовок 18.5/600, текст 14.5/20, кнопки 52/54.
import React, { useState } from "react";
import { fetchMembership, tgWebApp, type Membership } from "../utils/api";
import { C, FGN_DIM, FgnIcon, fgnButton } from "../components/fgn";
import { BRAND_NAME } from "../utils/brand";

const TEXT = "#F4F4F5";
const MUTED = "#9B9BA4";
const DANGER = "#FF5D62";
const CARD_BG = "#141416";
const CARD_BORDER = "#2A2A30";

export default function ChannelGate({
  membership,
  onPassed,
  onSkip,
}: {
  membership: Membership;
  onPassed: () => void;
  onSkip?: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState("");

  const channelUrl = membership.channel_url || "https://t.me/BATMANNETWORK";

  const openChannel = () => {
    const wa = tgWebApp();
    if (wa?.openTelegramLink && /^https?:\/\/t\.me\//i.test(channelUrl)) wa.openTelegramLink(channelUrl);
    else if (wa?.openLink) wa.openLink(channelUrl);
    else window.open(channelUrl, "_blank", "noopener,noreferrer");
  };

  const recheck = async () => {
    if (checking) return;
    setChecking(true);
    setErr("");
    const m = await fetchMembership(true);
    setChecking(false);
    if (m.subscribed) onPassed();
    else setErr("Подписка пока не видна. Подпишитесь и нажмите ещё раз.");
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: FGN_DIM,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "0 16px",
        paddingBottom: "calc(24px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
        boxSizing: "border-box",
        animation: "fgnFade 0.2s ease both",
        fontFamily: C.font,
      }}
    >
      <style>{`@keyframes fgnFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes fgnRise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }`}</style>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: "100%",
          maxWidth: 488,
          background: CARD_BG,
          border: `1px solid ${CARD_BORDER}`,
          borderRadius: 24,
          padding: 20,
          boxSizing: "border-box",
          color: TEXT,
          animation: "fgnRise 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
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
          <FgnIcon name="send" size={19} stroke={1.9} />
        </div>
        <div style={{ marginTop: 16, fontSize: 18.5, fontWeight: 600, lineHeight: "24px", letterSpacing: "-0.015em", color: TEXT }}>
          Подпишитесь на канал
        </div>
        <div style={{ marginTop: 8, fontSize: 14.5, fontWeight: 400, lineHeight: "20px", color: MUTED }}>
          {onSkip
            ? <>Там новости {BRAND_NAME} и статус серверов — так вы ничего не пропустите.</>
            : <>Чтобы пользоваться {BRAND_NAME}, подпишитесь на наш канал — там новости и статус серверов.</>}
        </div>
        <button
          type="button"
          className="blin-press"
          onClick={() => { openChannel(); if (onSkip) onSkip(); }}
          style={{ ...fgnButton, marginTop: 22, height: 52, borderRadius: 16, fontSize: 16 }}
        >
          Подписаться
        </button>
        {onSkip ? null : (
          <button
            type="button"
            className="blin-press"
            disabled={checking}
            onClick={() => void recheck()}
            style={{
              appearance: "none",
              display: "block",
              width: "100%",
              margin: 0,
              padding: "12px 0 0",
              background: "transparent",
              border: "none",
              color: TEXT,
              fontFamily: C.font,
              fontSize: 15,
              fontWeight: 500,
              textAlign: "center",
              cursor: checking ? "default" : "pointer",
              opacity: checking ? 0.6 : 1,
            }}
          >
            {checking ? "Проверяем…" : "Я подписался — проверить"}
          </button>
        )}
        {err ? <div style={{ marginTop: 8, fontSize: 14, lineHeight: "20px", color: DANGER, textAlign: "center" }}>{err}</div> : null}
        {onSkip ? (
          <button
            type="button"
            className="blin-press"
            onClick={onSkip}
            style={{
              ...fgnButton,
              marginTop: 8,
              height: 54,
              borderRadius: 16,
              background: "transparent",
              border: `1px solid ${CARD_BORDER}`,
              color: TEXT,
              fontSize: 16,
              boxSizing: "border-box",
            }}
          >
            Пропустить
          </button>
        ) : null}
      </div>
    </div>
  );
}