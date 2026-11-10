import { useState } from "react";
import { reissueKey } from "../utils/api";
import { copyText } from "./SubLinkBox";
import { NoirButton, NoirSheet } from "./noir";
import { O } from "./ovpn";

// O-VPN: 38 «Ключ перевыпущен»

/**
 * Сброс ключа подписки: подтверждение → POST /api/app/subscription/reissue (revoke в Remnawave:
 * новая ссылка, старая перестаёт работать, все устройства отвязываются) → новый ключ для копирования.
 * У FGN свой вид этого же компонента: projects/fgn/app/components/ReissueKey.tsx.
 */
export default function ReissueKey({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const [state, setState] = useState<"confirm" | "busy" | { link: string } | { error: string }>("confirm");
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setState("busy");
    try {
      const r = await reissueKey();
      setState({ link: r.subscription_url || "" });
      onDone?.();
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : "Не удалось сбросить ключ. Попробуйте позже." });
    }
  };

  if (state === "confirm" || state === "busy") {
    const busy = state === "busy";
    return (
      <NoirSheet title="Перевыпустить ключ?" onClose={() => { if (!busy) onClose(); }}>
        <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted }}>
          Старый ключ перестанет работать, а все устройства отвяжутся. Новый ключ нужно будет заново добавить в приложение на каждом устройстве.
          <br />
          <br />
          Делайте это, если ключ попал к посторонним.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16 }}>
          <NoirButton primary disabled={busy} onClick={() => void run()}>
            {busy ? "Перевыпускаем…" : "Перевыпустить"}
          </NoirButton>
          <NoirButton disabled={busy} onClick={onClose}>Отмена</NoirButton>
        </div>
      </NoirSheet>
    );
  }

  if ("error" in state) {
    return (
      <NoirSheet title="Не получилось" onClose={onClose}>
        <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted }}>{state.error}</div>
        <div style={{ height: 16 }} />
        <NoirButton onClick={onClose}>Закрыть</NoirButton>
      </NoirSheet>
    );
  }

  return (
    <NoirSheet title="Ключ перевыпущен" onClose={onClose}>
      <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted }}>
        Старый ключ больше не работает. Скопируйте новый и добавьте его в приложение.
      </div>
      {state.link ? (
        <div
          style={{
            marginTop: 16,
            height: 44,
            boxSizing: "border-box",
            background: O.bg,
            border: `1px solid ${O.border}`,
            borderRadius: 12,
            padding: 12,
            fontSize: 14,
            lineHeight: "20px",
            color: O.muted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            userSelect: "all",
            WebkitUserSelect: "all",
          }}
        >
          {state.link}
        </div>
      ) : null}
      <div style={{ height: 16 }} />
      <NoirButton
        primary
        disabled={!state.link}
        icon={copied ? "check" : "content_copy"}
        onClick={() => { void copyText(state.link).then((ok) => ok && setCopied(true)); }}
      >
        {copied ? "Скопировано" : "Скопировать ключ"}
      </NoirButton>
    </NoirSheet>
  );
}
