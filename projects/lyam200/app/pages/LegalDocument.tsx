import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { fetchLegal } from "../utils/api";
import { RichText } from "../components/RichText";
import { N, NoirBack, NoirScreen } from "../components/noir";

// ЛЯМ200: 31–32 документы — общий экран в стиле ЛЯМ200 (компоненты noir → дизайн ЛЯМ200)

type Block = { kind: "h"; text: string } | { kind: "p"; text: string };

const DOC_TITLE = /^(публичная\s+)?(оферта|договор|политика)/i;

/**
 * Текст документа из панели → заголовки разделов и абзацы.
 * Заголовок: «# …» или короткая строка «1. Название» без точки в конце.
 * Первая строка-название документа («Публичная оферта …») пропускается — оно уже в шапке.
 */
function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  let first = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (first) {
      first = false;
      if (DOC_TITLE.test(line) && line.length < 70 && !/[.:]$/.test(line)) continue;
    }
    const md = /^#{1,3}\s+(.+)$/.exec(line);
    const numbered = /^\d{1,2}[.)]\s+\S/.test(line) && line.length <= 60 && !/[.;:,]$/.test(line);
    if (md || numbered) {
      flush();
      out.push({ kind: "h", text: md ? md[1] : line });
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

export default function LegalDocument() {
  const { kind } = useParams<{ kind: string }>();
  const goBack = useSmartBack("/settings");
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const title = kind === "privacy" ? "Политика конфиденциальности" : "Договор оферты";

  useEffect(() => {
    setText(null);
    setFailed(false);
    fetchLegal()
      .then((legal) => setText((kind === "privacy" ? legal.privacy : legal.offer) || ""))
      .catch(() => { setFailed(true); setText(""); });
  }, [kind]);

  const blocks = text ? parse(text) : [];

  return (
    <NoirScreen dim={0.45}>
      <NoirBack onClick={goBack} />
      <div
        style={{
          fontSize: 24,
          fontWeight: 600,
          lineHeight: "32px",
          paddingTop: 6,
          color: N.text,
          marginBottom: 16,
          wordBreak: "break-word",
        }}
      >
        {title}
      </div>

      {text === null ? (
        <div style={{ fontSize: 14, color: N.muted }}>Загрузка…</div>
      ) : failed || blocks.length === 0 ? (
        <div style={{ fontSize: 14, lineHeight: 1.5, color: N.muted }}>
          {failed ? "Не удалось загрузить документ. Попробуйте позже." : "Документ пока не опубликован."}
        </div>
      ) : (
        <div style={{ paddingBottom: 32, animation: "blinvpnRise 0.5s var(--ease-out) both" }}>
          {blocks.map((b, i) =>
            b.kind === "h" ? (
              <div
                key={i}
                role="heading"
                aria-level={2}
                style={{ fontSize: 14, fontWeight: 600, lineHeight: "22.75px", color: N.text, marginTop: i === 0 ? 0 : 16, marginBottom: 4 }}
              >
                {b.text}
              </div>
            ) : (
              <RichText
                key={i}
                text={b.text}
                compact
                style={{ fontSize: 14, lineHeight: "22.75px", color: blocks.slice(0, i).some((x) => x.kind === "h") ? N.muted : N.text, marginTop: i > 0 && blocks[i - 1].kind === "p" ? 16 : 0 }}
              />
            ),
          )}
        </div>
      )}
    </NoirScreen>
  );
}
