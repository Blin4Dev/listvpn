import React, { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { N, NoirBack, NoirBadge, NoirButton, NoirCard, NoirLoading, NoirScreen } from "../components/noir";

type SubResponse = { key?: { expiry_date?: string | null; no_renew?: boolean | null } | null };

// продление: обычно сразу на «Тарифы»; экран только для подписок без продления
export default function ExtendSubscription() {
  const navigate = useNavigate();
  const goBack = useSmartBack("/subscription");
  const [sub, setSub] = useState<SubResponse | null>(null);

  useEffect(() => {
    appFetch<SubResponse>("/subscription").then(setSub).catch(() => setSub({}));
  }, []);

  if (!sub) return <NoirLoading />;
  if (!sub.key?.no_renew) return <Navigate to="/tariffs" replace />;

  return (
    <NoirScreen dim={0.45}>
      <div style={{ paddingTop: 20, marginBottom: 22 }}>
        <NoirBack onClick={goBack} />
      </div>
      <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.15, color: N.text, marginBottom: 18 }}>
        Продлить
      </div>
      <NoirCard style={{ padding: "22px 18px", animation: "blinvpnRise 0.5s var(--ease-out) both" }}>
        <NoirBadge icon="event_busy" />
        <div style={{ marginTop: 16, fontSize: 21, fontWeight: 500, color: N.text }}>Продление недоступно</div>
        <div style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5, color: N.muted }}>
          Эту подписку нельзя продлить. Она работает до{" "}
          {sub.key?.expiry_date ? formatDateRu(sub.key.expiry_date) : "конца срока"}, после чего будет удалена — тогда можно
          будет оформить новую.
        </div>
      </NoirCard>
      <div style={{ marginTop: "auto", paddingTop: 16 }}>
        <NoirButton onClick={() => navigate("/subscription")}>К подписке</NoirButton>
      </div>
    </NoirScreen>
  );
}
