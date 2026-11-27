import { useState } from "react";
import { reissueKey } from "../utils/api";
import { copyText } from "./SubLinkBox";
import { N, NoirButton, NoirSheet } from "./noir";

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
      <NoirSheet title="Сбросить ключ?" onClose={() => { if (!busy) onClose(); }}>
        <div style={{ fontSize: 15, lineHeight: 1.5, color: N.muted, marginBottom: 20 }}>
          Старый ключ перестанет работать, а все устройства отвяжутся. Новый ключ нужно будет заново добавить в приложение на каждом устройстве.
          <br />
          <br />
          Делайте это, если ключ попал к посторонним.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <NoirButton primary disabled={busy} onClick={() => void run()}>
            {busy ? "Сбрасываем…" : "Сбросить ключ"}
          </NoirButton>
          <NoirButton disabled={busy} onClick={onClose}>Отмена</NoirButton>
        </div>
      </NoirSheet>
    );
  }

  if ("error" in state) {
    return (
      <NoirSheet title="Не получилось" onClose={onClose}>
        <div style={{ fontSize: 15, lineHeight: 1.5, color: N.muted, marginBottom: 20 }}>{state.error}</div>
        <NoirButton onClick={onClose}>Закрыть</NoirButton>
      </NoirSheet>
    );
  }

  return (
    <NoirSheet title="Ключ сброшен" onClose={onClose}>
      <div style={{ fontSize: 15, lineHeight: 1.5, color: N.muted, marginBottom: 14 }}>
        Старый ключ больше не работает. Скопируйте новый и добавьте его в приложение.
      </div>
      {state.link ? (
        <div
          style={{
            background: "rgba(255,255,255,0.05)",
            border: `1px solid ${N.cardBorder}`,
            borderRadius: 16,
            padding: "12px 14px",
            fontSize: 13,
            lineHeight: 1.45,
            color: N.muted,
            wordBreak: "break-all",
            userSelect: "all",
            WebkitUserSelect: "all",
            marginBottom: 14,
          }}
        >
          {state.link}
        </div>
      ) : null}
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
