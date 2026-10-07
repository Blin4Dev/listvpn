import React, { useState } from "react";
import { fetchMembership, tgWebApp, type Membership } from "../utils/api";
import { N, NoirBadge, NoirButton, NoirDialog, NoirTextButton } from "../components/noir";
import { BRAND_NAME } from "../utils/brand";

// оверлей подписки на канал; закрыть только после успешной проверки
export default function ChannelGate({
  membership,
  onPassed,
}: {
  membership: Membership;
  onPassed: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState("");

  const channelUrl = membership.channel_url || "https://t.me/blinvpn";

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
    <NoirDialog zIndex={3000} dim={0.55}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <NoirBadge icon="campaign" />
        <div style={{ marginTop: 16, fontWeight: 500, fontSize: 23, letterSpacing: "-0.02em", color: N.text }}>
          Подпишитесь на канал
        </div>
        <div style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5, color: N.muted }}>
          Чтобы пользоваться {BRAND_NAME}, подпишитесь на наш канал — там новости и статус серверов.
        </div>
      </div>
      <div style={{ marginTop: 22 }}>
        <NoirButton primary icon="send" onClick={openChannel}>Подписаться</NoirButton>
        <div style={{ marginTop: 4 }}>
          <NoirTextButton disabled={checking} onClick={() => void recheck()} color={N.text}>
            {checking ? "Проверяем…" : "Я подписался — проверить"}
          </NoirTextButton>
        </div>
        {err ? <div style={{ fontSize: 14, color: "#FF6B6B", textAlign: "center", marginTop: 2 }}>{err}</div> : null}
      </div>
    </NoirDialog>
  );
}
