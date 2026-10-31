// FGN: сброс ключа подписки (вид FGN для src/app/components/ReissueKey.tsx).
// POST /api/app/subscription/reissue → revoke в Remnawave: новая ссылка, старая не работает, устройства отвязываются.
import { useState, type CSSProperties } from "react";
import { reissueKey } from "../utils/api";
import { copyText } from "./SubLinkBox";
import { C, FgnIcon, FgnSheet, fgnButton } from "./fgn";

const MUTED = "#9B9BA4";

const secondary: CSSProperties = {
  ...fgnButton,
  background: "transparent",
  color: C.text,
  border: `1px solid ${C.cardBorder}`,
};

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

  const text: CSSProperties = { marginTop: 14, fontSize: 14.5, lineHeight: "22px", color: MUTED };

  if (state === "confirm" || state === "busy") {
    const busy = state === "busy";
    return (
      <FgnSheet title="Сбросить ключ?" onClose={() => { if (!busy) onClose(); }}>
        <div style={text}>
          Старый ключ перестанет работать, а все устройства отвяжутся. Новый ключ нужно будет заново добавить в приложение на каждом устройстве.
        </div>
        <div style={{ ...text, marginTop: 10 }}>Делайте это, если ключ попал к посторонним.</div>
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
          <button type="button" className="blin-press" disabled={busy} onClick={() => void run()}
            style={{ ...fgnButton, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}>
            {busy ? "Сбрасываем…" : "Сбросить ключ"}
          </button>
          <button type="button" className="blin-press" disabled={busy} onClick={onClose} style={secondary}>Отмена</button>
        </div>
      </FgnSheet>
    );
  }

  if ("error" in state) {
    return (
      <FgnSheet title="Не получилось" onClose={onClose}>
        <div style={text}>{state.error}</div>
        <button type="button" className="blin-press" onClick={onClose} style={{ ...secondary, marginTop: 22 }}>Закрыть</button>
      </FgnSheet>
    );
  }

  return (
    <FgnSheet title="Ключ сброшен" onClose={onClose}>
      <div style={text}>Старый ключ больше не работает. Скопируйте новый и добавьте его в приложение.</div>
      {state.link ? (
        <div
          style={{
            marginTop: 14,
            background: "rgba(0, 0, 0, 0.22)",
            border: `1px solid ${C.cardBorder}`,
            borderRadius: 16,
            padding: "12px 14px",
            fontSize: 13,
            lineHeight: 1.45,
            color: MUTED,
            wordBreak: "break-all",
            userSelect: "all",
            WebkitUserSelect: "all",
          }}
        >
          {state.link}
        </div>
      ) : null}
      <button
        type="button"
        className="blin-press"
        disabled={!state.link}
        onClick={() => { void copyText(state.link).then((ok) => ok && setCopied(true)); }}
        style={{ ...fgnButton, marginTop: 16, gap: 8, opacity: state.link ? 1 : 0.6 }}
      >
        <FgnIcon name={copied ? "check" : "copy"} size={18} />
        {copied ? "Скопировано" : "Скопировать ключ"}
      </button>
    </FgnSheet>
  );
}
